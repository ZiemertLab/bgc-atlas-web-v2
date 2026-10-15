import type { TaxonomyRank } from '@/lib/types';
import type { OpenSearchQuery } from './browse-query';

// A cell is the share of one taxon's BGCs carrying a class. product_category is
// multi-label, so tallies exceed the BGC count and cannot be stacked or summed.

export const TAXONOMY_RANKS: readonly TaxonomyRank[] = [
  'domain', 'phylum', 'class', 'order', 'family', 'genus', 'species',
];

const RANK_SET = new Set<string>(TAXONOMY_RANKS);

// `rank` is interpolated into a field name.
export function isTaxonomyRank(value: unknown): value is TaxonomyRank {
  return typeof value === 'string' && RANK_SET.has(value);
}

// Fixed order (not derived from the response) so columns don't reshuffle when filters change.
export const PRODUCT_CATEGORIES = ['terpene', 'RiPP', 'NRPS', 'PKS', 'other', 'saccharide'] as const;

export const TOP_TAXA = 15;

// `no-dominant` is GCF-only: a family resolved at this rank whose taxa none reach the purity cutoff.
export type CompositionRowKind = 'taxon' | 'other' | 'no-dominant' | 'unresolved';

export interface CompositionRow {
  /** Raw indexed value, e.g. `p__Bacillota`. Empty for the residual rows. */
  key: string;
  label: string;
  kind: CompositionRowKind;
  /** BGCs on /bgcs, families on /gcfs. */
  count: number;
  counts: Record<string, number>;
  /** counts[c] / count, 0..1. */
  shares: Record<string, number>;
}

export interface CompositionResult {
  rank: TaxonomyRank;
  categories: readonly string[];
  rows: CompositionRow[];
  totalBgcs: number;
  shownBgcs: number;
  unresolvedBgcs: number;
  /** Approximate above ~40k (HLL cardinality). */
  distinctTaxa: number;
  maxShare: number;
}

// Dropped so paging or sorting the table doesn't refetch (or re-key) the chart.
const VIEW_ONLY_PARAMS = new Set(['limit', 'offset', 'sortField', 'sortOrder', 'sortFields', 'sortOrders']);

export function compositionQueryParams(
  params: Record<string, unknown>,
  own: Record<string, string | number>,
): Record<string, string> {
  const query: Record<string, string> = {};
  for (const [key, value] of Object.entries(params)) {
    if (VIEW_ONLY_PARAMS.has(key)) continue;
    if (value === undefined || value === null || value === '') continue;
    if (Array.isArray(value)) continue;
    query[key] = String(value);
  }
  for (const [key, value] of Object.entries(own)) query[key] = String(value);
  return query;
}

export function buildCompositionRequest(rank: TaxonomyRank, filters: OpenSearchQuery[]): Record<string, unknown> {
  const field = `tax_${rank}`;
  const byCategory = { terms: { field: 'product_category', size: PRODUCT_CATEGORIES.length } };
  return {
    size: 0,
    track_total_hits: true,
    query: filters.length ? { bool: { filter: filters } } : { match_all: {} },
    aggs: {
      taxa: { terms: { field, size: TOP_TAXA }, aggs: { cls: byCategory } },
      // Separate `missing` agg, not `terms.missing`, so unresolved doesn't take a top-N slot.
      unresolved: { missing: { field }, aggs: { cls: byCategory } },
      distinct: { cardinality: { field, precision_threshold: 40000 } },
      // Per-class totals, so the `Other` row's breakdown can be derived by subtraction.
      all_cls: byCategory,
    },
  };
}

interface TermsBucket { key: string; doc_count: number; cls?: { buckets?: Array<{ key: string; doc_count: number }> } }

const bucketCounts = (bucket: { cls?: { buckets?: Array<{ key: string; doc_count: number }> } }): Record<string, number> => {
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

export const stripRankPrefix = (value: string): string => value.replace(/^[a-z]__/, '');

const row = (key: string, label: string, kind: CompositionRowKind, count: number, counts: Record<string, number>): CompositionRow =>
  ({ key, label, kind, count, counts, shares: shares(counts, count) });

export function parseCompositionResponse(rank: TaxonomyRank, response: unknown): CompositionResult {
  const source = (response ?? {}) as {
    hits?: { total?: { value?: number } | number };
    aggregations?: {
      taxa?: { buckets?: TermsBucket[] };
      unresolved?: { doc_count?: number; cls?: { buckets?: Array<{ key: string; doc_count: number }> } };
      distinct?: { value?: number };
      all_cls?: { buckets?: Array<{ key: string; doc_count: number }> };
    };
  };
  const hitsTotal = source.hits?.total;
  const totalBgcs = typeof hitsTotal === 'number' ? hitsTotal : hitsTotal?.value ?? 0;
  const aggs = source.aggregations ?? {};

  const taxonBuckets = aggs.taxa?.buckets ?? [];
  const rows: CompositionRow[] = taxonBuckets.map((bucket) =>
    row(bucket.key, stripRankPrefix(bucket.key), 'taxon', bucket.doc_count, bucketCounts(bucket)));

  const unresolvedBgcs = aggs.unresolved?.doc_count ?? 0;
  const unresolvedCounts = bucketCounts(aggs.unresolved ?? {});

  // Clamped at zero so a shard-level discrepancy never renders as a negative bar.
  const totals = bucketCounts({ cls: { buckets: aggs.all_cls?.buckets ?? [] } });
  const shownBgcs = rows.reduce((sum, r) => sum + r.count, 0);
  const otherCounts: Record<string, number> = {};
  for (const category of PRODUCT_CATEGORIES) {
    const listed = rows.reduce((sum, r) => sum + r.counts[category], 0);
    otherCounts[category] = Math.max(0, totals[category] - listed - unresolvedCounts[category]);
  }
  const otherBgcs = Math.max(0, totalBgcs - shownBgcs - unresolvedBgcs);
  const distinctTaxa = aggs.distinct?.value ?? rows.length;

  if (otherBgcs > 0) {
    const hidden = Math.max(0, distinctTaxa - rows.length);
    rows.push(row('', hidden > 0 ? `Other (${hidden.toLocaleString()} taxa)` : 'Other', 'other', otherBgcs, otherCounts));
  }
  if (unresolvedBgcs > 0) {
    rows.push(row('', `Not resolved to ${rank}`, 'unresolved', unresolvedBgcs, unresolvedCounts));
  }

  // One shared ramp across every cell so lightness is comparable between columns.
  const maxShare = rows.reduce(
    (max, r) => PRODUCT_CATEGORIES.reduce((m, c) => Math.max(m, r.shares[c]), max), 0);

  return {
    rank,
    categories: PRODUCT_CATEGORIES,
    rows,
    totalBgcs,
    shownBgcs,
    unresolvedBgcs,
    distinctTaxa,
    maxShare,
  };
}
