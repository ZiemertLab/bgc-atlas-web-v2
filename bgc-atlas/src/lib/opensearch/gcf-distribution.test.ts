import { describe, it, expect } from 'vitest';
import {
  buildGcfDistributionRequest, parseGcfDistributionResponse,
} from '@/lib/opensearch/gcf-distribution';

interface GcfDistributionRequest {
  size: number;
  track_total_hits: boolean;
  query: Record<string, unknown>;
  aggs: {
    categories: { terms: { field: string; size: number } };
    size_bins: { range: { field: string; keyed: boolean; ranges: Array<{ key: string; from: number; to?: number }> } };
    sizes: { terms: { field: string; size: number } };
  };
}

const request = (...args: Parameters<typeof buildGcfDistributionRequest>) =>
  buildGcfDistributionRequest(...args) as unknown as GcfDistributionRequest;

const terms = (entries: Array<[string | number, number]>, other = 0) => ({
  buckets: entries.map(([key, doc_count]) => ({ key, doc_count })),
  sum_other_doc_count: other,
});

/**
 * The unfiltered corpus response, matching public/data/gcf-charts-45f92b6b06f0c023.json;
 * the parser must leave these figures alone.
 */
const corpusResponse = {
  hits: { total: { value: 617926 } },
  aggregations: {
    categories: terms([
      ['terpene', 197291], ['RiPP', 165016], ['NRPS', 119437],
      ['PKS', 100570], ['other', 98919], ['saccharide', 1189],
    ]),
    size_bins: {
      buckets: [
        { key: '1-10', from: 1, to: 11, doc_count: 482979 },
        { key: '11-50', from: 11, to: 51, doc_count: 101855 },
        { key: '51-100', from: 51, to: 101, doc_count: 16323 },
        { key: '101-500', from: 101, to: 501, doc_count: 13413 },
        { key: '501-1000', from: 501, to: 1001, doc_count: 1758 },
        { key: '1000+', from: 1001, doc_count: 1598 },
      ],
    },
    sizes: terms([[3, 200000], [1, 150000], [153259, 1]]),
  },
};

describe('buildGcfDistributionRequest', () => {
  it('tallies product categories off the multi-label family field', () => {
    expect(request([]).aggs.categories.terms.field).toBe('product_categories');
  });

  // SQL bounds are BETWEEN-inclusive and a range agg's `to` is exclusive: each upper bound is SQL's + 1.
  it('reproduces the six size bins from /api/gcfs/stats, exclusive-upper', () => {
    expect(request([]).aggs.size_bins.range).toMatchObject({
      field: 'member_bgc_count',
      ranges: [
        { key: '1-10', from: 1, to: 11 },
        { key: '11-50', from: 11, to: 51 },
        { key: '51-100', from: 51, to: 101 },
        { key: '101-500', from: 101, to: 501 },
        { key: '501-1000', from: 501, to: 1001 },
        // No `to`: the SQL's `member_bgc_count > 1000` is open-ended.
        { key: '1000+', from: 1001 },
      ],
    });
  });

  it('aggregates the rank view over the same filtered set, with headroom over the measured 2,168 sizes', () => {
    const built = request([]);
    expect(built.aggs.sizes.terms.field).toBe('member_bgc_count');
    expect(built.aggs.sizes.terms.size).toBeGreaterThanOrEqual(2168 * 2);
  });

  it('reuses the browse filter clause verbatim, and asks for an exact total', () => {
    const filters = [{ range: { member_bgc_count: { gte: 10 } } }];
    const built = request(filters);
    expect(built.query).toEqual({ bool: { filter: filters } });
    expect(built.size).toBe(0);
    // Without it a set over 10,000 families reports 10,000 and every caption lies.
    expect(built.track_total_hits).toBe(true);
  });

  it('matches everything when nothing is narrowing the set', () => {
    expect(request([]).query).toEqual({ match_all: {} });
  });
});

describe('parseGcfDistributionResponse', () => {
  it('reproduces the corpus figures unchanged', () => {
    const parsed = parseGcfDistributionResponse(corpusResponse);
    expect(parsed.categoryDistribution).toEqual([
      { category: 'terpene', count: 197291 },
      { category: 'RiPP', count: 165016 },
      { category: 'NRPS', count: 119437 },
      { category: 'PKS', count: 100570 },
      { category: 'other', count: 98919 },
      { category: 'saccharide', count: 1189 },
    ]);
    expect(parsed.sizeDistribution).toEqual([
      { range: '1-10', count: 482979 },
      { range: '11-50', count: 101855 },
      { range: '51-100', count: 16323 },
      { range: '101-500', count: 13413 },
      { range: '501-1000', count: 1758 },
      { range: '1000+', count: 1598 },
    ]);
    expect(parsed.totalGcfs).toBe(617926);
    // Sums to 110% of families because `product_categories` is multi-label; the parser must not "fix" it.
    expect(parsed.categoryDistribution.reduce((sum, r) => sum + r.count, 0)).toBe(682422);
    // The size bins are one-per-family, so these DO sum to the total.
    expect(parsed.sizeDistribution.reduce((sum, r) => sum + r.count, 0)).toBe(617926);
  });

  it('sorts the rank view ascending by size, as the SQL does', () => {
    expect(parseGcfDistributionResponse(corpusResponse).fullSizeDistribution).toEqual([
      { size: 1, count: 150000 },
      { size: 3, count: 200000 },
      { size: 153259, count: 1 },
    ]);
  });

  it('drops an empty size bin rather than drawing it at zero', () => {
    const parsed = parseGcfDistributionResponse({
      hits: { total: { value: 1598 } },
      aggregations: {
        categories: terms([['NRPS', 900]]),
        size_bins: {
          buckets: [
            { key: '1-10', doc_count: 0 },
            { key: '11-50', doc_count: 0 },
            { key: '51-100', doc_count: 0 },
            { key: '101-500', doc_count: 0 },
            { key: '501-1000', doc_count: 0 },
            { key: '1000+', doc_count: 1598 },
          ],
        },
        sizes: terms([[1200, 1598]]),
      },
    });
    expect(parsed.sizeDistribution).toEqual([{ range: '1000+', count: 1598 }]);
  });

  it('flags truncation from either terms agg', () => {
    expect(parseGcfDistributionResponse(corpusResponse).truncated).toBe(false);
    expect(parseGcfDistributionResponse({
      ...corpusResponse,
      aggregations: { ...corpusResponse.aggregations, sizes: terms([[1, 10]], 7) },
    }).truncated).toBe(true);
    expect(parseGcfDistributionResponse({
      ...corpusResponse,
      aggregations: { ...corpusResponse.aggregations, categories: terms([['NRPS', 10]], 3) },
    }).truncated).toBe(true);
  });

  it('reads an empty or malformed response as empty rather than throwing', () => {
    for (const response of [undefined, null, {}, { aggregations: {} }, { hits: { total: 42 } }]) {
      const parsed = parseGcfDistributionResponse(response);
      expect(parsed.categoryDistribution).toEqual([]);
      expect(parsed.sizeDistribution).toEqual([]);
      expect(parsed.fullSizeDistribution).toEqual([]);
      expect(parsed.truncated).toBe(false);
    }
    // A bare `hits.total` number, which older OpenSearch clients return.
    expect(parseGcfDistributionResponse({ hits: { total: 42 } }).totalGcfs).toBe(42);
  });
});
