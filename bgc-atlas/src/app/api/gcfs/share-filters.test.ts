import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { buildBrowseSearchRequest, supportsBrowseSearch } from '@/lib/opensearch/browse-query';
import { serializeFilterGroup, type FilterCondition } from '@/lib/filters/types';
import { UnhonourableQueryError } from '@/lib/filters/unhonourable-query';
import { setEcoAnyIndexedForTests } from '@/lib/opensearch/gcf-browse-fields';

/**
 * The Product and Ecosystem share filters (lib/filters/share-fields.ts) on both
 * backends, from the same URL.
 *
 * Parity is pinned STRUCTURALLY: for each condition, the index's clause and the
 * SQL fallback's predicate must name the same precomputed column (gcf_distributions_mv
 * and gcf_browse carry identical threshold arrays) with the
 * same values, and a negative must carry the same "share is defined" guard on
 * both. Counts were checked against the live index and database by hand when
 * this landed (see the commit message).
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

let seq = 0;
const cond = (c: Omit<FilterCondition, 'id'>): FilterCondition => ({ id: `c${seq += 1}`, ...c });
const encode = (...conditions: FilterCondition[]) =>
  serializeFilterGroup({ id: 'g', operator: 'AND', conditions, groups: [] });

async function sql(...conditions: FilterCondition[]): Promise<{ status: number; count: Captured; body: Record<string, unknown> }> {
  captured.length = 0;
  const mod = await import('./route');
  const res = await mod.GET(new Request(`http://localhost/api/gcfs?limit=50&advancedFilters=${encode(...conditions)}`));
  const count = captured.find((c) => /SELECT COUNT\(\*\)/i.test(c.text)) ?? { text: '', values: [] };
  return { status: res.status, count, body: await res.json() as Record<string, unknown> };
}

const os = (...conditions: FilterCondition[]) => {
  const params = new URLSearchParams({ advancedFilters: encode(...conditions) });
  expect(supportsBrowseSearch('gcfs', params)).toBe(true);
  const filters = (buildBrowseSearchRequest('gcfs', params) as { query: { bool: { filter: unknown[] } } })
    .query.bool.filter;
  // The advanced filter is the one entry that is not the listing's own scaffolding.
  return JSON.stringify(filters);
};

beforeEach(() => {
  captured.length = 0;
  vi.stubEnv('OPENSEARCH_BROWSE_ENABLED', 'false');
  vi.stubEnv('OPENSEARCH_BROWSE_GCFS_ENABLED', 'false');
});

/** [condition, column both backends read, values] */
const POSITIVE: Array<[string, Omit<FilterCondition, 'id'>, string, string[]]> = [
  ['product >= 50 %', { field: 'productShare', operator: 'equals', value: 'lanthipeptide-class-i', threshold: 50 },
    'product_types_ge50', ['lanthipeptide-class-i']],
  ['product >= 10 %, any of two', { field: 'productShare', operator: 'in', value: ['NRPS', 'T1PKS'], threshold: 10 },
    'product_types_ge10', ['NRPS', 'T1PKS']],
  ['product >= 90 %', { field: 'productShare', operator: 'equals', value: 'terpene', threshold: 90 },
    'product_types_ge90', ['terpene']],
  ['ecosystem L3 >= 50 %', { field: 'ecoShareL3', operator: 'equals', value: 'Marine', threshold: 50 },
    'eco_l3_ge50', ['Marine']],
  ['ecosystem L1 >= 90 %', { field: 'ecoShareL1', operator: 'equals', value: 'Host-assoc.: Plants', threshold: 90 },
    'eco_l1_ge90', ['Host-assoc.: Plants']],
  ['ecosystem L5 >= 10 %, any of two', { field: 'ecoShareL5', operator: 'in', value: ['Sediment', 'Unclassified'], threshold: 10 },
    'eco_l5_ge10', ['Sediment', 'Unclassified']],
];

describe('a share threshold reads the same precomputed array on both backends', () => {
  it.each(POSITIVE)('%s', async (_name, condition, column, values) => {
    expect(os(cond(condition))).toContain(JSON.stringify({ terms: { [column]: values } }));

    const { status, count } = await sql(cond(condition));
    expect(status).toBe(200);
    expect(flat(count.text)).toContain(`FROM gcf_distributions_mv gdm WHERE gdm.gcf_id = g.gcf_id AND gdm.${column} && ARRAY[`);
    expect(count.values).toEqual(expect.arrayContaining(values));
  });

  it('a missing threshold is the default, 50 %, on both', async () => {
    const bare = { field: 'productShare', operator: 'equals' as const, value: 'NRPS' };
    expect(os(cond(bare))).toContain('"product_types_ge50"');
    expect(flat((await sql(cond(bare))).count.text)).toContain('gdm.product_types_ge50 &&');
  });
});

describe('product threshold 0 is "any member" on both backends', () => {
  it('reads product_terms on the index and the share keys in SQL', async () => {
    const any = cond({ field: 'productShare', operator: 'in', value: ['NRPS', 'T1PKS'], threshold: 0 });
    expect(os(any)).toContain(JSON.stringify({ terms: { product_terms: ['NRPS', 'T1PKS'] } }));
    const { count } = await sql(any);
    expect(flat(count.text)).toContain('jsonb_exists_any(gdm.product_type_member_share, ARRAY[');
    expect(count.values).toEqual(expect.arrayContaining(['NRPS', 'T1PKS']));
    // Not the per-member scan of bgcs it used to be.
    expect(count.text).not.toMatch(/\bbgcs\b/);
  });
});

describe('ecosystem threshold 0 is "any member" on both backends', () => {
  afterEach(() => setEcoAnyIndexedForTests(null));

  it('reads eco_l<n>_any on an index that has it, and the distribution keys in SQL', async () => {
    setEcoAnyIndexedForTests(true);
    const any = cond({ field: 'ecoShareL3', operator: 'in', value: ['Marine', 'Freshwater'], threshold: 0 });
    expect(os(any)).toContain(JSON.stringify({ terms: { eco_l3_any: ['Marine', 'Freshwater'] } }));
    const { status, count } = await sql(any);
    expect(status).toBe(200);
    expect(flat(count.text)).toContain('jsonb_exists_any(gdm.biome_distribution_l3, ARRAY[');
    expect(count.values).toEqual(expect.arrayContaining(['Marine', 'Freshwater']));
  });

  it('a negative carries the same resolved guard as the other thresholds', async () => {
    setEcoAnyIndexedForTests(true);
    const not = cond({ field: 'ecoShareL1', operator: 'not_equals', value: 'Host-assoc.: Plants', threshold: 0 });
    expect(os(not)).toContain(JSON.stringify({
      bool: {
        must_not: [{ terms: { eco_l1_any: ['Host-assoc.: Plants'] } }],
        filter: [{ range: { resolved_pct_l1: { gt: 0 } } }],
      },
    }));
    expect(flat((await sql(not)).count.text))
      .toContain('gdm.resolved_pct_l1 > 0 AND NOT (jsonb_exists_any(gdm.biome_distribution_l1, ARRAY[');
  });

  it('on an index WITHOUT the lists the index does not serve it: SQL answers, never an empty terms query', () => {
    setEcoAnyIndexedForTests(false);
    const params = new URLSearchParams({
      advancedFilters: encode(cond({ field: 'ecoShareL3', operator: 'equals', value: 'Marine', threshold: 0 })),
    });
    expect(supportsBrowseSearch('gcfs', params)).toBe(false);
    // Past the gate only ?study= (force-supported, no SQL fallback) builds it:
    // a refusal that says why, never an empty terms query.
    let thrown: unknown;
    try { buildBrowseSearchRequest('gcfs', params); } catch (error) { thrown = error; }
    expect(thrown).toBeInstanceOf(UnhonourableQueryError);
    expect((thrown as UnhonourableQueryError).conditions).toEqual([
      expect.objectContaining({ field: 'ecoShareL3', reason: 'not_indexed', threshold: 0 }),
    ]);
    expect((thrown as UnhonourableQueryError).message)
      .toContain('field "ecoShareL3": any member is not available on this index yet');
    // Other ecosystem thresholds do not depend on the lists.
    expect(supportsBrowseSearch('gcfs', new URLSearchParams({
      advancedFilters: encode(cond({ field: 'ecoShareL3', operator: 'equals', value: 'Marine', threshold: 50 })),
    }))).toBe(true);
  });
});

describe('a negative is the complement among families the share is defined for', () => {
  it('product: must_not behind exists(product_terms) / NOT behind a non-empty share map', async () => {
    const not = cond({ field: 'productShare', operator: 'not_equals', value: 'NRPS', threshold: 50 });
    expect(os(not)).toContain(JSON.stringify({
      bool: { must_not: [{ terms: { product_types_ge50: ['NRPS'] } }], filter: [{ exists: { field: 'product_terms' } }] },
    }));
    expect(flat((await sql(not)).count.text)).toContain(
      "gdm.product_type_member_share <> '{}'::jsonb AND NOT (gdm.product_types_ge50 && ARRAY[",
    );
  });

  it('ecosystem: guarded by resolved_pct_l<n> > 0 on both', async () => {
    const not = cond({ field: 'ecoShareL3', operator: 'not_in', value: ['Marine', 'Freshwater'], threshold: 10 });
    expect(os(not)).toContain(JSON.stringify({
      bool: {
        must_not: [{ terms: { eco_l3_ge10: ['Marine', 'Freshwater'] } }],
        filter: [{ range: { resolved_pct_l3: { gt: 0 } } }],
      },
    }));
    expect(flat((await sql(not)).count.text)).toContain('gdm.resolved_pct_l3 > 0 AND NOT (gdm.eco_l3_ge10 && ARRAY[');
  });
});

describe('both backends refuse what neither can answer', () => {
  it.each<[string, Omit<FilterCondition, 'id'>, number[], string]>([
    ['an ecosystem threshold that is not offered', { field: 'ecoShareL3', operator: 'equals', value: 'Marine', threshold: 5 },
      [0, 10, 50, 90], 'field "ecoShareL3": ≥ 5 % is not offered; choose 0 (any member), 10, 50 or 90 %'],
    ['a threshold that is not offered', { field: 'productShare', operator: 'equals', value: 'NRPS', threshold: 25 },
      [0, 10, 50, 90], 'field "productShare": ≥ 25 % is not offered; choose 0 (any member), 10, 50 or 90 %'],
  ])('%s: unsupported_threshold, the same shape on both', async (_name, condition, offered, message) => {
    // The threshold, not the value: the reader is sent to the threshold control.
    const refusal = {
      field: condition.field, operator: condition.operator, reason: 'unsupported_threshold',
      value: condition.value, threshold: condition.threshold, supportedThresholds: offered,
    };

    const params = new URLSearchParams({ advancedFilters: encode(cond(condition)) });
    let thrown: unknown;
    try { buildBrowseSearchRequest('gcfs', params); } catch (error) { thrown = error; }
    expect(thrown).toBeInstanceOf(UnhonourableQueryError);
    expect((thrown as UnhonourableQueryError).conditions).toEqual([refusal]);
    expect((thrown as UnhonourableQueryError).message).toContain(message);

    const { status, body } = await sql(cond(condition));
    expect(status).toBe(400);
    expect(body.rejected).toEqual([refusal]);
    expect(String(body.message)).toContain(message);
  });

  it('a substring operator, which the share fields do not offer', async () => {
    const params = new URLSearchParams({
      advancedFilters: encode(cond({ field: 'productShare', operator: 'contains', value: 'lanthi', threshold: 0 })),
    });
    // The gate sends it to SQL, which refuses it -- not an answer from either.
    expect(supportsBrowseSearch('gcfs', params)).toBe(false);
    const { status } = await sql(cond({ field: 'productShare', operator: 'contains', value: 'lanthi', threshold: 0 }));
    expect(status).toBe(400);
  });
});

describe('an old productClass link is answered on both backends as it was', () => {
  it('contains lanthi -> any member carries one of the matching types', async () => {
    const old = cond({ field: 'productClass', operator: 'contains', value: 'lanthi' });
    const types = [
      'lanthipeptide-class-i', 'lanthipeptide-class-ii', 'lanthipeptide-class-iii',
      'lanthipeptide-class-iv', 'lanthipeptide-class-v', 'lipolanthine',
    ];
    expect(os(old)).toContain(JSON.stringify({ terms: { product_terms: types } }));
    const { status, count } = await sql(old);
    expect(status).toBe(200);
    expect(flat(count.text)).toContain('jsonb_exists_any(gdm.product_type_member_share, ARRAY[');
    expect(count.values).toEqual(expect.arrayContaining(types));
  });

  it('not_contains nrps -> no member carries any type the ILIKE matched, among families with a product', async () => {
    const old = cond({ field: 'productClass', operator: 'not_contains', value: 'nrps' });
    // t3nrps-iterative too: case-insensitive substring, as the ILIKE was.
    expect(os(old)).toContain('"must_not":[{"terms":{"product_terms":["NRPS","NRPS-like","t3nrps-iterative"]}}]');
    expect(flat((await sql(old)).count.text))
      .toContain("gdm.product_type_member_share <> '{}'::jsonb AND NOT (jsonb_exists_any(");
  });
});
