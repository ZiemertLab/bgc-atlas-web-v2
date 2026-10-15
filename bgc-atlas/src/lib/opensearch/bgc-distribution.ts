import type { OpenSearchQuery } from './browse-query';

/**
 * Class + grouped distribution for a /bgcs result set, as OpenSearch aggregations
 * over the table's own filter. Differs from the Postgres MVs it replaces: no COALESCE
 * fallback (see DISTRIBUTION_VARIANTS), and a BGC with no biome summary row lands in
 * `Unknown` rather than vanishing.
 */

export const OTHERS_LABEL = 'Others';
export const UNKNOWN_LABEL = 'Unknown';
export const UNCLASSIFIED_LABEL = 'Unclassified';

/** Matches LIMIT in the snapshot generator, not the live /api/statistics/bgcs (default 30, cap 100). */
export const DEFAULT_LIMIT = 20;

/**
 * Max grouping cardinality is ~5,000 (environment_feature). The index has one shard,
 * so the agg is exact and top-N + Others is computed from the full bucket list.
 */
const GROUP_TERMS_SIZE = 10_000;

/** product_category has 6 values; 30 is slack for a malformed-ingest variant. */
const CLASS_TERMS_SIZE = 30;

/**
 * product_type (the antiSMASH class) had 99 values on 2026-10-12; 500 keeps the
 * terms agg exact on the single shard with room for new antiSMASH classes.
 */
const PRODUCT_TYPE_TERMS_SIZE = 500;

interface VariantSpec {
  field: string;
  /** Set for gold_level_N: bucket keys are full paths, rolled up to this depth. */
  goldLevel?: 1 | 2 | 3 | 4 | 5;
}

/**
 * Keyed as `variantKey()` in BgcCharts.client.tsx and the snapshot's `byVariant`.
 * environment/feature/material skip the MVs' COALESCE fallback chain: each level costs
 * a full doc-values scan for ~3% of documents, which land in Unknown instead.
 */
export const DISTRIBUTION_VARIANTS = {
  biome_1: { field: 'resolved_biome_level_1' },
  biome_2: { field: 'resolved_biome_level_2' },
  biome_3: { field: 'resolved_biome_level_3' },
  biome_4: { field: 'resolved_biome_level_4' },
  environment: { field: 'environment_biome' },
  feature: { field: 'environment_feature' },
  material: { field: 'environment_material' },
  gold_level_1: { field: 'gold_ecosystem_path', goldLevel: 1 },
  gold_level_2: { field: 'gold_ecosystem_path', goldLevel: 2 },
  gold_level_3: { field: 'gold_ecosystem_path', goldLevel: 3 },
  gold_level_4: { field: 'gold_ecosystem_path', goldLevel: 4 },
  gold_level_5: { field: 'gold_ecosystem_path', goldLevel: 5 },
} as const satisfies Record<string, VariantSpec>;

export type DistributionVariant = keyof typeof DISTRIBUTION_VARIANTS;

const VARIANT_SET = new Set<string>(Object.keys(DISTRIBUTION_VARIANTS));

/** Rejects an unknown variant so the route answers 400 rather than 500. */
export function isDistributionVariant(value: unknown): value is DistributionVariant {
  return typeof value === 'string' && VARIANT_SET.has(value);
}

export interface ChartBucket {
  name: string;
  complete: number;
  partial: number;
}

/** An antiSMASH class row, with the category most of its BGCs carry (for its colour). */
export interface ProductClassBucket extends ChartBucket {
  category?: string;
}

export interface DistributionResult {
  variant: DistributionVariant;
  /**
   * product_category tallies, unaffected by `variant`. Multi-label, so these are
   * class assignments summing past `totalBgcs`; never render them as a total.
   */
  categoryDistribution: ChartBucket[];
  /**
   * antiSMASH class (`product_type`) tallies, top-N plus `Others` — the left
   * chart's Class view. Present only when requested (`withClasses`): the agg
   * costs ~2.6s unfiltered and most views never open it. Multi-label like the
   * categories, so these too are assignments, not BGCs.
   */
  classDistribution?: ProductClassBucket[];
  /** The grouped tallies — the right-hand chart. Top-N plus one `Others` row. */
  distribution: ChartBucket[];
  totalBgcs: number;
  /**
   * The sum of `distribution`. Below `totalBgcs` only for GOLD variants, which drop
   * a BGC whose path does not reach the level. A header stating a count must use this.
   */
  chartedBgcs: number;
  /** True if EITHER terms agg hit its size cap: a chart is then under-counting. */
  truncated: boolean;
}

export function buildDistributionRequest(
  variant: DistributionVariant,
  filters: OpenSearchQuery[],
  options: { withClasses?: boolean } = {},
): Record<string, unknown> {
  const spec: VariantSpec | undefined = DISTRIBUTION_VARIANTS[variant];
  if (!spec) throw new Error(`unknown distribution variant: ${variant}`);
  const completeSplit = { complete: { filter: { term: { is_complete: true } } } };
  return {
    size: 0,
    track_total_hits: true,
    query: filters.length ? { bool: { filter: filters } } : { match_all: {} },
    aggs: {
      classes: {
        terms: { field: 'product_category', size: CLASS_TERMS_SIZE, missing: UNCLASSIFIED_LABEL },
        aggs: completeSplit,
      },
      groups: {
        terms: {
          field: spec.field,
          size: GROUP_TERMS_SIZE,
          // No GOLD path: absent from the GOLD charts, matching the MV's
          // `WHERE gold_ecosystem_path IS NOT NULL`.
          ...(spec.goldLevel ? {} : { missing: UNKNOWN_LABEL }),
        },
        aggs: completeSplit,
      },
      ...(options.withClasses ? {
        productClasses: {
          terms: { field: 'product_type', size: PRODUCT_TYPE_TERMS_SIZE },
          aggs: {
            ...completeSplit,
            // The class's colour: the category most of its BGCs carry. A hybrid
            // BGC counts toward every category it has, which is what "most" means
            // for a multi-label field.
            category: { terms: { field: 'product_category', size: 1 } },
          },
        },
      } : {}),
    },
  };
}

interface RawBucket {
  /** Optional and widened because the parser's parameter is `unknown`: a
   *  malformed round-trip must not throw at `.split`. */
  key?: string | number;
  doc_count: number;
  complete?: { doc_count: number };
  category?: { buckets?: Array<{ key?: string | number }> };
}

interface RawResponse {
  hits?: { total?: { value?: number } | number };
  aggregations?: {
    classes?: { buckets?: RawBucket[]; sum_other_doc_count?: number };
    groups?: { buckets?: RawBucket[]; sum_other_doc_count?: number };
    productClasses?: { buckets?: RawBucket[]; sum_other_doc_count?: number };
  };
}

/** `root: Environmental` -> `Environmental`. Mirrors cleanLabel() in /api/statistics/bgcs. */
const cleanLabel = (value: string | null | undefined): string => {
  if (!value) return UNKNOWN_LABEL;
  const stripped = value.replace(/^root:\s*/i, '').trim();
  return stripped.length > 0 ? stripped : UNKNOWN_LABEL;
};

const accumulate = (into: Map<string, ChartBucket>, name: string, total: number, complete: number) => {
  const row = into.get(name) ?? { name, complete: 0, partial: 0 };
  row.complete += complete;
  row.partial += total - complete;
  into.set(name, row);
};

/** Ranks by complete DESC, partial DESC, name, as withOthersDistribution() in /api/statistics/bgcs. */
const rankAndCap = (rows: ChartBucket[], limit: number): ChartBucket[] => {
  const sorted = [...rows].sort(
    (a, b) => b.complete - a.complete || b.partial - a.partial || a.name.localeCompare(b.name),
  );
  const head = sorted.slice(0, limit);
  const tail = sorted.slice(limit);
  if (tail.length === 0) return head;
  return [...head, {
    name: OTHERS_LABEL,
    complete: tail.reduce((sum, row) => sum + row.complete, 0),
    partial: tail.reduce((sum, row) => sum + row.partial, 0),
  }];
};

/**
 * Merge brace-wrapped / case-variant class labels into the dominant spelling (copied
 * from generate-bgc-charts-snapshot.ts). Canonical labels are mixed-case, so casing is not forced.
 */
export const normalizeClassDistribution = (rows: ChartBucket[]): ChartBucket[] => {
  const merged = new Map<string, ChartBucket>();
  for (const row of rows) {
    const cleaned = row.name.replace(/[{}]/g, '').trim() || UNCLASSIFIED_LABEL;
    const key = cleaned.toLowerCase();
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, { name: cleaned, complete: row.complete, partial: row.partial });
      continue;
    }
    if (row.complete + row.partial > existing.complete + existing.partial) {
      existing.name = cleaned;
    }
    existing.complete += row.complete;
    existing.partial += row.partial;
  }
  return Array.from(merged.values()).sort(
    (a, b) => b.complete - a.complete || b.partial - a.partial || a.name.localeCompare(b.name),
  );
};

export function parseDistributionResponse(
  variant: DistributionVariant,
  response: unknown,
  limit: number = DEFAULT_LIMIT,
): DistributionResult {
  const raw = (response ?? {}) as RawResponse;
  const spec: VariantSpec = DISTRIBUTION_VARIANTS[variant];
  const groups = raw.aggregations?.groups?.buckets ?? [];

  const rows = new Map<string, ChartBucket>();
  for (const bucket of groups) {
    const complete = bucket.complete?.doc_count ?? 0;
    const key = String(bucket.key ?? '');
    if (spec.goldLevel) {
      const parts = key.split(':');
      // A path that does not reach this level is absent from the chart, not Unknown (as in the MV).
      if (parts.length < spec.goldLevel || !parts[spec.goldLevel - 1].trim()) continue;
      accumulate(rows, cleanLabel(parts.slice(0, spec.goldLevel).join(':')), bucket.doc_count, complete);
    } else {
      accumulate(rows, cleanLabel(key), bucket.doc_count, complete);
    }
  }

  const classRows = (raw.aggregations?.classes?.buckets ?? []).map((bucket) => ({
    name: String(bucket.key ?? ''),
    complete: bucket.complete?.doc_count ?? 0,
    partial: bucket.doc_count - (bucket.complete?.doc_count ?? 0),
  }));

  // Classes rank by total, not complete-first: there is no MV ordering to
  // match, and a reader of "top 20 classes" means the 20 most frequent.
  const productClasses = raw.aggregations?.productClasses;
  let classDistribution: ProductClassBucket[] | undefined;
  if (productClasses) {
    const all = (productClasses.buckets ?? []).map((bucket) => ({
      name: String(bucket.key ?? '').replace(/[{}]/g, '').trim() || UNCLASSIFIED_LABEL,
      complete: bucket.complete?.doc_count ?? 0,
      partial: bucket.doc_count - (bucket.complete?.doc_count ?? 0),
      category: bucket.category?.buckets?.[0]?.key !== undefined ? String(bucket.category.buckets[0].key) : undefined,
    })).sort((a, b) => b.complete + b.partial - (a.complete + a.partial) || a.name.localeCompare(b.name));
    const tail = all.slice(limit);
    classDistribution = tail.length === 0 ? all : [...all.slice(0, limit), {
      name: OTHERS_LABEL,
      complete: tail.reduce((sum, row) => sum + row.complete, 0),
      partial: tail.reduce((sum, row) => sum + row.partial, 0),
    }];
  }

  // Summed AFTER the Others fold, so the tail counts: `Others` is drawn.
  const distribution = rankAndCap(Array.from(rows.values()), limit);
  const total = raw.hits?.total;
  return {
    variant,
    categoryDistribution: normalizeClassDistribution(classRows).slice(0, limit),
    ...(classDistribution ? { classDistribution } : {}),
    distribution,
    totalBgcs: typeof total === 'number' ? total : total?.value ?? 0,
    chartedBgcs: distribution.reduce((sum, r) => sum + r.complete + r.partial, 0),
    // Either agg hitting its size cap under-counts a chart.
    truncated: (raw.aggregations?.groups?.sum_other_doc_count ?? 0) > 0
      || (raw.aggregations?.classes?.sum_other_doc_count ?? 0) > 0
      || (productClasses?.sum_other_doc_count ?? 0) > 0,
  };
}
