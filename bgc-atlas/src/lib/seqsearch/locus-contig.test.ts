import { describe, expect, it, vi } from 'vitest';

/**
 * A contig-map locus is a span of ONE contig. In a multi-FASTA nucleotide search every
 * contig shares coordinates, so filtering by the span alone returned hits at the same
 * positions on every contig. The contig (the hits' query_id there) travels with it.
 */

const { cacheKeys } = vi.hoisted(() => ({ cacheKeys: [] as string[] }));
vi.mock('@/lib/prisma', () => ({ default: { $queryRaw: vi.fn(async () => []) } }));
vi.mock('@/lib/opensearch/client', () => ({ bgcFacetDocs: vi.fn(async () => new Map()), sampleBrowseDocs: vi.fn(async () => new Map()) }));
vi.mock('@/lib/cache', () => ({
  getOrSetCache: (key: string, fn: () => unknown) => { cacheKeys.push(key); return fn(); },
}));

import { filterConditions, hitFiltersFromSearchParams, parseHitFilters } from './database';
import { getSequenceSampleMap } from './sample-map';

const sqlText = (parts: { strings: readonly string[] }[]) => parts.map((p) => p.strings.join('?')).join(' AND ');

describe('hit filters carry the locus contig', () => {
  it('parseHitFilters keeps a queryId', () => {
    expect(parseHitFilters({ queryFrom: 1, queryTo: 9, queryId: 'contig_2' })).toEqual({
      minIdentity: undefined, minCoverage: undefined, queryFrom: 1, queryTo: 9, queryId: 'contig_2',
    });
  });

  it.each([[''], [42], ['x'.repeat(1001)]])('ignores a queryId of %j', (queryId) => {
    expect(parseHitFilters({ queryId }).queryId).toBeUndefined();
  });

  it('reads a query string the same way', () => {
    const f = hitFiltersFromSearchParams(new URLSearchParams('minIdentity=50&queryFrom=10&queryTo=20&queryId=c%201'));
    expect(f).toMatchObject({ minIdentity: 50, queryFrom: 10, queryTo: 20, queryId: 'c 1' });
  });

  it('narrows the SQL to that contig', () => {
    const sql = sqlText(filterConditions('s', { queryFrom: 10, queryTo: 20, queryId: 'contig_2' }));
    expect(sql).toMatch(/r\.query_id = \?/);
    expect(sql).toMatch(/least\(r\.query_start, r\.query_end\) <= \?/);
  });
});

describe('sample map', () => {
  it('keys its cache on the contig, so two contigs at one span do not share a map', async () => {
    cacheKeys.length = 0;
    const filters = { queryFrom: 10, queryTo: 20 };
    await getSequenceSampleMap('s', { ...filters, queryId: 'contig_1' }, true);
    await getSequenceSampleMap('s', { ...filters, queryId: 'contig_2' }, true);
    expect(new Set(cacheKeys).size).toBe(2);
  });
});
