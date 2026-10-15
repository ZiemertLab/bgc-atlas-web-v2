import type { FilterFieldDefinition, FilterOperator, FilterFieldType } from '@/lib/filters/types';

const baseOperators: Record<FilterFieldType, FilterOperator[]> = {
  text: ['contains', 'not_contains', 'equals', 'not_equals', 'starts_with', 'ends_with'],
  number: ['equals', 'not_equals', 'gt', 'gte', 'lt', 'lte', 'between'],
  select: ['equals', 'not_equals', 'in', 'not_in'],
};

const withDefaults = (fields: Array<Omit<FilterFieldDefinition, 'allowedOperators' | 'defaultOperator'> & {
  allowedOperators?: FilterOperator[];
  defaultOperator?: FilterOperator;
}>): FilterFieldDefinition[] =>
  fields.map((field) => ({
    ...field,
    allowedOperators: field.allowedOperators ?? baseOperators[field.type],
    defaultOperator: field.defaultOperator ?? baseOperators[field.type][0],
  }));

export const sampleFilterFields = withDefaults([
  { id: 'id', label: 'Sample ID', type: 'text', description: 'Sample UUID or external ID' },
  { id: 'environment', label: 'Environment', type: 'text' },
  { id: 'biome', label: 'Biome', type: 'text', allowedOperators: ['contains', 'equals', 'starts_with', 'ends_with'] },
  { id: 'goldEcosystem', label: 'GOLD Ecosystem', type: 'text' },
  { id: 'environmentFeature', label: 'Environment Feature', type: 'text' },
  { id: 'environmentMaterial', label: 'Environment Material', type: 'text' },
  { id: 'host', label: 'Host', type: 'text' },
  { id: 'dataSource', label: 'Data Source', type: 'text', allowedOperators: ['contains', 'equals', 'starts_with', 'ends_with'] },
  { id: 'study', label: 'Study', type: 'text', allowedOperators: ['contains', 'equals', 'starts_with', 'ends_with'] },
  { id: 'assemblies', label: 'Assemblies', type: 'number' },
  { id: 'bgcs', label: 'BGC Count', type: 'number' },
  // A sample with no sample_gcf_counts_mv row counts as 0 on both backends; EXISTS would make
  // `= 0` match nothing in SQL while matching thousands on the index.
  { id: 'gcfCount', label: 'GCF Count', type: 'number', description: 'Distinct GCFs among this sample\u2019s BGCs' },
  { id: 'clusteredBgcCount', label: 'Clustered BGCs', type: 'number' },
  { id: 'unclusteredBgcCount', label: 'Unclustered BGCs', type: 'number', description: 'BGCs with no GCF \u2014 usually contig-edge fragments, not novelty' },
  { id: 'lat', label: 'Latitude', type: 'number' },
  { id: 'lon', label: 'Longitude', type: 'number' },
  // The values `samples.source_types` holds (SOURCE_TYPES in lib/api/samples-query.ts), not
  // imported because that module pulls in @prisma/client; pinned by field-definitions.test.ts.
  { id: 'sourceType', label: 'Source Type', type: 'select', options: [
    { label: 'isolate', value: 'isolate' },
    { label: 'MAG', value: 'MAG' },
    { label: 'SAG', value: 'SAG' },
    { label: 'metagenome', value: 'metagenome' },
  ], allowedOperators: ['equals', 'not_equals', 'in', 'not_in'] },
]);

export const bgcFilterFields = withDefaults([
  { id: 'id', label: 'BGC ID', type: 'text' },
  { id: 'assembly', label: 'Assembly', type: 'text' },
  { id: 'sampleId', label: 'Sample ID', type: 'text', allowedOperators: ['contains', 'equals', 'starts_with', 'ends_with'] },
  { id: 'sample', label: 'Sample Text', type: 'text', description: 'Sample name or external ID', allowedOperators: ['contains', 'equals', 'starts_with', 'ends_with'] },
  { id: 'gcf', label: 'GCF ID', type: 'text' },
  { id: 'productCategory', label: 'Category', type: 'text', allowedOperators: ['contains', 'equals', 'starts_with', 'ends_with'] },
  { id: 'productType', label: 'Product', type: 'text', allowedOperators: ['contains', 'equals', 'starts_with', 'ends_with'] },
  // No "Unknown" option: neither backend can honour it, so offering it would be offering a 400.
  { id: 'completeness', label: 'Completeness', type: 'select', options: [
    { label: 'Complete', value: 'complete' },
    { label: 'Partial', value: 'partial' },
  ], allowedOperators: ['equals', 'not_equals'], defaultOperator: 'equals' },
  { id: 'biome', label: 'Biome', type: 'text' },
  // The GOLD path, not a synonym for `biome`, which ORs seven columns across two vocabularies
  // and cannot serve a negation.
  { id: 'goldEcosystem', label: 'GOLD Ecosystem', type: 'text' },
  { id: 'taxonomy', label: 'Taxonomy', type: 'text' },
  { id: 'length', label: 'Length (bp)', type: 'number' },
  { id: 'genes', label: '# Genes', type: 'number' },
  // bgc_gcf.distance: raw BiG-SLiCE distance, lower = better.
  { id: 'distance', label: 'GCF distance', type: 'number' },
]);

// Columns almost never populated (center_name, study_type, primary_biome) are not offered: a filter
// that matches nothing is worse than none.
export const studyFilterFields = withDefaults([
  { id: 'title', label: 'Title', type: 'text', description: 'Matches the study title or its name' },
  { id: 'bioproject', label: 'BioProject', type: 'text', placeholder: 'PRJNA…' },
  { id: 'accession', label: 'Accession', type: 'text' },
  {
    id: 'goldBucket',
    label: 'Biome',
    type: 'select',
    description: 'Top-level GOLD ecosystem for the study',
    options: [
      { label: 'Environmental', value: 'Environmental' },
      { label: 'Host-associated', value: 'Host-associated' },
      { label: 'Engineered', value: 'Engineered' },
    ],
    allowedOperators: ['equals', 'not_equals', 'in', 'not_in'],
  },
  {
    id: 'productCategory',
    label: 'Product category',
    type: 'select',
    description: 'Study contains at least one BGC of this antiSMASH category',
    options: [
      { label: 'terpene', value: 'terpene' },
      { label: 'RiPP', value: 'RiPP' },
      { label: 'PKS', value: 'PKS' },
      { label: 'NRPS', value: 'NRPS' },
      { label: 'saccharide', value: 'saccharide' },
      { label: 'other', value: 'other' },
    ],
    allowedOperators: ['equals', 'not_equals', 'in', 'not_in'],
  },
  { id: 'exclusiveGcfs', label: 'Exclusive GCFs', type: 'number', description: 'GCFs found in this study and no other' },
  { id: 'rareGcfs', label: 'Rare GCFs', type: 'number', description: 'GCFs occurring in at most 3 studies' },
  { id: 'distinctGcfs', label: 'Distinct GCFs', type: 'number' },
  { id: 'totalBgcs', label: 'Total BGCs', type: 'number' },
  { id: 'clusteredBgcs', label: 'Clustered BGCs', type: 'number' },
  { id: 'gcfCoverage', label: 'GCF coverage (%)', type: 'number', description: 'Percent of the study’s BGCs assigned to a GCF (0–100)' },
  { id: 'pctComplete', label: '% Complete', type: 'number', description: 'Percent of BGCs not truncated at a contig edge (0–100)' },
  { id: 'productTypeCount', label: 'Products', type: 'number' },
  { id: 'sampleCount', label: 'Samples', type: 'number' },
  { id: 'completeBgcs', label: 'Complete BGCs', type: 'number' },
  { id: 'genomeCount', label: 'Genomes', type: 'number', description: 'MAG, SAG and isolate genomes (metagenome assemblies are not counted)' },
]);

export const gcfFilterFields = withDefaults([
  { id: 'id', label: 'GCF ID', type: 'text' },
  { id: 'name', label: 'Name', type: 'text' },
  { id: 'productType', label: 'Category', type: 'text', allowedOperators: ['contains', 'equals', 'starts_with', 'ends_with'] },
  { id: 'productClass', label: 'Product', type: 'text', allowedOperators: ['contains', 'equals', 'starts_with', 'ends_with'] },
  { id: 'biome', label: 'Biome', type: 'text' },
  { id: 'taxonomy', label: 'Taxonomy', type: 'text', allowedOperators: ['contains', 'equals', 'starts_with', 'ends_with'] },
  { id: 'memberBgcCount', label: 'Member BGCs', type: 'number' },
  { id: 'assemblyCount', label: 'Assemblies', type: 'number' },
  { id: 'completeBgcCount', label: 'Complete BGCs', type: 'number', description: 'Members not truncated at a contig edge' },
  { id: 'studyCount', label: 'Studies', type: 'number', description: 'Studies this family occurs in; 1 means study-exclusive' },
  { id: 'taxaCount', label: 'Distinct taxa', type: 'number' },
  { id: 'productCategoryCount', label: 'Product categories', type: 'number' },
  // No lengthEst: gcf_browse's length fields are 1 bp greater than gcf_length_stats_mv's until
  // reindexed, so the backends would disagree on every boundary.
  // MIBiG only in the positive direction: "not anchored" is ~99.8% of families.
  { id: 'mibigAnchored', label: 'MIBiG reference', type: 'select', options: [
    { label: 'Has a MIBiG reference', value: 'true' },
    { label: 'No MIBiG reference', value: 'false' },
  ], allowedOperators: ['equals', 'not_equals'], defaultOperator: 'equals' },
  // The two clustering-v3 tiers (gcfs.family_class).
  { id: 'familyClass', label: 'Family class', type: 'select', options: [
    { label: 'Seed', value: 'seed' },
    { label: 'Fragmented', value: 'fragmented' },
  ], allowedOperators: ['equals', 'not_equals'], defaultOperator: 'equals' },
  // As gcf_browse carries them; a family with no resolved phylum has neither field, not a zero.
  { id: 'domPhylum', label: 'Dominant phylum', type: 'text' },
  { id: 'domPhylumPct', label: 'Dominant phylum share (%)', type: 'number', description: 'Percent of members in the dominant phylum (0\u2013100)' },
  // Level 1 is the broad ecosystem; level 3 is where Marine, Soil etc. live. Both shares are 0-100.
  { id: 'ecosystemSpecificity', label: 'Ecosystem specificity L1 (%)', type: 'number', description: 'Share of the largest top-level GOLD ecosystem (0\u2013100)' },
  { id: 'domEcosystem', label: 'Dominant ecosystem (L3)', type: 'text', description: 'e.g. Marine, Freshwater, Soil, Digestive system' },
  { id: 'domEcosystemPct', label: 'Dominant ecosystem share (%)', type: 'number', description: 'Percent of members in that level-3 ecosystem (0\u2013100)' },
  // The id stays `avgScore` (a URL key), but the column is avg_distance: lower is better.
  { id: 'avgScore', label: 'Avg Distance (lower = closer)', type: 'number' },
]);
