import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * POST /api/search/properties over a stubbed `fetch`. `is_complete in ["true"]`
 * yields a null clause (boolean field, `select` type); dropped, it would answer
 * the whole corpus at 200, so the route must refuse it.
 */

vi.mock('@/lib/opensearch/hydrate', () => ({
  hydrateDisplayFields: vi.fn(async () => ({})),
}));

const CORPUS = 16_449_773;
const COMPLETE = 2_724_171;

let osRequests: Record<string, unknown>[] = [];
/** Total the fake index reports; a test may set it per query. */
let totalFor: (body: Record<string, unknown>) => number;
let osFails = false;

beforeEach(() => {
  osRequests = [];
  osFails = false;
  totalFor = () => CORPUS;
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: { body?: string }) => {
    const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
    osRequests.push(body);
    if (osFails) {
      return new Response('cluster_block_exception', { status: 503 });
    }
    return new Response(JSON.stringify({
      hits: { total: { value: totalFor(body) }, hits: [] },
      aggregations: {},
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }));
});

const post = async (payload: unknown) => {
  const { POST } = await import('@/app/api/search/properties/route');
  const req = new NextRequest('http://localhost/api/search/properties', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const res = await POST(req);
  return { status: res.status, body: await res.json() as Record<string, never> };
};

const group = (conditions: unknown[], groups: unknown[] = []) =>
  ({ id: 'g', operator: 'AND', conditions, groups });
const cond = (field: string, operator: string, value: unknown) =>
  ({ id: `c-${field}-${operator}`, field, operator, value });

const clausesOf = (body: Record<string, unknown>): string => JSON.stringify(body.query);

describe('POST /api/search/properties rejects what it cannot honour', () => {
  it('400s on `in` over a boolean field instead of answering the whole corpus', async () => {
    const { status, body } = await post({ group: group([cond('is_complete', 'in', ['true'])]) });
    expect(status).toBe(400);
    expect(body.error).toContain('is_complete');
    expect(body.error).toContain('in');
    expect(osRequests).toEqual([]);
  });

  it('still answers the honourable form of the same question', async () => {
    totalFor = (body) => (clausesOf(body).includes('"is_complete":true') ? COMPLETE : CORPUS);
    const { status, body } = await post({ group: group([cond('is_complete', 'equals', 'true')]) });
    expect(status).toBe(200);
    expect(body.total).toBe(COMPLETE);
    expect(clausesOf(osRequests[0])).toContain('"is_complete":true');
  });

  it('400s on an unknown field id and names it', async () => {
    const { status, body } = await post({ group: group([cond('not_a_field', 'equals', 'x')]) });
    expect(status).toBe(400);
    expect(body.error).toContain('not_a_field');
    expect(osRequests).toEqual([]);
  });

  it('reports every offending condition, not just the first', async () => {
    const { status, body } = await post({
      group: group(
        [cond('is_complete', 'in', ['true']), cond('not_a_field', 'equals', 'x')],
        [group([cond('length', 'contains', '5')])],
      ),
    });
    expect(status).toBe(400);
    for (const name of ['is_complete', 'not_a_field', 'length']) {
      expect(body.error).toContain(name);
    }
    expect(body.rejected).toHaveLength(3);
  });

  it('400s on a facetFields entry that is not aggregatable', async () => {
    const { status, body } = await post({
      group: null,
      facetFields: ['product', 'length'],
    });
    expect(status).toBe(400);
    expect(body.error).toContain('length');
    expect(osRequests).toEqual([]);
  });

  it('reports a bad condition and a bad facet field in the SAME 400', async () => {
    // Otherwise the reader fixes one and gets a second 400.
    const { status, body } = await post({
      group: group([cond('is_complete', 'in', ['true'])]),
      facetFields: ['length'],
    });
    expect(status).toBe(400);
    expect(body.error).toContain('is_complete');
    expect(body.error).toContain('"length"');
    expect(body.rejected).toHaveLength(1);
    expect(body.rejectedFacetFields).toEqual(['length']);
  });

  it('accepts the twelve default facet fields', async () => {
    const { defaultFacetFields } = await import('@/lib/filters/bgc-property-fields');
    const { status } = await post({ group: null, facetFields: defaultFacetFields });
    expect(status).toBe(200);
    expect(Object.keys((osRequests[0].aggs ?? {}) as object)).toEqual(defaultFacetFields);
  });
});

describe('POST /api/search/properties stays lenient where it should', () => {
  it('drops a half-built (empty-value) condition silently, with no 400', async () => {
    const { status, body } = await post({
      group: group([cond('is_complete', 'in', ''), cond('product', 'in', [])]),
    });
    expect(status).toBe(200);
    expect(body.total).toBe(CORPUS);
    expect(clausesOf(osRequests[0])).toContain('match_all');
  });

  it('drops an empty-value condition sitting next to a real one', async () => {
    const { status, body } = await post({
      group: group([cond('product', 'in', ['T1PKS']), cond('is_complete', 'in', '')]),
    });
    expect(status).toBe(200);
    expect(clausesOf(osRequests[0])).toContain('"product":["T1PKS"]');
    expect(body.rejected).toBeUndefined();
  });

  it('group: null still returns the full corpus', async () => {
    const { status, body } = await post({ group: null, facetFields: [] });
    expect(status).toBe(200);
    expect(body.total).toBe(CORPUS);
    expect(clausesOf(osRequests[0])).toContain('match_all');
  });

  it('an OpenSearch failure is still a 502, not a 400', async () => {
    osFails = true;
    const { status, body } = await post({ group: null, facetFields: [] });
    expect(status).toBe(502);
    expect(body.error).toMatch(/^Something went wrong on our side\. Please try again in a few minutes\. \(ref [0-9a-f]{6}\)$/);
  });

  it('invalid JSON is still a 400 about the body', async () => {
    const { POST } = await import('@/app/api/search/properties/route');
    const req = new NextRequest('http://localhost/api/search/properties', {
      method: 'POST', body: 'not json',
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('invalid JSON body');
  });
});
