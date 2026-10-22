import { beforeEach, describe, expect, it, vi } from 'vitest';

const { executeRawUnsafe, queryRaw } = vi.hoisted(() => ({
  executeRawUnsafe: vi.fn(),
  queryRaw: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  default: {
    $transaction: async (fn: (tx: unknown) => unknown) =>
      fn({ $executeRawUnsafe: executeRawUnsafe, $queryRaw: queryRaw }),
  },
}));
vi.mock('@/lib/cache', () => ({ getOrSetCache: (_key: string, fn: () => unknown) => fn() }));

import { GET } from './route';

const ID = 'dc090787-0000-4000-8000-000000000000';
const SUMMARY = {
  total_bgcs: 10, bgcs_with_taxonomy: 8, bgcs_without_taxonomy: 2, unique_domains: 1,
  unique_phyla: 1, unique_classes: 1, unique_orders: 1, unique_families: 1, unique_genera: 1, unique_species: 1,
};

const call = () => GET(new Request(`http://x/api/gcfs/${ID}/taxonomy-distribution`), {
  params: Promise.resolve({ id: ID }),
});

const sqlRun = () => executeRawUnsafe.mock.calls.map(([sql]) => String(sql));

const LINEAGES = [
  { domain: 'd__Bacteria', phylum: 'p__A', class: null, order_name: null, family: null, genus: null, species: null, bgc_count: 30 },
  { domain: 'd__Bacteria', phylum: 'p__B', class: 'c__X', order_name: null, family: null, genus: null, species: null, bgc_count: 10 },
];

beforeEach(() => {
  executeRawUnsafe.mockReset();
  queryRaw.mockReset();
});

describe('GET /api/gcfs/[id]/taxonomy-distribution', () => {
  it('reads the precomputed counts and skips the member scan', async () => {
    queryRaw
      .mockResolvedValueOnce([{ precomputed: true }])
      .mockResolvedValueOnce([]) // top-20 lineages
      .mockResolvedValueOnce(LINEAGES) // every lineage
      .mockResolvedValueOnce([SUMMARY]);
    const res = await call();
    expect(res.status).toBe(200);
    expect(sqlRun().some((s) => s.includes('FROM gcf_taxonomy_counts'))).toBe(true);
    expect(sqlRun().some((s) => s.includes('FROM bgc_gcf'))).toBe(false);
    const { data } = await res.json();
    expect(data.summary.coveragePercentage).toBe(80);
    // Every lineage, compact, with no LIMIT: the charts are drawn from these.
    expect(data.lineages).toEqual([
      ['d__Bacteria', 'p__A', null, null, null, null, null, 30],
      ['d__Bacteria', 'p__B', 'c__X', null, null, null, null, 10],
    ]);
    const queried = queryRaw.mock.calls.map(([q]) => ((q as { strings?: string[] }).strings ?? [String(q)]).join('?'));
    const every = queried.find((s) => s.includes('GROUP BY t.domain, t.phylum, t.class, t.order_name, t.family, t.genus, t.species'));
    expect(every).toBeDefined();
    expect(every).not.toMatch(/LIMIT/);
  });

  // A family the table has no rows for: re-clustered since it was last built.
  it('falls back to scanning the members when the family is not precomputed', async () => {
    queryRaw
      .mockResolvedValueOnce([{ precomputed: false }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([SUMMARY]);
    const res = await call();
    expect(res.status).toBe(200);
    const scan = sqlRun().find((s) => s.includes('FROM bgc_gcf'));
    expect(scan).toContain('INSERT INTO gcf_tax_counts');
    expect(scan).toContain('bg.is_primary');
  });
});
