import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * /api/assemblies reads its per-assembly BGC counts from assembly_bgc_counts_mv.
 *
 * It used to compute them with a correlated COUNT(*) over bgcs for every assembly
 * passing the filters -- ~836k probes of a 16.5M-row table, twice per request --
 * and an unfiltered request never finished (4 of 5 ended 499 in the nginx logs).
 * The SQL is asserted by shape because the cost was in the shape.
 */

const { store, queryRaw } = vi.hoisted(() => ({
  store: new Map<string, string>(),
  queryRaw: vi.fn(),
}));

vi.mock('@/lib/redis-client', () => ({
  default: {
    get: async (key: string) => store.get(key) ?? null,
    set: async (key: string, value: string) => { store.set(key, value); return 'OK'; },
    scan: async () => ['0', []] as [string, string[]],
    del: async () => 0,
  },
}));
vi.mock('@/lib/prisma', () => ({ default: { $queryRaw: queryRaw } }));

import { GET } from './route';

type Stmt = { strings?: string[] };
const sqlText = (q: unknown) => ((q as Stmt).strings ?? []).join('?').replace(/\s+/g, ' ');
const issued = () => queryRaw.mock.calls.map(([q]) => sqlText(q));
const countSql = () => issued().find((s) => s.includes('COUNT(*)::int AS total'))!;
const dataSql = () => issued().find((s) => s.includes('antismash_run_id'))!;

const get = (query: string) => GET(new Request(`http://localhost/api/assemblies?${query}`));

beforeEach(() => {
  store.clear();
  queryRaw.mockReset().mockImplementation(async (q: unknown) =>
    sqlText(q).includes('COUNT(*)::int AS total') ? [{ total: 0 }] : [],
  );
});

describe('GET /api/assemblies', () => {
  it('reads the precomputed count instead of counting bgcs per assembly', async () => {
    const res = await get('limit=50&offset=0&sortField=bgcs&sortOrder=desc&sourceType=metagenome');
    expect(res.status).toBe(200);
    for (const sql of [countSql(), dataSql()]) {
      expect(sql).not.toMatch(/FROM bgcs/);
    }
    expect(dataSql()).toContain('LEFT JOIN assembly_bgc_counts_mv abc ON abc.assembly_id = a.id');
    expect(dataSql()).toContain('COALESCE(abc.bgc_count, 0)::int AS assembly_bgc_count');
  });

  it('breaks sort ties by assembly id, so pages neither repeat nor skip rows', async () => {
    await get('sortField=bgcs&sortOrder=desc');
    expect(dataSql()).toMatch(/ORDER BY assembly_bgc_count DESC, assembly_id ASC LIMIT/);
    store.clear();
    queryRaw.mockClear();
    await get('sortField=location&sortOrder=asc');
    expect(dataSql()).toMatch(/ORDER BY COALESCE\(geographic_location, geolocation_name, ''\) ASC, assembly_id ASC LIMIT/);
  });

  it('joins the counts into the total only when a # BGCs bound needs them', async () => {
    await get('sourceType=metagenome');
    expect(countSql()).not.toContain('assembly_bgc_counts_mv');

    store.clear();
    queryRaw.mockClear();
    await get('sourceType=metagenome&bgcsMin=100');
    expect(countSql()).toContain('LEFT JOIN assembly_bgc_counts_mv abc ON abc.assembly_id = a.id');
    expect(countSql()).toMatch(/\) t WHERE assembly_bgc_count >= \?/);
  });
});
