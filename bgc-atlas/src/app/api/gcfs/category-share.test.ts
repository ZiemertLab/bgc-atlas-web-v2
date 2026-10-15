import { beforeEach, describe, expect, it, vi } from 'vitest';

import { buildBrowseSearchRequest } from '@/lib/opensearch/browse-query';

/**
 * The /gcfs Category threshold is a share of members
 * (gcf_distributions_mv.category_member_share; category_share_<cat> in the
 * index). Each case pins both backends.
 */

type Captured = { text: string; values: unknown[] };
const { captured } = vi.hoisted(() => ({ captured: [] as Captured[] }));

const capture = vi.fn(async (q: unknown) => {
  const sql = q as { text?: string; values?: unknown[] };
  if (sql?.text) captured.push({ text: sql.text, values: sql.values ?? [] });
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
  };
});

const flat = (s: string) => s.replace(/\s+/g, ' ').trim();

async function sqlFor(qs: string): Promise<{ count: Captured; order: string; status: number }> {
  captured.length = 0;
  const mod = await import('./route');
  const res = await mod.GET(new Request(`http://localhost/api/gcfs?${qs}`));
  const count = captured.find((c) => /SELECT COUNT\(\*\)/i.test(c.text));
  const paged = captured.filter((c) => /LIMIT\s+\$\d+\s+OFFSET\s+\$\d+\s*$/i.test(c.text));
  const m = paged.at(-1)?.text
    .match(/[\s\S]*\bORDER BY\b([\s\S]*?)\s+LIMIT\s+\$\d+\s+OFFSET\s+\$\d+\s*$/i);
  return {
    count: count ?? { text: '', values: [] },
    order: m ? flat(m[1]) : '',
    status: res.status,
  };
}

const osFilters = (q: Record<string, string>) =>
  (buildBrowseSearchRequest('gcfs', new URLSearchParams(q)) as {
    query: { bool: { filter: unknown[] } };
  }).query.bool.filter;

const osSort = (q: Record<string, string>) =>
  (buildBrowseSearchRequest('gcfs', new URLSearchParams(q)) as { sort: unknown[] }).sort;

beforeEach(() => {
  captured.length = 0;
  vi.stubEnv('OPENSEARCH_BROWSE_ENABLED', 'false');
  vi.stubEnv('OPENSEARCH_BROWSE_GCFS_ENABLED', 'false');
});

describe('a category threshold is a share of members on both backends', () => {
  it('?categoryMinShare=50 compares the stored share', async () => {
    const { count } = await sqlFor('category=NRPS&categoryMinShare=50&limit=50');
    expect(flat(count.text)).toContain('gdm.category_member_share ->>');
    expect(flat(count.text)).toContain('::numeric >=');
    expect(count.values).toEqual(expect.arrayContaining(['NRPS', 50]));

    expect(osFilters({ category: 'NRPS', categoryMinShare: '50' }))
      .toContainEqual({ range: { category_share_nrps: { gte: 50 } } });
  });

  it('?categoryMinShare=0 is membership, not share > 0', async () => {
    // Shares are stored to 2 dp, so a tiny minority reads 0.00 and `> 0` would lose it.
    const { count } = await sqlFor('category=NRPS&categoryMinShare=0&limit=50');
    expect(flat(count.text)).toContain('= ANY(g.product_categories)');
    expect(flat(count.text)).not.toContain('category_member_share');

    const filters = osFilters({ category: 'NRPS', categoryMinShare: '0' });
    expect(filters).toContainEqual({ term: { product_categories: 'NRPS' } });
    expect(JSON.stringify(filters)).not.toContain('category_share_');
  });

  it('a link with no threshold keeps the old any-member text match', async () => {
    const { count } = await sqlFor('category=nrp&limit=50');
    expect(flat(count.text)).toContain('unnest(g.product_categories) pc WHERE pc ILIKE');

    expect(osFilters({ category: 'nrp' }))
      .toContainEqual({ wildcard: { product_categories: { value: '*nrp*', case_insensitive: true } } });
  });
});

describe('the free-text search matches majority categories', () => {
  it('reads majority_categories, not every category any member carries', async () => {
    const { count } = await sqlFor('search=NRPS&limit=50');
    expect(flat(count.text)).toContain('unnest(gdm.majority_categories) mc');
    expect(flat(count.text)).not.toContain('product_categories');

    const search = JSON.stringify(osFilters({ search: 'NRPS' }));
    expect(search).toContain('majority_categories');
    expect(search).not.toContain('product_categories');
  });
});

describe('sorting by the share of the filtered category', () => {
  it('orders by the share, NULLS LAST / missing last in both directions', async () => {
    for (const dir of ['asc', 'desc'] as const) {
      const { order } = await sqlFor(
        `category=PKS&categoryMinShare=10&sortField=categoryShare&sortOrder=${dir}&limit=50`,
      );
      // The placeholder number depends on how many filter values precede it.
      expect(order).toMatch(new RegExp(
        `^\\(gd\\.category_member_share ->> \\$\\d+\\)::numeric ${dir.toUpperCase()} NULLS LAST, g\\.gcf_id ASC$`,
      ));
      expect(osSort({ category: 'PKS', categoryMinShare: '10', sortField: 'categoryShare', sortOrder: dir })[0])
        .toEqual({ category_share_pks: { order: dir, missing: '_last' } });
    }
  });

  it('falls back to the default order with no single category to sort by', async () => {
    const { order } = await sqlFor('sortField=categoryShare&limit=50');
    expect(order).toBe('g.gcf_name ASC, g.gcf_id ASC');
    expect(osSort({ sortField: 'categoryShare' })[0]).toEqual({ gcf_name: { order: 'asc' } });
  });
});

describe('a threshold the backends cannot honour is a 400, not a dropped filter', () => {
  it.each([
    ['no category', 'categoryMinShare=50'],
    ['text naming no category', 'category=PK&categoryMinShare=50'],
    ['a non-number', 'category=PKS&categoryMinShare=most'],
  ])('%s', async (_label, qs) => {
    const { status } = await sqlFor(`${qs}&limit=50`);
    expect(status).toBe(400);
  });
});
