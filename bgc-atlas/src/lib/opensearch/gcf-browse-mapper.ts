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
  };
}
