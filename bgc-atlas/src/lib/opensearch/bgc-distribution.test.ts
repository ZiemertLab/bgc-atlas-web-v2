import { describe, it, expect } from 'vitest';
import {
  buildDistributionRequest, isDistributionVariant, parseDistributionResponse,
  DISTRIBUTION_VARIANTS, OTHERS_LABEL, UNKNOWN_LABEL,
} from '@/lib/opensearch/bgc-distribution';

/** Shape mirrors the live index: a keyword terms agg with a `complete` filter sub-agg. */
const bucket = (key: string, total: number, complete: number) =>
  ({ key, doc_count: total, complete: { doc_count: complete } });

const response = (groups: unknown[], classes: unknown[] = [], total = 1000) => ({
  hits: { total: { value: total } },
  aggregations: {
    classes: { buckets: classes },
    groups: { buckets: groups, sum_other_doc_count: 0 },
  },
});

describe('isDistributionVariant', () => {
  it('accepts every variant the chart dropdown can produce', () => {
    for (const key of Object.keys(DISTRIBUTION_VARIANTS)) {
      expect(isDistributionVariant(key)).toBe(true);
    }
  });

  it('rejects anything else', () => {
    expect(isDistributionVariant('gold_level_6')).toBe(false);
    expect(isDistributionVariant('biome_1 ')).toBe(false);
    expect(isDistributionVariant('resolved_biome_level_1')).toBe(false);
    expect(isDistributionVariant('')).toBe(false);
    expect(isDistributionVariant(undefined)).toBe(false);
    expect(isDistributionVariant(3)).toBe(false);
  });
});

interface DistributionRequest {
  track_total_hits: boolean;
  query: Record<string, unknown>;
  aggs: {
    classes: { terms: { field: string; size: number; missing?: string } };
    groups: { terms: { field: string; size: number; missing?: string } };
  };
}

const request = (...args: Parameters<typeof buildDistributionRequest>) =>
  buildDistributionRequest(...args) as unknown as DistributionRequest;

describe('buildDistributionRequest', () => {
  it('gives no-value docs their own bucket for the non-GOLD variants', () => {
    const req = request('material', []);
    expect(req.aggs.groups.terms.field).toBe('environment_material');
    expect(req.aggs.groups.terms.missing).toBe(UNKNOWN_LABEL);
  });

  // The MV is built WHERE gold_ecosystem_path IS NOT NULL, so there is no 'Unknown' bar.
  it('drops no-value docs for the GOLD variants', () => {
    const req = request('gold_level_2', []);
    expect(req.aggs.groups.terms.field).toBe('gold_ecosystem_path');
    expect(req.aggs.groups.terms.missing).toBeUndefined();
  });

  it('carries the table filter clause through untouched', () => {
    const filters = [{ term: { tax_phylum: 'p__Bacillota' } }];
    const req = request('biome_1', filters);
    expect(req.query).toEqual({ bool: { filter: filters } });
    expect(req.track_total_hits).toBe(true);
  });

  it('matches all documents when nothing is filtering', () => {
    expect(request('biome_1', []).query).toEqual({ match_all: {} });
  });
});

describe('parseDistributionResponse', () => {
  it('ranks by complete desc, then partial desc, then name', () => {
    const parsed = parseDistributionResponse('biome_1', response([
      bucket('low-complete', 900, 10),
      bucket('high-complete', 100, 90),
    ]), 1);
    expect(parsed.distribution[0].name).toBe('high-complete');
  });

  it('sums everything past the limit into one Others row', () => {
    const groups = Array.from({ length: 25 }, (_, i) => bucket(`b${i}`, 100 - i, 100 - i));
    const parsed = parseDistributionResponse('biome_1', response(groups), 20);
    expect(parsed.distribution).toHaveLength(21);
    const others = parsed.distribution[20];
    expect(others.name).toBe(OTHERS_LABEL);
    expect(others.complete).toBe(groups.slice(20).reduce((s, b) => s + b.complete.doc_count, 0));
  });

  it('omits the Others row when nothing overflows', () => {
    const parsed = parseDistributionResponse('biome_1', response([bucket('only', 5, 5)]), 20);
    expect(parsed.distribution.map((r) => r.name)).toEqual(['only']);
  });

  // cleanLabel() in the route strips this; the MV stores `root:Host-associated`.
  it('strips the root: prefix and empty labels', () => {
    const parsed = parseDistributionResponse('biome_1', response([
      bucket('root:Host-associated', 10, 4),
      bucket('   ', 2, 1),
    ]), 20);
    expect(parsed.distribution.map((r) => r.name)).toContain('Host-associated');
    expect(parsed.distribution.map((r) => r.name)).toContain(UNKNOWN_LABEL);
  });

  it('merges labels that differ only by the root: prefix', () => {
    const parsed = parseDistributionResponse('biome_1', response([
      bucket('root:Environmental', 1000, 400),
      bucket('Environmental', 250, 100),
    ]), 20);
    expect(parsed.distribution).toHaveLength(1);
    expect(parsed.distribution[0]).toMatchObject({ name: 'Environmental', complete: 500, partial: 750 });
  });

  it('rolls GOLD paths up to the requested level', () => {
    const parsed = parseDistributionResponse('gold_level_2', response([
      bucket('Environmental:Aquatic:Marine', 100, 40),
      bucket('Environmental:Aquatic:Freshwater', 50, 20),
      bucket('Environmental:Terrestrial:Soil', 30, 10),
    ]), 20);
    expect(parsed.distribution).toEqual([
      { name: 'Environmental:Aquatic', complete: 60, partial: 90 },
      { name: 'Environmental:Terrestrial', complete: 10, partial: 20 },
    ]);
  });

  it('drops GOLD paths shallower than the requested level', () => {
    const parsed = parseDistributionResponse('gold_level_3', response([
      bucket('Environmental:Aquatic', 100, 40),
      bucket('Environmental:Aquatic:Marine', 10, 4),
    ]), 20);
    expect(parsed.distribution).toEqual([
      { name: 'Environmental:Aquatic:Marine', complete: 4, partial: 6 },
    ]);
  });

  it('reports the matched BGC total for the chart header', () => {
    const parsed = parseDistributionResponse('biome_1', response([bucket('x', 5, 5)], [], 424242), 20);
    expect(parsed.totalBgcs).toBe(424242);
  });

  // Malformed ingests have produced a stray `{nrps}` bucket alongside `NRPS`.
  it('merges brace-wrapped and case-variant class labels into the dominant one', () => {
    const parsed = parseDistributionResponse('biome_1', response([], [
      bucket('NRPS', 100, 40), bucket('{nrps}', 10, 4),
    ]), 20);
    expect(parsed.categoryDistribution).toEqual([{ name: 'NRPS', complete: 44, partial: 66 }]);
  });

  // If cardinality ever exceeds size, Others would silently under-count.
  it('flags truncation when the terms agg dropped buckets', () => {
    const r = response([bucket('x', 5, 5)]);
    r.aggregations.groups.sum_other_doc_count = 17;
    expect(parseDistributionResponse('biome_1', r, 20).truncated).toBe(true);
  });
});

describe('chartedBgcs', () => {
  // gold_level_5 charts only about a fifth of the matched set.
  it('counts only what the chart actually draws, for GOLD', () => {
    const parsed = parseDistributionResponse('gold_level_2', response([
      bucket('Environmental:Aquatic', 100, 40),
      bucket('Environmental', 900, 300),          // too shallow -> dropped
    ], [], 1000), 20);
    expect(parsed.chartedBgcs).toBe(100);
    expect(parsed.totalBgcs).toBe(1000);
  });

  it('equals the total when every document is bucketed', () => {
    const parsed = parseDistributionResponse('biome_1', response([
      bucket('a', 600, 100), bucket('b', 400, 50),
    ], [], 1000), 20);
    expect(parsed.chartedBgcs).toBe(1000);
  });

  it('still counts documents folded into Others', () => {
    const groups = Array.from({ length: 25 }, (_, i) => bucket(`b${i}`, 10, 5));
    expect(parseDistributionResponse('biome_1', response(groups), 20).chartedBgcs).toBe(250);
  });
});

describe('malformed input', () => {
  // A failed round-trip should yield an empty chart, not a 500.
  it.each([null, undefined, {}, { aggregations: {} }])('survives %p', (input) => {
    const parsed = parseDistributionResponse('biome_1', input, 20);
    expect(parsed.distribution).toEqual([]);
    expect(parsed.totalBgcs).toBe(0);
    expect(parsed.chartedBgcs).toBe(0);
  });

  it('tolerates a bucket with no key', () => {
    const parsed = parseDistributionResponse('biome_1', response([
      { doc_count: 5, complete: { doc_count: 2 } } as never,
    ]), 20);
    expect(parsed.distribution[0].name).toBe(UNKNOWN_LABEL);
    // The GOLD branch is where a missing key actually reaches `.split`.
    expect(parseDistributionResponse('gold_level_1', response([
      { doc_count: 5, complete: { doc_count: 2 } } as never,
    ]), 20).distribution).toEqual([]);
  });

  // The one branch of the GOLD rollup live data never exercises.
  it('keeps a GOLD path with an empty interior segment at a level it reaches', () => {
    const parsed = parseDistributionResponse('gold_level_3', response([bucket('A::C', 10, 4)]), 20);
    expect(parsed.distribution[0].name).toBe('A::C');
    expect(parseDistributionResponse('gold_level_2', response([bucket('A::C', 10, 4)]), 20).distribution).toEqual([]);
  });
});

describe('buildDistributionRequest guard', () => {
  it('throws a named error rather than dereferencing undefined', () => {
    expect(() => buildDistributionRequest('nope' as never, []))
      .toThrow(/unknown distribution variant: nope/);
  });
});

describe('truncation', () => {
  it('flags a truncated class aggregation too', () => {
    const r = response([bucket('x', 5, 5)], [bucket('NRPS', 5, 5)]);
    r.aggregations.classes = { ...r.aggregations.classes, sum_other_doc_count: 3 } as never;
    expect(parseDistributionResponse('biome_1', r, 20).truncated).toBe(true);
  });
});

describe('categoryDistribution', () => {
  it('honours the limit', () => {
    const classes = Array.from({ length: 9 }, (_, i) => bucket(`c${i}`, 100 - i, 100 - i));
    expect(parseDistributionResponse('biome_1', response([], classes), 5).categoryDistribution).toHaveLength(5);
  });
});

describe('antiSMASH class tallies (withClasses)', () => {
  const classBucket = (key: string, total: number, complete: number, category?: string) => ({
    ...bucket(key, total, complete),
    category: { buckets: category ? [{ key: category, doc_count: total }] : [] },
  });
  const withClasses = (classes: unknown[], sumOther = 0) => ({
    ...response([bucket('Environmental', 10, 5)]),
    aggregations: {
      ...response([bucket('Environmental', 10, 5)]).aggregations,
      productClasses: { buckets: classes, sum_other_doc_count: sumOther },
    },
  });

  it('adds the product_type agg only when asked', () => {
    const plain = buildDistributionRequest('gold_level_1', []) as { aggs: Record<string, unknown> };
    const asked = buildDistributionRequest('gold_level_1', [], { withClasses: true }) as {
      aggs: Record<string, { terms: { field: string } }>;
    };
    expect(plain.aggs.productClasses).toBeUndefined();
    expect(asked.aggs.productClasses.terms.field).toBe('product_type');
  });

  it('leaves classDistribution absent when the agg was not run', () => {
    expect(parseDistributionResponse('gold_level_1', response([])).classDistribution).toBeUndefined();
  });

  it('ranks by total, carries the dominant category, and folds the tail into Others', () => {
    const result = parseDistributionResponse('gold_level_1', withClasses([
      classBucket('NRPS', 50, 40, 'NRPS'),
      classBucket('terpene-precursor', 90, 5, 'terpene'),
      classBucket('T1PKS', 30, 10, 'PKS'),
    ]), 2);
    expect(result.classDistribution).toEqual([
      { name: 'terpene-precursor', complete: 5, partial: 85, category: 'terpene' },
      { name: 'NRPS', complete: 40, partial: 10, category: 'NRPS' },
      { name: OTHERS_LABEL, complete: 10, partial: 20 },
    ]);
  });

  it('flags truncation when the class agg dropped buckets', () => {
    expect(parseDistributionResponse('gold_level_1', withClasses([classBucket('NRPS', 5, 1, 'NRPS')], 3)).truncated).toBe(true);
  });
});
