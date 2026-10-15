import type { FilterFieldDefinition, FilterGroup, FilterOperator, FilterValue } from '@/lib/filters/types';
import {
  createDefaultFilterGroup,
  createFilterCondition,
} from '@/lib/filters/types';

export type FilterRecipe = {
  id: string;
  name: string;
  description: string;
  build: (fields: FilterFieldDefinition[]) => FilterGroup;
};

const hasField = (fields: FilterFieldDefinition[], id: string) =>
  fields.some((field) => field.id === id);

const buildGroup = (
  fields: FilterFieldDefinition[],
  specs: Array<{ field: string; operator: FilterOperator; value: FilterValue }>,
  operator: FilterGroup['operator'] = 'AND'
) => {
  const group = createDefaultFilterGroup();
  group.operator = operator;
  group.conditions = specs
    .filter((spec) => hasField(fields, spec.field))
    .map((spec) => createFilterCondition(spec.field, spec.operator, spec.value));
  return group;
};

export const bgcFilterRecipes: FilterRecipe[] = [
  {
    id: 'complete-nrps-soil',
    name: 'Complete NRPS in soil',
    description: 'Complete NRPS clusters from soil-associated samples.',
    build: (fields) =>
      buildGroup(fields, [
        { field: 'productType', operator: 'contains', value: 'NRPS' },
        { field: 'completeness', operator: 'equals', value: 'complete' },
        // GOLD, not `biome`, which mixes two vocabularies; `starts_with` because the path is a hierarchy.
        { field: 'goldEcosystem', operator: 'starts_with', value: 'Environmental:Terrestrial:Soil' },
      ]),
  },
  {
    id: 'long-ripp-host',
    name: 'Long RiPP in hosts',
    description: 'Host-associated RiPP clusters longer than 25 kbp.',
    build: (fields) =>
      buildGroup(fields, [
        { field: 'productType', operator: 'contains', value: 'RiPP' },
        { field: 'length', operator: 'gt', value: 25000 },
        // Not `sample` (matches "host" in names, and forces the slow SQL fallback) and not `biome`
        // (misses ~1.1M BGCs whose MGnify/ENVO fields never say host-associated).
        { field: 'goldEcosystem', operator: 'starts_with', value: 'Host-associated' },
      ]),
  },
  {
    id: 'high-similar-gcf',
    name: 'Close GCF members',
    // Low distance at the 0.4 resolution; the cutoff is a proxy bound to recalibrate.
    description: 'BGCs close (low distance) to their assigned GCF.',
    build: (fields) =>
      buildGroup(fields, [
        { field: 'distance', operator: 'lte', value: 0.4 },
        { field: 'completeness', operator: 'not_equals', value: 'partial' },
      ]),
  },
  {
    id: 'acidobacteria-lassopeptides',
    name: 'Acidobacteria lassopeptides',
    // GTDB R232 renamed Acidobacteria to Acidobacteriota.
    description: 'Lassopeptide clusters from the phylum Acidobacteriota.',
    build: (fields) =>
      buildGroup(fields, [
        // The old name is not a substring of the new one and would match only a family and an order.
        { field: 'taxonomy', operator: 'contains', value: 'Acidobacteriota' },
        { field: 'productType', operator: 'contains', value: 'lassopeptide' },
      ]),
  },
  {
    id: 'soil-actinobacteria-t1pks',
    name: 'Soil Actinobacteria T1PKS',
    description: 'Type I PKS clusters from soil-associated Actinobacteria.',
    build: (fields) =>
      buildGroup(fields, [
        // GTDB R232 renamed Actinobacteria; the old name matches nothing on either backend.
        { field: 'taxonomy', operator: 'contains', value: 'Actinomycetota' },
        { field: 'productType', operator: 'contains', value: 'T1PKS' },
        { field: 'goldEcosystem', operator: 'starts_with', value: 'Environmental:Terrestrial:Soil' },
      ]),
  },
];

export const sampleFilterRecipes: FilterRecipe[] = [
  {
    // A saved-filter key, so the id stays although the recipe is no longer coastal-only.
    id: 'high-bgc-coastal',
    name: 'Marine hotspots',
    // GOLD marine subtree rather than the sparse `primary_biome`; `starts_with` because
    // `contains 'marine'` also matches "Non-marine Saline and Alkaline".
    description: 'Samples with >500 BGCs from marine ecosystems.',
    build: (fields) =>
      buildGroup(fields, [
        { field: 'bgcs', operator: 'gt', value: 500 },
        { field: 'goldEcosystem', operator: 'starts_with', value: 'Environmental:Aquatic:Marine' },
      ]),
  },
  {
    id: 'soil-sediment',
    name: 'Soil & sediment',
    description: 'Terrestrial samples from soil or sediment GOLD ecosystems.',
    build: (fields) =>
      buildGroup(
        fields,
        [
          { field: 'goldEcosystem', operator: 'contains', value: 'Soil' },
          { field: 'goldEcosystem', operator: 'contains', value: 'Sediment' },
        ],
        'OR'
      ),
  },
  {
    id: 'extreme-environments',
    name: 'Extreme environments',
    description: 'Thermal or hydrothermal habitats such as hot springs.',
    build: (fields) =>
      buildGroup(
        fields,
        [
          { field: 'goldEcosystem', operator: 'contains', value: 'Thermal' },
          { field: 'environment', operator: 'contains', value: 'hydrothermal' },
          { field: 'environment', operator: 'contains', value: 'hot spring' },
        ],
        'OR'
      ),
  },
  {
    id: 'freshwater-systems',
    name: 'Freshwater systems',
    description: 'Lakes, rivers, and groundwater freshwater samples.',
    build: (fields) =>
      buildGroup(fields, [
        // As for marine: `primary_biome` holds a small fraction of the GOLD subtree.
        { field: 'goldEcosystem', operator: 'starts_with', value: 'Environmental:Aquatic:Freshwater' },
      ]),
  },
  {
    id: 'polar-samples',
    name: 'Polar samples',
    description: 'Arctic and Antarctic samples above 66° or below -66° latitude.',
    build: (fields) =>
      buildGroup(
        fields,
        [
          { field: 'lat', operator: 'gt', value: 66 },
          { field: 'lat', operator: 'lt', value: -66 },
        ],
        'OR'
      ),
  },
  {
    id: 'tropical-belt',
    name: 'Tropical belt',
    description: 'Samples collected between -23° and 23° latitude.',
    build: (fields) =>
      buildGroup(fields, [
        { field: 'lat', operator: 'between', value: [-23, 23] },
      ]),
  },
  // `large-studies` moved to /studies as `deeply-sampled-studies`; the id stays retired (a saved-filter key).
  {
    id: 'gcf-rich-samples',
    name: 'GCF-rich samples',
    // One condition: BGC count and family count correlate too closely for a second to add much.
    description: 'Samples where 500+ distinct gene cluster families were found.',
    build: (fields) =>
      buildGroup(fields, [
        { field: 'gcfCount', operator: 'gte', value: 500 },
      ]),
  },
];

export const gcfFilterRecipes: FilterRecipe[] = [
  {
    id: 'large-families',
    name: 'Large families',
    description: 'GCFs with more than 200 member BGCs.',
    build: (fields) =>
      buildGroup(fields, [
        { field: 'memberBgcCount', operator: 'gt', value: 200 },
      ]),
  },
  {
    id: 'marine-specialists',
    name: 'Marine specialists',
    // domEcosystem is the precomputed argmax over level 3 (where marine lives); `biome contains`
    // would match one marine member in thousands. The member floor keeps this a shortlist.
    description: 'Families whose members are at least 80% marine, with 50+ members.',
    build: (fields) =>
      buildGroup(fields, [
        { field: 'domEcosystem', operator: 'equals', value: 'Marine' },
        { field: 'domEcosystemPct', operator: 'gte', value: 80 },
        { field: 'memberBgcCount', operator: 'gte', value: 50 },
      ]),
  },
  {
    id: 'ecosystem-specialists',
    name: 'Ecosystem specialists',
    description: 'Families with 90%+ of members in a single top-level GOLD ecosystem.',
    build: (fields) =>
      buildGroup(fields, [
        { field: 'ecosystemSpecificity', operator: 'gte', value: 90 },
        { field: 'memberBgcCount', operator: 'gte', value: 50 },
      ]),
  },
  {
    id: 'characterised-families',
    name: 'Characterised families',
    // Positive only: ~0.2% of families are anchored, so "not anchored" filters almost nothing.
    description: 'Families containing a MIBiG reference cluster with known chemistry.',
    build: (fields) =>
      buildGroup(fields, [
        { field: 'mibigAnchored', operator: 'equals', value: 'true' },
      ]),
  },
  {
    id: 'cosmopolitan-families',
    name: 'Cosmopolitan families',
    description: 'Families found across 50+ studies and 20+ distinct taxa.',
    build: (fields) =>
      buildGroup(fields, [
        { field: 'studyCount', operator: 'gte', value: 50 },
        { field: 'taxaCount', operator: 'gte', value: 20 },
      ]),
  },
  {
    id: 'phylum-crossing-families',
    name: 'Phylum-crossing families',
    // The inverse is the norm: over 80% of families in 20+ studies are already 90%+ one phylum.
    description: 'Widespread families whose members span several phyla, no single one above 70%.',
    build: (fields) =>
      buildGroup(fields, [
        { field: 'studyCount', operator: 'gte', value: 20 },
        { field: 'domPhylumPct', operator: 'lt', value: 70 },
      ]),
  },
  {
    id: 'high-score-product',
    name: 'Tight RiPP families',
    // avgScore is avg_distance, where lower is closer.
    description: 'RiPP families whose members sit close together (avg distance below 0.2).',
    build: (fields) =>
      buildGroup(fields, [
        { field: 'productType', operator: 'contains', value: 'RiPP' },
        { field: 'avgScore', operator: 'lte', value: 0.2 },
        // Without a floor, tiny families score perfectly by arithmetic and the list runs past 100k.
        { field: 'memberBgcCount', operator: 'gte', value: 20 },
      ]),
  },
];

export const studyFilterRecipes: FilterRecipe[] = [
  {
    id: 'novelty-hotspots',
    name: 'Novelty hotspots',
    // Coverage guards against high exclusive counts off a small clustered subset.
    description: 'Many study-exclusive GCFs, backed by decent clustering coverage.',
    build: (fields) =>
      buildGroup(fields, [
        { field: 'exclusiveGcfs', operator: 'gte', value: 100 },
        { field: 'gcfCoverage', operator: 'gte', value: 50 },
      ]),
  },
  {
    id: 'rare-family-hotspots',
    name: 'Rare-family hotspots',
    // At most 3 studies: nearly as interesting as exclusive, less likely an artefact of one project.
    description: 'Many GCFs seen in three studies or fewer, backed by decent clustering coverage.',
    build: (fields) =>
      buildGroup(fields, [
        { field: 'rareGcfs', operator: 'gte', value: 100 },
        { field: 'gcfCoverage', operator: 'gte', value: 50 },
      ]),
  },
  {
    id: 'deeply-sampled-studies',
    name: 'Deeply sampled studies',
    description: 'Studies with 100+ samples and 1,000+ BGCs.',
    build: (fields) =>
      buildGroup(fields, [
        { field: 'sampleCount', operator: 'gte', value: 100 },
        { field: 'totalBgcs', operator: 'gte', value: 1000 },
      ]),
  },
  {
    id: 'chemically-diverse-studies',
    name: 'Chemically diverse studies',
    // The BGC floor stops this ranking simply the biggest studies.
    description: 'Studies spanning 20+ antiSMASH product types, with 500+ BGCs.',
    build: (fields) =>
      buildGroup(fields, [
        { field: 'productTypeCount', operator: 'gte', value: 20 },
        { field: 'totalBgcs', operator: 'gte', value: 500 },
      ]),
  },
];
