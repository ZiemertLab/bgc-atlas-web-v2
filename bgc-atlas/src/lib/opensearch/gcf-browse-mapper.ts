type Document = Record<string, unknown>;

const numberOr = (value: unknown, fallback = 0): number => {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
};

const nullableNumber = (value: unknown): number | null =>
  value === null || value === undefined ? null : numberOr(value, 0);

const arrayOfStrings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];

const recordOfNumbers = (value: unknown): Record<string, number> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value).flatMap(([key, item]) => Number.isFinite(Number(item)) ? [[key, Number(item)]] : []),
  );
};

const recordOfRecords = (value: unknown): Record<string, Record<string, number>> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, recordOfNumbers(item)]));
};

const ECOSYSTEM_LEVELS = [1, 2, 3, 4, 5] as const;

/** Values listed by share threshold: `{10: [...], 50: [...], 90: [...]}`. */
export type ShareThresholdSets = Record<10 | 50 | 90, string[]>;

/**
 * The family share fields (product-type and ecosystem member shares).
 *
 * All-or-nothing, gated on `product_type_member_share`: the patch and the corpus
 * write it on every family (`{}` included), while the threshold arrays are ABSENT
 * when empty in a patched index. So its presence is what says the index carries
 * the share fields, and an absent array then means "nothing clears T". Without it
 * -- an index from before the patch, or a Postgres-built document -- none of these
 * keys is set, and `undefined` reads "not indexed yet", never "no share".
 */
export function mapShareFields(document: Document) {
  const share = document.product_type_member_share;
  if (!share || typeof share !== 'object' || Array.isArray(share)) return {};
  const byThreshold = (prefix: string): ShareThresholdSets => ({
    10: arrayOfStrings(document[`${prefix}10`]),
    50: arrayOfStrings(document[`${prefix}50`]),
    90: arrayOfStrings(document[`${prefix}90`]),
  });
  const perLevel = <T,>(read: (level: number) => T): Record<number, T> =>
    Object.fromEntries(ECOSYSTEM_LEVELS.map((level) => [level, read(level)]));
  return {
    /** {product: % of primary members carrying it}, 2 dp; overlapping. */
    productTypeMemberShare: recordOfNumbers(share),
    /** Products carried by >= 10/50/90 % of primary members. */
    productTypesAtLeast: byThreshold('product_types_ge'),
    /** Ecosystems holding >= 10/50/90 % of the members WITH a level-n ecosystem. */
    ecosystemsAtLeastByLevel: perLevel((level) => byThreshold(`eco_l${level}_ge`)),
    /** % of primary members that have a level-n ecosystem: the denominator above. */
    ecosystemResolvedPctByLevel: perLevel((level) => nullableNumber(document[`resolved_pct_l${level}`])),
    /**
     * Argmax at level n and its share of RESOLVED members (max_pct_l<n>).
     * max_pct is rounded to 1 dp; the eco_l<n>_ge<T> arrays come from the 2-dp
     * share. Never test `pct >= T` to decide threshold membership: 49.96 displays
     * as 50.0 here yet is correctly NOT in eco_l<n>_ge50. Read the arrays.
     */
    dominantEcosystemByLevel: perLevel((level) => {
      const ecosystem = document[`dom_ecosystem_l${level}`];
      return typeof ecosystem === 'string'
        ? { ecosystem, pct: nullableNumber(document[`max_pct_l${level}`]) }
        : null;
    }),
  };
}

export function mapGcfBrowseDocument(document: Document) {
  const id = String(document.gcf_id ?? '');
  return {
    id,
    name: typeof document.gcf_name === 'string' ? document.gcf_name : `GCF_${id.slice(0, 8)}`,
    clusterMethod: typeof document.cluster_method === 'string' ? document.cluster_method : null,
    // v3 tier: 'seed' | 'fragmented'.
    familyClass: typeof document.family_class === 'string' ? document.family_class : null,
    listed: typeof document.listed === 'boolean' ? document.listed : null,
    // Display-only alias from the indexed document, never recomputed.
    petName: typeof document.pet_name === 'string' ? document.pet_name : null,
    representativeBgcId: typeof document.representative_bgc_id === 'string' ? document.representative_bgc_id : null,
    description: typeof document.description === 'string' ? document.description : null,
    memberBgcCount: numberOr(document.member_bgc_count),
    assemblyCount: numberOr(document.assembly_count),
    completeBgcCount: numberOr(document.complete_bgc_count),
    partialBgcCount: numberOr(document.partial_bgc_count),
    // BiG-SLiCE membership distance stats; lower = better.
    avgDistance: nullableNumber(document.avg_distance),
    minDistance: nullableNumber(document.min_distance),
    maxDistance: nullableNumber(document.max_distance),
    medianDistance: nullableNumber(document.median_distance),
    uniqueProductCategories: numberOr(document.unique_product_categories),
    productCategories: arrayOfStrings(document.product_categories),
    uniqueTaxaCount: numberOr(document.unique_taxa_count),
    // Assignment route counts: seed / derived / novel.
    seedAssignments: numberOr(document.seed_assignments),
    derivedAssignments: numberOr(document.derived_assignments),
    novelAssignments: numberOr(document.novel_assignments),
    biomeDistributionByLevel: {
      1: recordOfNumbers(document.biome_distribution_l1),
      2: recordOfNumbers(document.biome_distribution_l2),
      3: recordOfNumbers(document.biome_distribution_l3),
      4: recordOfNumbers(document.biome_distribution_l4),
      5: recordOfNumbers(document.biome_distribution_l5),
    },
    // `mibigAnchored` is read from the indexed boolean, not inferred from the arrays,
    // which are absent on documents indexed before the field existed.
    mibigAnchored: document.mibig_anchored === true,
    mibigAccessions: arrayOfStrings(document.mibig_accessions),
    mibigCompounds: arrayOfStrings(document.mibig_compounds),
    productCategoryDistribution: recordOfNumbers(document.product_category_distribution),
    productTypeDistribution: recordOfNumbers(document.product_type_distribution),
    taxonomyDistribution: recordOfNumbers(document.taxonomy_distribution),
    taxonomyDistributionByRank: recordOfRecords(document.taxonomy_distributions),
    // Counts come from the summary fields (equal by construction). No max_len (an older
    // document) makes the whole block null.
    lengthStats: document.max_len === null || document.max_len === undefined
      ? null
      : {
          medianCompleteLen: nullableNumber(document.median_complete_len),
          minLen: nullableNumber(document.min_len),
          maxLen: nullableNumber(document.max_len),
          completeCount: numberOr(document.complete_bgc_count),
          memberCount: numberOr(document.member_bgc_count),
        },
    ...mapShareFields(document),
  };
}
