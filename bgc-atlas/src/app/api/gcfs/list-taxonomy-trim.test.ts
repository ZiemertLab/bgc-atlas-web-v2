import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * /api/gcfs list rows carry each rank's top 20 taxa plus the untrimmed count, on
 * both backends. One family spans 22,103 species; sent whole, the default page
 * weighed 4.08 MB. See lib/gcf/trim-taxonomy.ts.
 */

const { species, state, queryRaw } = vi.hoisted(() => {
  const species = Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`s__t${i}`, 30 - i]));
  return {
    species,
    state: { browse: false },
    // The SQL path runs two queries: COUNT(*) for the total, and the page itself.
    // Anything that is not the count gets the data row.
    queryRaw: vi.fn(async (q: unknown) => {
      const text = (q as { text?: string })?.text ?? '';
      if (/SELECT COUNT\(\*\)/i.test(text)) return [{ count: BigInt(1) }];
      return [{ gcf_id: 'gcf-1', gcf_name: 'GCF-1', member_bgc_count: 30, taxonomy_distributions: { species } }];
    }),
  };
});

vi.mock('@/lib/prisma', () => ({
  default: { $queryRaw: queryRaw, $queryRawUnsafe: queryRaw },
  prisma: { $queryRaw: queryRaw, $queryRawUnsafe: queryRaw },
}));

vi.mock('@/lib/cache', async (orig) => {
  const actual = await orig<typeof import('@/lib/cache')>();
  return {
    ...actual,
    getOrSetCache: async (_k: string, fetcher: () => Promise<unknown>) => fetcher(),
  };
});

vi.mock('@/lib/opensearch/browse-client', () => ({
  isBrowseSearchEnabled: () => state.browse,
  searchBrowseIndex: async () => ({
    total: 1,
    documents: [{ gcf_id: 'gcf-1', gcf_name: 'GCF-1', member_bgc_count: 30, taxonomy_distributions: { species } }],
  }),
}));

vi.mock('@/lib/opensearch/known-cluster-decorations', () => ({
  withKnownClusterRollup: async <T>(rows: T[]) => rows.map((r) => ({ ...r, knownCluster: null })),
}));

type Row = {
  taxonomyDistributionByRank: Record<string, Record<string, number>>;
  taxonomyTaxaCountByRank: Record<string, number>;
};

async function firstRow(): Promise<Row> {
  const { GET } = await import('./route');
  const res = await GET(new Request('http://localhost/api/gcfs?limit=50'));
  expect(res.status).toBe(200);
  const body = await res.json();
  return body.data.data[0];
}

beforeEach(() => { queryRaw.mockClear(); });

describe('list rows carry the top 20 taxa per rank', () => {
  it.each([['OpenSearch', true], ['PostgreSQL', false]])('%s', async (_label, browse) => {
    state.browse = browse;
    const row = await firstRow();
    expect(Object.keys(row.taxonomyDistributionByRank.species)).toHaveLength(20);
    expect(row.taxonomyDistributionByRank.species['s__t0']).toBe(30);
    expect(row.taxonomyDistributionByRank.species['s__t29']).toBeUndefined();
    expect(row.taxonomyTaxaCountByRank.species).toBe(30);
    // The SQL path must actually have been taken, not served from the mocked index.
    expect(queryRaw.mock.calls.length > 0).toBe(!browse);
  });
});
