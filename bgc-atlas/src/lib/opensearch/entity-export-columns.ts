// Column sets and row flatteners for exporting Property Search results grouped by GCF
// or sample. Rows are aggregation buckets, not BGC documents (see export-columns.ts),
// flattened from the same mapped shapes the results table renders.
import type { ExportColumn } from '@/lib/opensearch/export-columns';
import { mapGcfBrowseDocument } from '@/lib/opensearch/gcf-browse-mapper';
import { mapSampleBrowseDocument } from '@/lib/opensearch/sample-browse-mapper';
import { formatBgcLength } from '@/lib/utils/bgc-length';
import { formatBiomeLabel } from '@/lib/utils/metadata-parser';

/** One aggregation bucket, plus the family-scope measurements when the query was scoped. */
export interface EntityExportInput {
  id: string;
  bgcCount: number;
  source: Record<string, unknown>;
  cohortCounts?: number[];
  inside?: number;
  located?: number;
  members?: number;
  purity?: number;
}

type Row = Record<string, unknown>;

/** GTDB keys arrive rank-prefixed (`p__Bacillota`); the tables strip that. */
const stripRank = (key: string) => key.replace(/^[a-z]__/, '');

/** A distribution as its top `n` with shares, e.g. `Soil 45%; Marine 30%`. The
 *  denominator is the record's own sum, never another level's. `label` is per
 *  distribution because the keys are different vocabularies. */
function topShares(
  dist: Record<string, number> | null | undefined,
  n = 3,
  label: (key: string) => string = (k) => k,
): string {
  if (!dist) return '';
  const entries = Object.entries(dist).filter(([, v]) => Number.isFinite(v) && v > 0);
  if (!entries.length) return '';
  const total = entries.reduce((sum, v0) => sum + v0[1], 0);
  return entries
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([k, v]) => [label(k), Math.round((v / total) * 100)] as const)
    // A long-tail member rounds to 0%; drop it rather than print `other 0%`.
    .filter(([, pct]) => pct > 0)
    .map(([k, pct]) => `${k} ${pct}%`)
    .join('; ');
}

/** The sample Biome cell's own rule: primary biome, else the environment biome,
 *  and a bare `root` is an absent value, not a biome. */
function biomeLabel(primary?: string | null, environment?: string | null): string {
  const raw = (primary?.trim() || environment?.trim()) ?? '';
  if (!raw || /^root$/i.test(raw)) return '';
  return formatBiomeLabel(raw);
}

/** The largest named taxon with its share. `*__Unknown` is excluded (it is the share
 *  with no assignment, not a taxon), but shares are still over the whole distribution. */
const topTaxon = (dist: Record<string, number> | null | undefined): string => {
  if (!dist) return '';
  const named = Object.fromEntries(
    Object.entries(dist).filter(([k]) => !/^[a-z]__Unknown$/i.test(k) && k !== 'Unknown'),
  );
  const total = Object.values(dist).reduce((sum, v) => sum + (Number.isFinite(v) ? v : 0), 0);
  const best = Object.entries(named).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1])[0];
  if (!best || total <= 0) return '';
  const pct = Math.round((best[1] / total) * 100);
  return pct > 0 ? `${stripRank(best[0])} ${pct}%` : '';
};

export const GCF_EXPORT_COLUMNS: ExportColumn[] = [
  { key: 'gcf_id', label: 'GCF ID' },
  { key: 'gcf_name', label: 'Name' },
  { key: 'pet_name', label: 'Alias' },
  { key: 'matching_bgcs', label: 'Matching BGCs' },
  { key: 'member_bgcs', label: 'Member BGCs' },
  { key: 'assemblies', label: 'Assemblies' },
  { key: 'complete_bgcs', label: 'Complete members' },
  { key: 'partial_bgcs', label: 'Partial members' },
  { key: 'bgc_length', label: 'BGC length' },
  { key: 'family_class', label: 'Family class' },
  { key: 'product_categories', label: 'Categories' },
  // Shares by exact combination ('NRPS+PKS'), a partition; not overlapping per-category shares.
  { key: 'product_category_distribution', label: 'Category distribution (% of members)' },
  { key: 'top_phylum', label: 'Top phylum' },
  { key: 'top_genus', label: 'Top genus' },
  { key: 'biome_l1', label: 'Ecosystem (L1)' },
  { key: 'avg_distance', label: 'Avg. distance' },
  { key: 'mibig_compounds', label: 'MIBiG compounds' },
];

/** Family scope adds one column per cohort, labelled with the user's own names, plus the
 *  exclusivity triple. */
export const gcfScopeColumns = (cohortLabels: string[]): ExportColumn[] => [
  ...cohortLabels.map((label, i) => ({ key: `cohort_${i}`, label: `In: ${label}` })),
  { key: 'inside', label: 'Matching members' },
  { key: 'located', label: 'Located members' },
  { key: 'purity', label: 'Exclusivity' },
];

export const gcfExportColumns = (cohortLabels: string[] = []): ExportColumn[] => {
  if (!cohortLabels.length) return GCF_EXPORT_COLUMNS;
  // After "Matching BGCs", which the cohort breakdown explains.
  const at = GCF_EXPORT_COLUMNS.findIndex((c) => c.key === 'matching_bgcs') + 1;
  return [
    ...GCF_EXPORT_COLUMNS.slice(0, at),
    ...gcfScopeColumns(cohortLabels),
    ...GCF_EXPORT_COLUMNS.slice(at),
  ];
};

export function toGcfExportRow(input: EntityExportInput): Row {
  const gcf = mapGcfBrowseDocument({ gcf_id: input.id, ...input.source });
  const byRank = gcf.taxonomyDistributionByRank ?? {};
  const length = formatBgcLength(gcf.lengthStats);
  const row: Row = {
    gcf_id: gcf.id,
    gcf_name: gcf.name,
    pet_name: gcf.petName ?? '',
    matching_bgcs: input.bgcCount,
    member_bgcs: gcf.memberBgcCount,
    assemblies: gcf.assemblyCount,
    complete_bgcs: gcf.completeBgcCount,
    partial_bgcs: gcf.partialBgcCount,
    // Carries the '≥' for families with no complete member, so a lower bound reads as one.
    bgc_length: length?.text ?? '',
    family_class: gcf.familyClass ?? '',
    product_categories: gcf.productCategories,
    product_category_distribution: topShares(gcf.productCategoryDistribution),
    top_phylum: topTaxon(byRank.phylum ?? gcf.taxonomyDistribution),
    top_genus: topTaxon(byRank.genus),
    // Verbatim keys, as `BiomeDistributionChart` draws them: `formatBiomeLabel` would merge
    // `Host-associated` with the synthetic `Host-assoc.: Plants` bucket.
    biome_l1: topShares(gcf.biomeDistributionByLevel?.[1]),
    // Three decimals, as the Avg Distance column renders it.
    avg_distance: gcf.avgDistance === null ? '' : gcf.avgDistance.toFixed(3),
    mibig_compounds: gcf.mibigCompounds,
  };
  if (input.cohortCounts?.length) {
    input.cohortCounts.forEach((c, i) => { row[`cohort_${i}`] = c; });
    row.inside = input.inside ?? '';
    row.located = input.located ?? '';
    row.purity = input.purity === undefined ? '' : `${Math.round(input.purity * 100)}%`;
  }
  return row;
}

export const SAMPLE_EXPORT_COLUMNS: ExportColumn[] = [
  { key: 'sample_id', label: 'Sample ID' },
  { key: 'external_id', label: 'External ID' },
  { key: 'name', label: 'Name' },
  { key: 'accession', label: 'Accession' },
  { key: 'matching_bgcs', label: 'Matching BGCs' },
  { key: 'total_bgcs', label: 'Total BGCs' },
  // Never a GCF count on its own: coverage varies by sample and study.
  { key: 'gcfs', label: 'GCFs' },
  { key: 'clustered_bgcs', label: 'Clustered BGCs' },
  { key: 'unclustered_bgcs', label: 'Unclustered BGCs' },
  { key: 'assemblies', label: 'Assemblies' },
  { key: 'biome', label: 'Biome' },
  { key: 'gold_ecosystem_path', label: 'GOLD ecosystem' },
  { key: 'environment_feature', label: 'Environment feature' },
  { key: 'environment_material', label: 'Environment material' },
  { key: 'host_species', label: 'Host' },
  { key: 'location', label: 'Location' },
  { key: 'latitude', label: 'Latitude' },
  { key: 'longitude', label: 'Longitude' },
  { key: 'source_types', label: 'Source types' },
  { key: 'data_sources', label: 'Data sources' },
  { key: 'studies', label: 'Studies' },
];

export function toSampleExportRow(input: EntityExportInput): Row {
  const sample = mapSampleBrowseDocument(input.id, input.source);
  return {
    sample_id: sample.id,
    external_id: sample.externalId ?? '',
    name: sample.name,
    accession: sample.accession ?? '',
    matching_bgcs: input.bgcCount,
    total_bgcs: sample.bgcCount,
    gcfs: sample.gcfCount ?? '',
    clustered_bgcs: sample.clusteredBgcCount ?? '',
    unclustered_bgcs: sample.unclusteredBgcCount ?? '',
    assemblies: sample.assemblyCount,
    // As the Biome column: primary, then the environment biome; a bare `root` is no data.
    biome: biomeLabel(sample.primaryBiome, sample.environmentBiome),
    gold_ecosystem_path: sample.goldEcosystemPath ?? '',
    environment_feature: sample.environmentFeature ?? '',
    environment_material: sample.environmentMaterial ?? '',
    host_species: sample.hostSpecies ?? '',
    location: sample.location ?? '',
    latitude: sample.latitude ?? '',
    longitude: sample.longitude ?? '',
    source_types: sample.sourceTypes,
    data_sources: sample.dataSourceNames,
    studies: sample.studyTitles,
  };
}

export const entityExportColumns = (
  entity: 'gcfs' | 'samples', cohortLabels: string[] = [],
): ExportColumn[] => (entity === 'gcfs' ? gcfExportColumns(cohortLabels) : SAMPLE_EXPORT_COLUMNS);

export const toEntityExportRow = (entity: 'gcfs' | 'samples', input: EntityExportInput): Row =>
  (entity === 'gcfs' ? toGcfExportRow(input) : toSampleExportRow(input));
