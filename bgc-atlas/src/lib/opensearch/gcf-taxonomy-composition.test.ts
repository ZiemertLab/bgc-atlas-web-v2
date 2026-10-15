import { describe, it, expect } from 'vitest';
import {
  buildGcfCompositionRequest, isPurityCutoff, parseGcfCompositionResponse, PURITY_CUTOFFS,
} from '@/lib/opensearch/gcf-taxonomy-composition';
import { TOP_TAXA } from '@/lib/opensearch/taxonomy-composition';

const cls = (entries: Record<string, number>) => ({
  buckets: Object.entries(entries).map(([key, doc_count]) => ({ key, doc_count })),
});

/** 1000 families: 700 in two listed taxa, 150 more with a dominant taxon, 100 fragmented, 50 unresolved. */
const response = {
  hits: { total: { value: 1000 } },
  aggregations: {
    taxa: {
      doc_count: 850,
      t: {
        buckets: [
          { key: 'p__Actinomycetota', doc_count: 500, cls: cls({ RiPP: 140, terpene: 135 }) },
          { key: 'p__Bacillota', doc_count: 200, cls: cls({ RiPP: 128, terpene: 24 }) },
        ],
      },
      cls: cls({ RiPP: 300, terpene: 200, NRPS: 60 }),
      distinct: { value: 9 },
    },
    no_dominant: { doc_count: 100, cls: cls({ NRPS: 61, RiPP: 20 }) },
    unresolved: { doc_count: 50, cls: cls({ terpene: 25 }) },
  },
};

describe('isPurityCutoff', () => {
  it('accepts the offered cutoffs and rejects anything else', () => {
    for (const cutoff of PURITY_CUTOFFS) expect(isPurityCutoff(cutoff)).toBe(true);
    expect(isPurityCutoff('70')).toBe(true); // arrives as a query-string value
    expect(isPurityCutoff(55)).toBe(false);
    expect(isPurityCutoff('most')).toBe(false);
    expect(isPurityCutoff(undefined)).toBe(false);
  });
});

interface GcfRequest {
  query: Record<string, unknown>;
  aggs: {
    taxa: {
      filter: { range: Record<string, { gte: number }> };
      aggs: { t: { terms: { field: string; size: number } }; cls: { terms: { field: string } } };
    };
    no_dominant: { filter: { bool: { must: unknown[]; must_not: unknown[] } } };
    unresolved: { filter: { bool: { must_not: unknown[] } } };
  };
}

const request = (...args: Parameters<typeof buildGcfCompositionRequest>) =>
  buildGcfCompositionRequest(...args) as unknown as GcfRequest;

describe('buildGcfCompositionRequest', () => {
  it('groups families by the indexed dominant taxon for the chosen rank', () => {
    const built = request('genus', 50, []);
    expect(built.aggs.taxa.aggs.t.terms).toEqual({ field: 'dom_genus', size: TOP_TAXA });
    expect(built.aggs.taxa.aggs.cls.terms.field).toBe('product_categories');
  });

  // The cutoff applies at query time against the indexed share, so the UI can move it without a reindex.
  it('applies the purity cutoff as a range on the indexed share', () => {
    expect(request('phylum', 70, []).aggs.taxa.filter).toEqual({ range: { dom_phylum_pct: { gte: 70 } } });
    expect(request('phylum', 90, []).aggs.taxa.filter).toEqual({ range: { dom_phylum_pct: { gte: 90 } } });
  });

  it('reuses the browse filter clause verbatim', () => {
    const filters = [{ term: { product_categories: 'NRPS' } }];
    expect(request('phylum', 50, filters).query).toEqual({ bool: { filter: filters } });
  });

  it('separates fragmented families from families with no taxon at this rank', () => {
    const built = request('phylum', 50, []);
    expect(built.aggs.no_dominant.filter.bool.must).toEqual([{ exists: { field: 'dom_phylum' } }]);
    expect(built.aggs.no_dominant.filter.bool.must_not).toEqual([{ range: { dom_phylum_pct: { gte: 50 } } }]);
    expect(built.aggs.unresolved.filter.bool.must_not).toEqual([{ exists: { field: 'dom_phylum' } }]);
  });
});

describe('parseGcfCompositionResponse', () => {
  const result = parseGcfCompositionResponse('phylum', 50, response);

  it('normalizes each cell against its own row of families', () => {
    expect(result.rows[0].count).toBe(500);
    expect(result.rows[0].shares.RiPP).toBeCloseTo(0.28);
    expect(result.rows[1].shares.RiPP).toBeCloseTo(0.64);
  });

  // The residual comes from the dominant set only, or fragmented/unresolved families double-count.
  it('derives Other from the dominant subset, not the whole result set', () => {
    const other = result.rows.find((r) => r.kind === 'other');
    expect(other?.count).toBe(150);        // 850 dominant - 700 listed
    expect(other?.counts.RiPP).toBe(32);   // 300 - 140 - 128
    expect(other?.counts.NRPS).toBe(60);   // 60 - 0 - 0
    expect(other?.label).toBe('Other (7 taxa)');
  });

  it('gives fragmented families their own row, labelled as having no majority', () => {
    const mixed = result.rows.find((r) => r.kind === 'no-dominant');
    expect(mixed?.label).toBe('No dominant phylum');
    expect(mixed?.count).toBe(100);
    expect(mixed?.shares.NRPS).toBeCloseTo(0.61);
  });

  it('keeps unresolved families separate from fragmented ones', () => {
    const unresolved = result.rows.find((r) => r.kind === 'unresolved');
    expect(unresolved?.label).toBe('Not resolved to phylum');
    expect(unresolved?.count).toBe(50);
  });

  it('accounts for every family exactly once', () => {
    const summed = result.rows.reduce((sum, r) => sum + r.count, 0);
    expect(summed).toBe(result.totalGcfs);
    expect(result.shownGcfs + result.noDominantGcfs + result.unresolvedGcfs).toBeLessThanOrEqual(result.totalGcfs);
  });

  it('scales every column against one shared maximum', () => {
    expect(result.maxShare).toBeCloseTo(0.64); // Bacillota RiPP
  });

  it('suppresses residual rows that would render as zero', () => {
    const clean = parseGcfCompositionResponse('domain', 50, {
      hits: { total: { value: 300 } },
      aggregations: {
        taxa: {
          doc_count: 300,
          t: { buckets: [{ key: 'd__Bacteria', doc_count: 300, cls: cls({ RiPP: 90 }) }] },
          cls: cls({ RiPP: 90 }),
          distinct: { value: 1 },
        },
        no_dominant: { doc_count: 0, cls: cls({}) },
        unresolved: { doc_count: 0, cls: cls({}) },
      },
    });
    expect(clean.rows).toHaveLength(1);
    expect(clean.rows.some((r) => r.kind !== 'taxon')).toBe(false);
  });

  it('survives an empty result set without dividing by zero', () => {
    const empty = parseGcfCompositionResponse('phylum', 50, {
      hits: { total: { value: 0 } },
      aggregations: {
        taxa: { doc_count: 0, t: { buckets: [] }, cls: { buckets: [] }, distinct: { value: 0 } },
        no_dominant: { doc_count: 0 },
        unresolved: { doc_count: 0 },
      },
    });
    expect(empty.rows).toHaveLength(0);
    expect(empty.totalGcfs).toBe(0);
    expect(empty.maxShare).toBe(0);
  });

  it('reports the cutoff it was computed at', () => {
    expect(parseGcfCompositionResponse('phylum', 90, response).purity).toBe(90);
  });
});
