import type { TaxonomyRank } from '@/lib/types';
import type { OpenSearchQuery } from './browse-query';
import {
  PRODUCT_CATEGORIES, TOP_TAXA, stripRankPrefix,
  type CompositionRow, type CompositionRowKind,
} from './taxonomy-composition';

/**
 * Dominant-taxon x product-category composition for a /gcfs result set. A family is
 * grouped by its largest taxon at the rank (`dom_<rank>`, share in `dom_<rank>_pct`; see
 * gcf_dominant_taxon.py). A cell is the share of the group's families carrying a class;
 * `product_categories` is multi-label, so no row sums to anything.
 */

/** Purity cutoffs offered in the UI; the share is indexed, so these cost nothing. */
export const PURITY_CUTOFFS = [50, 70, 90] as const;
export type PurityCutoff = (typeof PURITY_CUTOFFS)[number];

export const isPurityCutoff = (value: unknown): value is PurityCutoff =>
  PURITY_CUTOFFS.includes(Number(value) as PurityCutoff);

export interface GcfCompositionResult {
  rank: TaxonomyRank;
  purity: PurityCutoff;
  categories: readonly string[];
  rows: CompositionRow[];
  totalGcfs: number;
  /** Families in the individually-listed taxon rows. */
  shownGcfs: number;
  /** Resolved at this rank but no taxon reaches the cutoff. */
  noDominantGcfs: number;
  /** No taxon resolved at this rank at all. */
  unresolvedGcfs: number;
  distinctTaxa: number;
  maxShare: number;
}

export function buildGcfCompositionRequest(
  rank: TaxonomyRank,
  purity: PurityCutoff,
  filters: OpenSearchQuery[],
): Record<string, unknown> {
  const field = `dom_${rank}`;
  const pctField = `dom_${rank}_pct`;
  const byCategory = { terms: { field: 'product_categories', size: PRODUCT_CATEGORIES.length } };
  const dominant = { range: { [pctField]: { gte: purity } } };

  return {
    size: 0,
    track_total_hits: true,
    query: filters.length ? { bool: { filter: filters } } : { match_all: {} },
    aggs: {
      // Per-category terms also sit at the filter level, so the residual `Other` row is
      // derived by subtraction without a second pass.
      taxa: {
        filter: dominant,
        aggs: {
          t: { terms: { field, size: TOP_TAXA }, aggs: { cls: byCategory } },
          cls: byCategory,
          distinct: { cardinality: { field, precision_threshold: 40000 } },
        },
      },
      // Resolved, but no taxon reaches the cutoff; distinct from unresolved.
      no_dominant: {
        filter: { bool: { must: [{ exists: { field } }], must_not: [dominant] } },
        aggs: { cls: byCategory },
      },
      unresolved: {
        filter: { bool: { must_not: [{ exists: { field } }] } },
        aggs: { cls: byCategory },
      },
    },
  };
}

type CategoryBuckets = { buckets?: Array<{ key: string; doc_count: number }> };

const bucketCounts = (bucket: { cls?: CategoryBuckets }): Record<string, number> => {
  const counts: Record<string, number> = {};
  for (const category of PRODUCT_CATEGORIES) counts[category] = 0;
  for (const b of bucket.cls?.buckets ?? []) {
    if (b.key in counts) counts[b.key] = b.doc_count;
  }
  return counts;
};

const shares = (counts: Record<string, number>, total: number): Record<string, number> => {
  const out: Record<string, number> = {};
  for (const category of PRODUCT_CATEGORIES) out[category] = total > 0 ? counts[category] / total : 0;
  return out;
};

const row = (
  key: string, label: string, kind: CompositionRowKind, count: number, counts: Record<string, number>,
): CompositionRow => ({ key, label, kind, count, counts, shares: shares(counts, count) });

export function parseGcfCompositionResponse(
  rank: TaxonomyRank,
  purity: PurityCutoff,
  response: unknown,
): GcfCompositionResult {
  const source = response as {
    hits?: { total?: { value?: number } | number };
    aggregations?: {
      taxa?: {
        doc_count?: number;
        t?: { buckets?: Array<{ key: string; doc_count: number; cls?: CategoryBuckets }> };
        cls?: CategoryBuckets;
        distinct?: { value?: number };
      };
      no_dominant?: { doc_count?: number; cls?: CategoryBuckets };
      unresolved?: { doc_count?: number; cls?: CategoryBuckets };
    };
  };
  const hitsTotal = source.hits?.total;
  const totalGcfs = typeof hitsTotal === 'number' ? hitsTotal : hitsTotal?.value ?? 0;
  const aggs = source.aggregations ?? {};

  const taxonBuckets = aggs.taxa?.t?.buckets ?? [];
  const rows: CompositionRow[] = taxonBuckets.map((bucket) =>
    row(bucket.key, stripRankPrefix(bucket.key), 'taxon', bucket.doc_count, bucketCounts(bucket)));

  const dominantTotal = aggs.taxa?.doc_count ?? 0;
  const dominantCounts = bucketCounts(aggs.taxa ?? {});
  const shownGcfs = rows.reduce((sum, r) => sum + r.count, 0);
  const distinctTaxa = aggs.taxa?.distinct?.value ?? rows.length;

  // Residual within the dominant-taxon set only.
  const otherGcfs = Math.max(0, dominantTotal - shownGcfs);
  if (otherGcfs > 0) {
    const otherCounts: Record<string, number> = {};
    for (const category of PRODUCT_CATEGORIES) {
      const listed = rows.reduce((sum, r) => sum + r.counts[category], 0);
      otherCounts[category] = Math.max(0, dominantCounts[category] - listed);
    }
    const hidden = Math.max(0, distinctTaxa - rows.length);
    rows.push(row('', hidden > 0 ? `Other (${hidden.toLocaleString()} taxa)` : 'Other', 'other', otherGcfs, otherCounts));
  }

  const noDominantGcfs = aggs.no_dominant?.doc_count ?? 0;
  if (noDominantGcfs > 0) {
    rows.push(row('', `No dominant ${rank}`, 'no-dominant', noDominantGcfs, bucketCounts(aggs.no_dominant ?? {})));
  }

  const unresolvedGcfs = aggs.unresolved?.doc_count ?? 0;
  if (unresolvedGcfs > 0) {
    rows.push(row('', `Not resolved to ${rank}`, 'unresolved', unresolvedGcfs, bucketCounts(aggs.unresolved ?? {})));
  }

  const maxShare = rows.reduce(
    (max, r) => PRODUCT_CATEGORIES.reduce((m, c) => Math.max(m, r.shares[c]), max), 0);

  return {
    rank,
    purity,
    categories: PRODUCT_CATEGORIES,
    rows,
    totalGcfs,
    shownGcfs,
    noDominantGcfs,
    unresolvedGcfs,
    distinctTaxa,
    maxShare,
  };
}
