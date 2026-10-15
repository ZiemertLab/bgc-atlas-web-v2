import type { OpenSearchQuery } from './browse-query';
import type { GcfStats } from '@/lib/hooks/use-gcf-stats';

/**
 * Product-category + size distribution for a /gcfs result set, as OpenSearch
 * aggregations over the table's own filter. Mirrors the SQL in /api/gcfs/stats (unfiltered,
 * verified equal to public/data/gcf-charts-45f92b6b06f0c023.json) and reuses the
 * `GcfStats` field names, so the charts consume either source.
 */

/** `product_categories` has 6 values; 30 is slack for a malformed-ingest variant. */
const CATEGORY_TERMS_SIZE = 30;

/** The SQL's `LIMIT 12` on the product query, reproduced so the bars match. */
const CATEGORY_LIMIT = 12;

/** `member_bgc_count` has 2,168 distinct values (one rank-view bucket each); `truncated` reports the cap. */
const SIZE_TERMS_SIZE = 5_000;

/**
 * The six size bins from /api/gcfs/stats. SQL uses inclusive BETWEENs and a range agg's
 * `to` is exclusive, so every upper bound is the SQL's plus one.
 */
const SIZE_RANGES: ReadonlyArray<{ key: string; from: number; to?: number }> = [
  { key: '1-10', from: 1, to: 11 },
  { key: '11-50', from: 11, to: 51 },
  { key: '51-100', from: 51, to: 101 },
  { key: '101-500', from: 101, to: 501 },
  { key: '501-1000', from: 501, to: 1001 },
  { key: '1000+', from: 1001 },
];

export interface GcfDistributionResult extends GcfStats {
  /** Families matching the filter, from `hits.total`. */
  totalGcfs: number;
  /** True if EITHER terms agg hit its size cap: a chart is then under-counting. */
  truncated: boolean;
}

export function buildGcfDistributionRequest(filters: OpenSearchQuery[]): Record<string, unknown> {
  return {
    size: 0,
    track_total_hits: true,
    query: filters.length ? { bool: { filter: filters } } : { match_all: {} },
    aggs: {
      categories: { terms: { field: 'product_categories', size: CATEGORY_TERMS_SIZE } },
      // Six fixed buckets, so no size cap.
      size_bins: {
        range: {
          field: 'member_bgc_count',
          keyed: false,
          ranges: SIZE_RANGES.map(({ key, from, to }) => (to === undefined ? { key, from } : { key, from, to })),
        },
      },
      // The rank view is filtered too, so both views describe the table's families.
      sizes: { terms: { field: 'member_bgc_count', size: SIZE_TERMS_SIZE } },
    },
  };
}

interface RawTermsBucket {
  /** Widened because the parser's parameter is `unknown`: a malformed
   *  round-trip must not throw. */
  key?: string | number;
  doc_count?: number;
}

interface RawResponse {
  hits?: { total?: { value?: number } | number };
  aggregations?: {
    categories?: { buckets?: RawTermsBucket[]; sum_other_doc_count?: number };
    size_bins?: { buckets?: RawTermsBucket[] };
    sizes?: { buckets?: RawTermsBucket[]; sum_other_doc_count?: number };
  };
}

export function parseGcfDistributionResponse(response: unknown): GcfDistributionResult {
  const raw = (response ?? {}) as RawResponse;
  const aggs = raw.aggregations;

  // doc_count DESC, as the SQL's `ORDER BY gcf_count DESC`.
  const categoryDistribution = (aggs?.categories?.buckets ?? [])
    .map((bucket) => ({ category: String(bucket.key ?? ''), count: bucket.doc_count ?? 0 }))
    .filter((row) => row.category !== '')
    .slice(0, CATEGORY_LIMIT);

  // Empty bins are dropped, as SQL's `GROUP BY size_range` emits no row for them.
  const binCounts = new Map(
    (aggs?.size_bins?.buckets ?? []).map((bucket) => [String(bucket.key ?? ''), bucket.doc_count ?? 0]),
  );
  const sizeDistribution = SIZE_RANGES
    .map(({ key }) => ({ range: key, count: binCounts.get(key) ?? 0 }))
    .filter((row) => row.count > 0);

  // Ascending by size, as the SQL; the rank plot reads the array in order.
  const fullSizeDistribution = (aggs?.sizes?.buckets ?? [])
    .map((bucket) => ({ size: Number(bucket.key ?? 0), count: bucket.doc_count ?? 0 }))
    .filter((row) => Number.isFinite(row.size))
    .sort((a, b) => a.size - b.size);

  const total = raw.hits?.total;
  return {
    categoryDistribution,
    sizeDistribution,
    fullSizeDistribution,
    totalGcfs: typeof total === 'number' ? total : total?.value ?? 0,
    // Either cap being hit under-counts a chart.
    truncated: (aggs?.sizes?.sum_other_doc_count ?? 0) > 0
      || (aggs?.categories?.sum_other_doc_count ?? 0) > 0,
  };
}
