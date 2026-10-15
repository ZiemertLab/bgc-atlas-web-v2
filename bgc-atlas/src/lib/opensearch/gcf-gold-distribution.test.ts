import { describe, expect, it } from 'vitest';
import {
  buildGcfGoldDistributionRequest, parseGcfGoldDistributionResponse,
} from './gcf-gold-distribution';

describe('buildGcfGoldDistributionRequest', () => {
  it('filters to the family, drops missing and empty paths, and takes the top 50', () => {
    const body = buildGcfGoldDistributionRequest('cc897cac-2221-53f0-9e44-1e5b7cda93ff') as {
      size: number;
      query: { bool: { filter: unknown[]; must_not: unknown[] } };
      aggs: { paths: { terms: { field: string; size: number } } };
    };
    expect(body.size).toBe(0);
    expect(body.query.bool.filter).toContainEqual({ term: { gcf_id: 'cc897cac-2221-53f0-9e44-1e5b7cda93ff' } });
    expect(body.query.bool.filter).toContainEqual({ exists: { field: 'gold_ecosystem_path' } });
    expect(body.query.bool.must_not).toContainEqual({ term: { gold_ecosystem_path: '' } });
    expect(body.aggs.paths.terms).toEqual({ field: 'gold_ecosystem_path', size: 50 });
  });
});

describe('parseGcfGoldDistributionResponse', () => {
  it('maps buckets to path counts in bucket order', () => {
    expect(parseGcfGoldDistributionResponse({
      aggregations: { paths: { buckets: [
        { key: 'Environmental:Aquatic:Marine', doc_count: 12 },
        { key: 'Host-associated:Plants:Roots', doc_count: 3 },
      ] } },
    })).toEqual([
      { gold_ecosystem_path: 'Environmental:Aquatic:Marine', bgc_count: 12 },
      { gold_ecosystem_path: 'Host-associated:Plants:Roots', bgc_count: 3 },
    ]);
  });

  it('returns no rows for a family with no ecosystem data', () => {
    expect(parseGcfGoldDistributionResponse({ aggregations: { paths: { buckets: [] } } })).toEqual([]);
  });

  it('throws on a response without the aggregation, so the route falls back to SQL', () => {
    expect(() => parseGcfGoldDistributionResponse({ error: 'index_not_found' })).toThrow();
  });
});
