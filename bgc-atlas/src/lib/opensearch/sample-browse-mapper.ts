// `sample_browse` document -> the `Sample` shape the /samples table renders. Not
// `mapSampleRowToSample`, which imports Prisma and cannot reach a client bundle; shared
// with the entity export so the two cannot drift. Of genome QC, only the two CheckM
// figures and their MIMAG label are mapped: they are columns on /genome-collections.
import { stripSourcePrefix } from '@/lib/utils/sample-id';
import type { Sample } from '@/lib/types';

const s = (v: unknown): string | undefined =>
  typeof v === 'string' && v.trim() ? v : undefined;
const n = (v: unknown): number | undefined =>
  v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? undefined : Number(v);
/** null (not 0) when the field is absent, so "no data" stays distinct from a real zero. */
const nOrNull = (v: unknown): number | null =>
  v === null || v === undefined || !Number.isFinite(Number(v)) ? null : Number(v);
const strArr = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];

export function mapSampleBrowseDocument(id: string, doc: Record<string, unknown>): Sample {
  const latitude = n(doc.latitude);
  const longitude = n(doc.longitude);
  const externalId = s(doc.external_id) ? stripSourcePrefix(String(doc.external_id)) : null;
  return {
    id,
    externalId,
    name: s(doc.name) ?? externalId ?? id,
    accession: s(doc.accession),
    environment: s(doc.environment_biome) ?? '',
    geographicLocation: s(doc.geographic_location),
    location: s(doc.geographic_location)
      ?? s(doc.geolocation_name)
      ?? (latitude !== undefined && longitude !== undefined
        ? `${latitude.toFixed(4)}, ${longitude.toFixed(4)}`
        : undefined),
    latitude,
    longitude,
    // The table reads biome from primary_biome and Environment from environment_biome.
    primaryBiome: s(doc.primary_biome) ?? null,
    environmentBiome: s(doc.primary_biome),
    environmentFeature: s(doc.environment_feature),
    environmentMaterial: s(doc.environment_material),
    environmentalPackage: s(doc.environmental_package),
    hostTaxid: n(doc.host_taxid),
    hostSpecies: s(doc.host_scientific_name),
    bgcCount: n(doc.bgc_count) ?? 0,
    gcfCount: nOrNull(doc.gcf_count),
    clusteredBgcCount: nOrNull(doc.clustered_bgc_count),
    unclusteredBgcCount: nOrNull(doc.unclustered_bgc_count),
    assemblyCount: n(doc.assembly_count) ?? 0,
    dataSourceNames: strArr(doc.data_source_names),
    sourceTypes: strArr(doc.source_types),
    studyTitles: strArr(doc.study_titles),
    goldEcosystemPath: s(doc.gold_ecosystem_path) ?? null,
    checkmCompleteness: n(doc.checkm_completeness),
    checkmContamination: n(doc.checkm_contamination),
    genomeQuality: s(doc.genome_quality) ?? null,
    metadata: doc.metadata && typeof doc.metadata === 'object' ? doc.metadata as Record<string, unknown> : {},
    createdAt: s(doc.created_at) ?? '',
    updatedAt: s(doc.updated_at) ?? '',
  };
}
