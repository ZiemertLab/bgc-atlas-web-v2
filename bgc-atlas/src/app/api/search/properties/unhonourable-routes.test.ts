import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { MAX_DISTRIBUTION_FIELDS } from '@/lib/filters/bgc-property-fields';

/**
 * The other five routes that take the same FilterGroup. /export and /export-gbk
 * are posted to directly by the UI, so a dropped condition would produce a
 * widened file at HTTP 200. /export-gbk must refuse before any job is enqueued.
 */

vi.mock('@/lib/opensearch/hydrate', () => ({
  hydrateDisplayFields: vi.fn(async () => ({})),
  hydrateGcfNames: vi.fn(async () => ({})),
}));

// The limiter is backed by the real Redis shared with the running site; unmocked,
// this file would spend the export budget and then see 429s.
vi.mock('@/lib/rate-limit', () => ({
  exportRateLimit: {},
  searchRateLimit: {},
  getClientIp: () => '127.0.0.1',
  checkRateLimit: async () => ({ success: true, limit: 10, remaining: 9, reset: 0 }),
}));

const { addExportJob } = vi.hoisted(() => ({
  addExportJob: vi.fn(async () => ({ id: 'job-1' })),
}));
vi.mock('@/lib/queue', () => ({ addExportJob }));

const { createExportRecord } = vi.hoisted(() => ({
  createExportRecord: vi.fn(async () => ({})),
}));
vi.mock('@/lib/prisma', () => ({
  default: { gcfExportJob: { create: createExportRecord, update: vi.fn(async () => ({})) } },
}));

let osRequests: Record<string, unknown>[] = [];
let osFails = false;

/** Aggregations shaped from the requested aggs, so client functions can parse them. */
const fakeAggs = (aggs: unknown): Record<string, unknown> => {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys((aggs ?? {}) as object)) {
    out[key] = { buckets: [], sum_other_doc_count: 0, doc_count: 0, value: 0, values: {} };
  }
  return out;
};

beforeEach(() => {
  osRequests = [];
  osFails = false;
  addExportJob.mockClear();
  createExportRecord.mockClear();
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: { body?: string }) => {
    const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
    osRequests.push(body);
    if (osFails) return new Response('cluster_block_exception', { status: 503 });
    // scrollHits pages with `sort` + search_after; return one document.
    const isScroll = Array.isArray(body.sort) && body.size !== 0;
    if (String(_url).endsWith('/_count')) {
      return new Response(JSON.stringify({ count: 1 }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    return new Response(JSON.stringify({
      hits: {
        total: { value: 1 },
        hits: isScroll ? [{ _id: 'bgc-1', _source: { bgc_id: 'bgc-1', contig: 'c1' }, sort: ['bgc-1'] }] : [],
      },
      aggregations: fakeAggs(body.aggs),
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }));
});

type Route = 'export' | 'export-gbk' | 'aggregate' | 'entities' | 'geo';

const post = async (route: Route, payload: unknown) => {
  const mod = await import(`@/app/api/search/properties/${route}/route`) as {
    POST: (r: NextRequest) => Promise<Response>;
  };
  const res = await mod.POST(new NextRequest(`http://localhost/api/search/properties/${route}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }));
  const text = await res.text();
  let json: Record<string, never> | null = null;
  try { json = JSON.parse(text) as Record<string, never>; } catch { /* a file body */ }
  return { status: res.status, json, text, headers: res.headers };
};

const group = (conditions: unknown[]) => ({ id: 'g', operator: 'AND', conditions, groups: [] });
const cond = (field: string, operator: string, value: unknown) =>
  ({ id: `c-${field}-${operator}`, field, operator, value });

/** Honoured by nothing, so any route that dropped it would widen. */
const BAD = group([cond('is_complete', 'in', ['true'])]);
const GOOD = group([cond('is_complete', 'equals', 'true')]);

const namesTheCondition = (json: Record<string, never> | null) => {
  expect(String(json?.error)).toContain('is_complete');
  expect(String(json?.error)).toContain('in');
};

describe('/export refuses to write a widened file', () => {
  it('400s instead of exporting the whole corpus', async () => {
    const { status, json } = await post('export', { group: BAD, format: 'csv' });
    expect(status).toBe(400);
    namesTheCondition(json);
    expect(osRequests).toEqual([]);
  });

  it('still exports the honourable form', async () => {
    const { status, headers } = await post('export', { group: GOOD, format: 'tsv' });
    expect(status).toBe(200);
    expect(headers.get('Content-Type')).toContain('tab-separated');
    expect(headers.get('X-Result-Count')).toBe('1');
  });

  it('400s on the entity (GCF/sample) export path too', async () => {
    const { status, json } = await post('export', { group: BAD, entity: 'gcfs', format: 'csv' });
    expect(status).toBe(400);
    namesTheCondition(json);
    expect(osRequests).toEqual([]);
  });
});

describe('/export-gbk refuses before the job is enqueued', () => {
  it('400s and enqueues nothing', async () => {
    const { status, json } = await post('export-gbk', { group: BAD });
    expect(status).toBe(400);
    namesTheCondition(json);
    expect(addExportJob).not.toHaveBeenCalled();
    expect(createExportRecord).not.toHaveBeenCalled();
    expect(osRequests).toEqual([]);
  });

  it('records the job, then enqueues it under the same id, for the honourable form', async () => {
    const { status, json } = await post('export-gbk', { group: GOOD, searchHref: '/search?tab=properties' });
    expect(status).toBe(200);
    expect(createExportRecord).toHaveBeenCalledTimes(1);
    const record = (createExportRecord.mock.calls[0] as unknown as [{ data: Record<string, unknown> }])[0].data;
    expect(record).toMatchObject({
      kind: 'regions', status: 'pending', total_bgcs: 1, search_href: '/search?tab=properties',
    });
    expect(json?.exportJobId).toBe(record.id);
    expect(addExportJob).toHaveBeenCalledTimes(1);
    // The job carries the search, not its ids.
    const job = (addExportJob.mock.calls[0] as unknown as [{ exportJobId: string; group: unknown; bgcIds?: string[] }])[0];
    expect(job.exportJobId).toBe(record.id);
    expect(job.group).toEqual(GOOD);
    expect(job.bgcIds).toBeUndefined();
    expect(osRequests.some((r) => Array.isArray(r.sort))).toBe(false);
  });
});

describe('/aggregate refuses to chart a widened set', () => {
  it('400s instead of plotting the whole corpus', async () => {
    const { status, json } = await post('aggregate', { group: BAD, fields: ['product'] });
    expect(status).toBe(400);
    namesTheCondition(json);
    expect(osRequests).toEqual([]);
  });

  it('400s on a field that cannot be plotted, naming it', async () => {
    // `core_seq` is free text: no bounded value set to aggregate.
    const { status, json } = await post('aggregate', { group: null, fields: ['product', 'core_seq'] });
    expect(status).toBe(400);
    expect(String(json?.error)).toContain('core_seq');
    expect(osRequests).toEqual([]);
  });

  it('still aggregates plottable fields', async () => {
    const { status, json } = await post('aggregate', { group: GOOD, fields: ['product', 'length'] });
    expect(status).toBe(200);
    expect(Array.isArray(json?.results)).toBe(true);
  });

  it('truncates past MAX_FIELDS rather than refusing (the panel allows more)', async () => {
    const thirteen = [
      'product', 'product_category', 'is_complete', 'sample_type', 'biome',
      'gold_ecosystem', 'pfam', 'substrates', 'ripp_class', 'tax_phylum',
      'tax_genus', 'length', 'gc_content',
    ];
    const { status, json } = await post('aggregate', { group: null, fields: thirteen });
    expect(status).toBe(200);
    expect(json?.results).toHaveLength(MAX_DISTRIBUTION_FIELDS);
    // Truncation is stated, not left as an absence the panel would spin on.
    expect(json?.omittedFields).toEqual(['gc_content']);
  });

  it('asks nothing when no fields are requested', async () => {
    const { status, json } = await post('aggregate', { group: BAD, fields: [] });
    expect(status).toBe(200);
    expect(json?.results).toEqual([]);
    expect(osRequests).toEqual([]);
  });
});

describe('/entities refuses to group a widened set', () => {
  it('400s for the GCF rollup', async () => {
    const { status, json } = await post('entities', { group: BAD, entity: 'gcfs' });
    expect(status).toBe(400);
    namesTheCondition(json);
    expect(osRequests).toEqual([]);
  });

  it('400s when a family-scope COHORT is unhonourable', async () => {
    const { status, json } = await post('entities', {
      group: null, entity: 'gcfs',
      familyScope: { cohorts: [group([cond('latitude', 'gte', 60)]), BAD], minPurity: 1 },
    });
    expect(status).toBe(400);
    namesTheCondition(json);
    expect(osRequests).toEqual([]);
  });

  it('still rolls up the honourable form', async () => {
    const { status } = await post('entities', { group: GOOD, entity: 'samples' });
    expect(status).toBe(200);
  });

  it('keeps its own 400 for an invalid entity', async () => {
    const { status, json } = await post('entities', { group: null, entity: 'bgcs' });
    expect(status).toBe(400);
    expect(String(json?.error)).toContain('gcfs');
  });
});

describe('/geo refuses to map a widened set', () => {
  it('400s for the grid', async () => {
    const { status, json } = await post('geo', { group: BAD, zoom: 2 });
    expect(status).toBe(400);
    namesTheCondition(json);
    expect(osRequests).toEqual([]);
  });

  it('400s for the mappable-count shortcut', async () => {
    const { status, json } = await post('geo', { group: BAD, countOnly: true });
    expect(status).toBe(400);
    namesTheCondition(json);
    expect(osRequests).toEqual([]);
  });

  it('still maps the honourable form', async () => {
    const { status, json } = await post('geo', { group: GOOD, countOnly: true });
    expect(status).toBe(200);
    expect(json?.hits).toBe(1);
  });

  it('an OpenSearch failure is still a 502, not a 400', async () => {
    osFails = true;
    const { status, json } = await post('geo', { group: GOOD, countOnly: true });
    expect(status).toBe(502);
    expect(json?.error).toMatch(/^Something went wrong on our side\. Please try again in a few minutes\. \(ref [0-9a-f]{6}\)$/);
  });
});

describe('every route that takes a group rejects it', () => {
  // buildQuery fails closed, so a route added later inherits the refusal.
  const cases: [Route, unknown][] = [
    ['export', { group: BAD }],
    ['export-gbk', { group: BAD }],
    ['aggregate', { group: BAD, fields: ['product'] }],
    ['entities', { group: BAD, entity: 'gcfs' }],
    ['geo', { group: BAD }],
  ];
  it.each(cases)('%s 400s on an unhonourable condition', async (route, payload) => {
    const { status } = await post(route, payload);
    expect(status).toBe(400);
  });
});
