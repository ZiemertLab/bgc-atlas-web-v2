import { describe, it, expect } from 'vitest';
import {
  buildCompositionRequest, isTaxonomyRank, parseCompositionResponse,
  PRODUCT_CATEGORIES, stripRankPrefix, TOP_TAXA,
} from '@/lib/opensearch/taxonomy-composition';

const cls = (entries: Record<string, number>) => ({
  buckets: Object.entries(entries).map(([key, doc_count]) => ({ key, doc_count })),
});

const response = {
  hits: { total: { value: 1000 } },
  aggregations: {
    taxa: {
      buckets: [
        { key: 'p__Bacillota', doc_count: 500, cls: cls({ RiPP: 290, terpene: 130 }) },
        { key: 'p__Verrucomicrobiota', doc_count: 200, cls: cls({ terpene: 130, PKS: 32 }) },
      ],
    },
    unresolved: { doc_count: 100, cls: cls({ NRPS: 43, terpene: 20 }) },
    distinct: { value: 12 },
    all_cls: cls({ terpene: 300, RiPP: 310, NRPS: 60, PKS: 40 }),
  },
};

describe('isTaxonomyRank', () => {
  it('accepts the seven GTDB ranks', () => {
    for (const rank of ['domain', 'phylum', 'class', 'order', 'family', 'genus', 'species']) {
      expect(isTaxonomyRank(rank)).toBe(true);
    }
  });

  // The value is interpolated into `tax_${rank}`.
  it('rejects anything else', () => {
    expect(isTaxonomyRank('strain')).toBe(false);
    expect(isTaxonomyRank('phylum ')).toBe(false);
    expect(isTaxonomyRank('')).toBe(false);
    expect(isTaxonomyRank(undefined)).toBe(false);
    expect(isTaxonomyRank(7)).toBe(false);
  });
});

interface CompositionRequest {
  query: Record<string, unknown>;
  aggs: {
    taxa: { terms: { field: string; size: number; missing?: string }; aggs: { cls: { terms: { field: string } } } };
    unresolved: { missing: { field: string } };
  };
}

const request = (...args: Parameters<typeof buildCompositionRequest>) =>
  buildCompositionRequest(...args) as unknown as CompositionRequest;

describe('buildCompositionRequest', () => {
  it('aggregates the selected rank crossed with product category', () => {
    const built = request('genus', []);
    expect(built.aggs.taxa.terms).toEqual({ field: 'tax_genus', size: TOP_TAXA });
    expect(built.aggs.taxa.aggs.cls.terms.field).toBe('product_category');
    expect(built.query).toEqual({ match_all: {} });
  });

  it('reuses the browse filter clause verbatim', () => {
    const filters = [{ term: { product_category: 'NRPS' } }];
    expect(request('phylum', filters).query).toEqual({ bool: { filter: filters } });
  });

  it('counts unresolved BGCs outside the terms agg, not as a bucket in it', () => {
    const built = request('species', []);
    expect(built.aggs.taxa.terms.missing).toBeUndefined();
    expect(built.aggs.unresolved.missing).toEqual({ field: 'tax_species' });
  });
});

describe('parseCompositionResponse', () => {
  const result = parseCompositionResponse('phylum', response);

  it('normalizes each cell against its own row, not the result set', () => {
    const bacillota = result.rows[0];
    expect(bacillota.count).toBe(500);
    expect(bacillota.shares.RiPP).toBeCloseTo(0.58);
    expect(bacillota.shares.terpene).toBeCloseTo(0.26);
    expect(result.rows[1].shares.terpene).toBeCloseTo(0.65);
  });

  it('derives the residual row by subtraction and names its taxon count', () => {
    const other = result.rows.find((r) => r.kind === 'other');
    expect(other?.count).toBe(200);           // 1000 - 700 listed - 100 unresolved
    expect(other?.counts.terpene).toBe(20);      // 300 - 130 - 130 - 20
    expect(other?.counts.RiPP).toBe(20);         // 310 - 290 - 0 - 0
    expect(other?.label).toBe('Other (10 taxa)'); // 12 distinct - 2 listed
  });

  it('labels unresolved as a depth of assignment, not an unknown organism', () => {
    const unresolved = result.rows.find((r) => r.kind === 'unresolved');
    expect(unresolved?.label).toBe('Not resolved to phylum');
    expect(unresolved?.count).toBe(100);
    expect(unresolved?.shares.NRPS).toBeCloseTo(0.43);
  });

  it('reports coverage so the chart can state what it is not showing', () => {
    expect(result.totalBgcs).toBe(1000);
    expect(result.shownBgcs).toBe(700);
    expect(result.unresolvedBgcs).toBe(100);
    expect(result.distinctTaxa).toBe(12);
  });

  it('scales every column against one shared maximum', () => {
    expect(result.maxShare).toBeCloseTo(0.65); // Verrucomicrobiota terpene
  });

  it('strips the rank prefix for display only', () => {
    expect(result.rows[0].key).toBe('p__Bacillota');
    expect(result.rows[0].label).toBe('Bacillota');
    expect(stripRankPrefix('s__Escherichia coli')).toBe('Escherichia coli');
  });

  it('suppresses residual rows that would render as zero', () => {
    const complete = parseCompositionResponse('domain', {
      hits: { total: { value: 300 } },
      aggregations: {
        taxa: { buckets: [{ key: 'd__Bacteria', doc_count: 300, cls: cls({ RiPP: 90 }) }] },
        unresolved: { doc_count: 0, cls: cls({}) },
        distinct: { value: 1 },
        all_cls: cls({ RiPP: 90 }),
      },
    });
    expect(complete.rows).toHaveLength(1);
    expect(complete.rows.some((r) => r.kind === 'other' || r.kind === 'unresolved')).toBe(false);
  });

  it('survives an empty result set without dividing by zero', () => {
    const empty = parseCompositionResponse('phylum', {
      hits: { total: { value: 0 } },
      aggregations: {
        taxa: { buckets: [] }, unresolved: { doc_count: 0 }, distinct: { value: 0 }, all_cls: { buckets: [] },
      },
    });
    expect(empty.rows).toHaveLength(0);
    expect(empty.totalBgcs).toBe(0);
    expect(empty.maxShare).toBe(0);
  });

  it('zero-fills categories absent from a bucket so every row has all six columns', () => {
    for (const row of result.rows) {
      expect(Object.keys(row.counts).sort()).toEqual([...PRODUCT_CATEGORIES].sort());
      expect(row.counts.saccharide).toBe(0);
    }
  });

  it('never renders a negative residual when totals and sub-aggs disagree', () => {
    const skewed = parseCompositionResponse('phylum', {
      hits: { total: { value: 100 } },
      aggregations: {
        taxa: { buckets: [{ key: 'p__X', doc_count: 100, cls: cls({ RiPP: 90 }) }] },
        unresolved: { doc_count: 0, cls: cls({}) },
        distinct: { value: 1 },
        all_cls: cls({ RiPP: 50 }), // lower than the listed taxon's own count
      },
    });
    expect(skewed.rows.every((r) => Object.values(r.counts).every((c) => c >= 0))).toBe(true);
  });
});
