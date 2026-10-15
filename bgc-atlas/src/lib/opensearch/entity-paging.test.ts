import { describe, it, expect } from 'vitest';
import { ENTITY_CAP, aggSize, slicePage, pageIsCapped } from '@/lib/opensearch/entity-paging';

describe('entity result paging', () => {
  it('requests exactly enough buckets to cover the requested page', () => {
    expect(aggSize(1, 25)).toBe(25);
    expect(aggSize(2, 25)).toBe(50);
    expect(aggSize(4, 25)).toBe(100);
  });

  it('never requests more than the cap', () => {
    expect(aggSize(ENTITY_CAP, 25)).toBe(ENTITY_CAP);
    expect(aggSize(1, 100_000)).toBe(ENTITY_CAP);
  });

  it('asks for the real page size below the cap, not the cap', () => {
    // A deep page still ships every bucket up to it, so page 1 does not request the ceiling.
    expect(aggSize(100, 25)).toBe(2_500);
    expect(aggSize(1_000, 25)).toBe(25_000);
  });

  it('stays under the cluster bucket limit', () => {
    // `search.max_buckets` is 65,535; the cap keeps headroom for family-scope sub-aggregations.
    expect(ENTITY_CAP).toBeLessThan(65_535);
  });

  it('slices the requested page out of the returned buckets', () => {
    const buckets = Array.from({ length: 60 }, (_, i) => ({ key: `k${i}`, doc_count: 60 - i }));
    expect(slicePage(buckets, 1, 25).map((b) => b.key)).toEqual(
      Array.from({ length: 25 }, (_, i) => `k${i}`));
    expect(slicePage(buckets, 3, 25).map((b) => b.key)).toEqual(['k50', 'k51', 'k52', 'k53', 'k54',
      'k55', 'k56', 'k57', 'k58', 'k59']);
  });

  it('returns an empty page past the end rather than throwing', () => {
    expect(slicePage([{ key: 'a', doc_count: 1 }], 5, 25)).toEqual([]);
  });

  it('flags a page that sits beyond the cap', () => {
    expect(pageIsCapped(1, 25)).toBe(false);
    expect(pageIsCapped(ENTITY_CAP / 25, 25)).toBe(false);
    expect(pageIsCapped(ENTITY_CAP / 25 + 1, 25)).toBe(true);
  });
});
