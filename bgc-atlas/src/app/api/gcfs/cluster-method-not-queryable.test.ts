import { beforeEach, describe, expect, it, vi } from 'vitest';

import { buildBrowseFilters, buildBrowseSearchRequest } from '@/lib/opensearch/browse-query';
import { browseAdvancedFields } from '@/lib/opensearch/browse-advanced';
import { gcfFilterFields } from '@/lib/filters/field-definitions';
import { API_ENDPOINTS } from '@/lib/api-catalog';

/**
 * `cluster_method` is provenance, not a query key: it holds one value
 * (`bigslice-2.0-birch`) on every row, so any filter, sort or search on it
 * returns the whole corpus or nothing. The value is still stored and returned.
 */

type Captured = { text: string };
const { captured } = vi.hoisted(() => ({ captured: [] as Captured[] }));

const capture = vi.fn(async (q: unknown) => {
  const sql = q as { text?: string };
  if (sql?.text) captured.push({ text: sql.text });
  return [];
});

vi.mock('@/lib/prisma', () => ({
  default: { $queryRaw: capture, $queryRawUnsafe: capture },
  prisma: { $queryRaw: capture, $queryRawUnsafe: capture },
}));

vi.mock('@/lib/cache', async (orig) => {
  const actual = await orig<typeof import('@/lib/cache')>();
  return {
    ...actual,
    getOrSetCache: async (_k: string, fetcher: () => Promise<unknown>) => fetcher(),
    getOrSetCacheWithMetadata: async (_k: string, fetcher: () => Promise<unknown>) => ({
      data: await fetcher(), isHit: false,
    }),
  };
});

async function queriesFor(qs: string): Promise<{ count: string; order: string }> {
  captured.length = 0;
  const mod = await import('./route');
  const res = await mod.GET(new Request(`http://localhost/api/gcfs?${qs}`));
  expect(res.status, `GET /api/gcfs?${qs} did not answer 200`).toBe(200);
  const texts = captured.map((c) => c.text);
  // Assert on the COUNT query: the row query still SELECTs g.cluster_method for
  // the `clusterMethod` response field.
  const count = texts.find((t) => /SELECT COUNT\(\*\)/i.test(t));
  expect(count, `no COUNT query issued for /api/gcfs?${qs}`).toBeDefined();
  const paged = texts.filter((t) => /LIMIT\s+\$\d+\s+OFFSET\s+\$\d+\s*$/i.test(t));
  expect(paged.length, `no paged query issued for /api/gcfs?${qs}`).toBeGreaterThan(0);
  const m = paged[paged.length - 1]!
    .match(/[\s\S]*\bORDER BY\b([\s\S]*?)\s+LIMIT\s+\$\d+\s+OFFSET\s+\$\d+\s*$/i);
  expect(m, `no paged ORDER BY for /api/gcfs?${qs}`).not.toBeNull();
  return { count: count!, order: m![1].replace(/\s+/g, ' ').trim() };
}

beforeEach(() => {
  captured.length = 0;
  vi.stubEnv('OPENSEARCH_BROWSE_ENABLED', 'false');
  vi.stubEnv('OPENSEARCH_BROWSE_GCFS_ENABLED', 'false');
});

describe('the SQL backend never queries cluster_method', () => {
  it.each([
    ['no params', 'limit=50'],
    ['?search=', 'search=bigslice&limit=50'],
    ['?sortField=clusterMethod', 'sortField=clusterMethod&limit=50'],
  ])('filters and orders on no cluster_method for %s', async (_label, qs) => {
    const { count, order } = await queriesFor(qs);
    expect(count).not.toContain('cluster_method');
    expect(order).not.toContain('cluster_method');
  });

  it('sortField=clusterMethod falls through to the default ordering', async () => {
    const { order } = await queriesFor('sortField=clusterMethod&limit=50');
    expect(order).toBe('g.gcf_name ASC, g.gcf_id ASC');
    expect(order).toBe((await queriesFor('limit=50')).order);
  });

  it('never builds a cluster_method predicate from a free-text search', async () => {
    // With a cluster_method leg, `search=bigslice` would match every family.
    const { count } = await queriesFor('search=bigslice&limit=50');
    expect(count).not.toContain('cluster_method');
    expect(count).toContain('ILIKE');
  });
});

describe('the OpenSearch backend never queries cluster_method', () => {
  it.each([
    ['?clusterMethod=', 'clusterMethod=bigslice'],
    ['?search=', 'search=bigslice'],
  ])('builds no cluster_method clause for %s', (_label, qs) => {
    const built = JSON.stringify(buildBrowseFilters('gcfs', new URLSearchParams(qs)));
    expect(built).not.toContain('cluster_method');
  });

  it('falls through to the same default sort the SQL path uses', () => {
    // The backends must agree on the fallback sort (gcf_name asc).
    const sortFor = (qs: string) =>
      JSON.stringify(buildBrowseSearchRequest('gcfs', new URLSearchParams(qs)).sort);
    expect(sortFor('sortField=clusterMethod')).not.toContain('cluster_method');
    expect(sortFor('sortField=clusterMethod')).toBe(sortFor(''));
  });
});

describe('cluster_method is offered nowhere a reader can reach it', () => {
  it('is not an Advanced-panel field', () => {
    expect(gcfFilterFields.map((f) => f.id)).not.toContain('clusterMethod');
  });

  it('is not a browse catalog field', () => {
    expect(browseAdvancedFields('gcfs').map((f) => f.id)).not.toContain('clusterMethod');
  });

  it('is not a documented /api/gcfs parameter', () => {
    const gcfs = API_ENDPOINTS.find((e) => e.path === '/api/gcfs');
    expect(gcfs, 'no /api/gcfs entry in the API catalog').toBeDefined();
    expect(gcfs!.params?.map((p) => p.name)).not.toContain('clusterMethod');
  });
});

/** Ignoring `?clusterMethod=zzz` would silently widen to the whole corpus. */
describe('?clusterMethod= is refused, not ignored', () => {
  it('answers 400 with repair text naming the parameter', async () => {
    const mod = await import('./route');
    const res = await mod.GET(new Request('http://localhost/api/gcfs?limit=1&clusterMethod=zzz'));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.rejected).toEqual(['clusterMethod']);
    // Refusals reach people holding stale links, so the text says what to do.
    expect(body.message).toMatch(/bigslice-2\.0-birch/);
    expect(body.message).toMatch(/Drop the parameter/);
    expect(body.error).toBe(body.message);
  });

  it('does not refuse a request that omits it', async () => {
    const mod = await import('./route');
    const res = await mod.GET(new Request('http://localhost/api/gcfs?limit=1'));
    expect(res.status).toBe(200);
  });
});
