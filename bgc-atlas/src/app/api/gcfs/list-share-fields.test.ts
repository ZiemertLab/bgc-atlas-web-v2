import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * /api/gcfs rows carry the family share fields on BOTH backends, so the
 * /gcfs "why this row matched" cells and the labelled ecosystem bars do not go
 * blank when the list falls back to PostgreSQL. The SQL path selects the
 * gcf_distributions_mv columns under the gcf_browse names and maps them with the
 * same mapShareFields.
 */

const { state, queryRaw, doc } = vi.hoisted(() => {
  // GCF-v2b6-035292 as both stores hold it (2026-10-22), trimmed.
  const doc = {
    gcf_id: 'gcf-1', gcf_name: 'GCF-1', member_bgc_count: 12278,
    biome_distribution_l3: { Marine: 34.6, 'Respiratory system': 25.4 },
    product_type_member_share: { 'RiPP-like': 99.96, 'lanthipeptide-class-iv': 0.01 },
    product_types_ge10: ['RiPP-like'], product_types_ge50: ['RiPP-like'], product_types_ge90: ['RiPP-like'],
    eco_l3_ge10: ['Marine', 'Respiratory system'],
    resolved_pct_l3: 63.11,
    dom_ecosystem_l3: 'Marine', max_pct_l3: 34.6,
  };
  return {
    doc,
    state: { browse: false },
    queryRaw: vi.fn(async (q: unknown) => {
      const text = (q as { text?: string; sql?: string })?.sql ?? (q as { text?: string })?.text ?? '';
      if (/SELECT COUNT\(\*\)/i.test(text)) return [{ count: BigInt(1) }];
      // Postgres hands numerics back as Decimal-likes, and null for an empty array.
      return [{ ...doc, resolved_pct_l3: { toString: () => '63.11', valueOf: () => '63.11' }, eco_l3_ge50: null }];
    }),
  };
});

vi.mock('@/lib/prisma', () => ({
  default: { $queryRaw: queryRaw, $queryRawUnsafe: queryRaw },
  prisma: { $queryRaw: queryRaw, $queryRawUnsafe: queryRaw },
}));

vi.mock('@/lib/cache', async (orig) => {
  const actual = await orig<typeof import('@/lib/cache')>();
  return { ...actual, getOrSetCache: async (_k: string, fetcher: () => Promise<unknown>) => fetcher() };
});

vi.mock('@/lib/opensearch/browse-client', () => ({
  isBrowseSearchEnabled: () => state.browse,
  searchBrowseIndex: async () => ({ total: 1, documents: [doc] }),
}));

vi.mock('@/lib/opensearch/known-cluster-decorations', () => ({
  withKnownClusterRollup: async <T>(rows: T[]) => rows.map((r) => ({ ...r, knownCluster: null })),
}));

beforeEach(() => { queryRaw.mockClear(); });

describe('list rows carry the share fields', () => {
  it.each([['OpenSearch', true], ['PostgreSQL', false]])('%s', async (_label, browse) => {
    state.browse = browse;
    const { GET } = await import('./route');
    const res = await GET(new Request('http://localhost/api/gcfs?limit=50'));
    expect(res.status).toBe(200);
    const row = (await res.json()).data.data[0];
    expect(row.productTypeMemberShare).toEqual({ 'RiPP-like': 99.96, 'lanthipeptide-class-iv': 0.01 });
    expect(row.productTypesAtLeast[50]).toEqual(['RiPP-like']);
    expect(row.ecosystemsAtLeastByLevel[3][10]).toEqual(['Marine', 'Respiratory system']);
    expect(row.ecosystemsAtLeastByLevel[3][50]).toEqual([]);
    expect(row.ecosystemResolvedPctByLevel[3]).toBe(63.11);
    expect(row.dominantEcosystemByLevel[3]).toEqual({ ecosystem: 'Marine', pct: 34.6 });
    expect(queryRaw.mock.calls.length > 0).toBe(!browse);
  });

  it('the SQL page query selects the share columns', async () => {
    state.browse = false;
    const { GET } = await import('./route');
    await GET(new Request('http://localhost/api/gcfs?limit=50'));
    const page = queryRaw.mock.calls
      .map(([q]) => (q as { sql?: string }).sql ?? '')
      .find((sql) => !/SELECT COUNT\(\*\)/i.test(sql)) ?? '';
    for (const column of ['gd.product_type_member_share', 'gd.product_types_ge90', 'gd.eco_l5_ge10', 'gd.resolved_pct_l1', 'gd.dom_ecosystem_l2', 'gd.max_pct_l4']) {
      expect(page).toContain(column);
    }
  });
});
