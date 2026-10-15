import { Prisma } from '@prisma/client';

import { type FilterCondition } from '@/lib/filters/types';
import {
  buildMultiColumnTextCondition,
  buildNumberCondition,
  buildTextCondition,
  extractMultipleValues,
  extractStringValue,
} from '@/lib/filters/prisma-builders';
import { stripSourcePrefix } from '@/lib/utils/sample-id';

// Lives outside app/api/samples/route.ts: a route file exporting non-handler symbols trips
// Next's generated route-type checker.

export type SampleRow = {
  id: string;
  external_id: string | null;
  name: string | null;
  description: string | null;
  sample_alias: string | null;
  accession: string | null;
  geographic_location: string | null;
  geolocation_name: string | null;
  location_resolution: string | null;
  latitude: Prisma.Decimal | number | null;
  longitude: Prisma.Decimal | number | null;
  depth: Prisma.Decimal | number | null;
  depth_min_meters: Prisma.Decimal | number | null;
  depth_max_meters: Prisma.Decimal | number | null;
  elevation_meters: Prisma.Decimal | number | null;
  temperature: Prisma.Decimal | number | null;
  ph: Prisma.Decimal | number | null;
  salinity: Prisma.Decimal | number | null;
  salinity_unit: string | null;
  // Only present when the detail route joins `samples`.
  dissolved_oxygen?: Prisma.Decimal | number | null;
  dissolved_oxygen_unit?: string | null;
  nitrate?: Prisma.Decimal | number | null;
  nitrate_unit?: string | null;
  nitrite?: Prisma.Decimal | number | null;
  nitrite_unit?: string | null;
  ammonium?: Prisma.Decimal | number | null;
  ammonium_unit?: string | null;
  phosphate?: Prisma.Decimal | number | null;
  phosphate_unit?: string | null;
  conductivity?: Prisma.Decimal | number | null;
  conductivity_unit?: string | null;
  dissolved_organic_carbon?: Prisma.Decimal | number | null;
  dissolved_organic_carbon_unit?: string | null;
  filtration_lower_threshold_um?: Prisma.Decimal | number | null;
  filtration_upper_threshold_um?: Prisma.Decimal | number | null;
  checkm_completeness?: Prisma.Decimal | number | null;
  checkm_contamination?: Prisma.Decimal | number | null;
  checkm_tool?: string | null;
  checkm_source?: string | null;
  genome_size?: bigint | number | null;
  genome_quality?: string | null;
  current_precipitation_mm: Prisma.Decimal | number | null;
  mean_annual_precipitation_mm: Prisma.Decimal | number | null;
  mean_annual_temperature: Prisma.Decimal | number | null;
  environmental_package: string | null;
  environment_biome: string | null;
  primary_biome: string | null;
  environment_feature: string | null;
  environment_material: string | null;
  host_taxid: number | null;
  host_scientific_name: string | null;
  data_source_ids: string[] | null;
  data_source_names: string[] | null;
  source_types: string[] | null;
  study_titles: string[] | null;
  collection_date: Date | string | null;
  collection_date_end: Date | string | null;
  metadata: Record<string, unknown> | null;
  gold_ecosystem_path: string | null;
  gold_ecosystem_metadata: Record<string, unknown> | null;
  created_at: Date | string | null;
  updated_at: Date | string | null;
  assembly_count: number;
  bgc_count: number;
  // From sample_gcf_counts_mv; absent on rows that don't join it.
  gcf_count?: number | null;
  clustered_bgc_count?: number | null;
  unclustered_bgc_count?: number | null;
  // Only with includeGtdbAccession=1; the client normalizes it for the GTDB deep link.
  gtdb_accession?: string | null;
  // Only with includeTaxonomy=1.
  taxonomy?: {
    domain: string | null;
    phylum: string | null;
    class: string | null;
    order: string | null;
    family: string | null;
    genus: string | null;
    species: string | null;
    gtdbLineage: string | null;
  } | null;
  // Only with includeStudyLinks=1.
  study_links?: Array<{
    accession: string | null;
    bioproject: string | null;
    title: string | null;
  }> | null;
};

export const toLike = (value: string) => `%${value.replace(/%/g, '\\%').replace(/_/g, '\\_')}%`;
const isValidUuid = (value: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

// Mirrors bucketFromGold() in lib/utils/gold-buckets.ts so the dropdown matches the map.
export const goldBucketSqlForColumn = (bucket: string, col: Prisma.Sql): Prisma.Sql | null => {
  switch (bucket) {
    case 'host-animal':
      return Prisma.sql`(${col} ILIKE 'Host-associated%' AND ${col} NOT ILIKE 'Host-associated:Plants%')`;
    case 'host-plant':
      return Prisma.sql`${col} ILIKE 'Host-associated:Plants%'`;
    case 'marine':
      return Prisma.sql`${col} ILIKE 'Environmental:Aquatic:Marine%'`;
    case 'freshwater':
      return Prisma.sql`${col} ILIKE 'Environmental:Aquatic:Freshwater%'`;
    case 'soil-terrestrial':
      return Prisma.sql`${col} ILIKE 'Environmental:Terrestrial%'`;
    case 'other-environmental':
      return Prisma.sql`(
        ${col} ILIKE 'Environmental%'
        AND ${col} NOT ILIKE 'Environmental:Aquatic:Marine%'
        AND ${col} NOT ILIKE 'Environmental:Aquatic:Freshwater%'
        AND ${col} NOT ILIKE 'Environmental:Terrestrial%'
      )`;
    case 'engineered':
      return Prisma.sql`${col} ILIKE 'Engineered%'`;
    case 'mixed':
      return Prisma.sql`${col} ILIKE 'Mixed%'`;
    case 'unknown':
      return Prisma.sql`(${col} IS NULL OR ${col} = '')`;
    default:
      return null;
  }
};

export const goldBucketSql = (bucket: string): Prisma.Sql | null =>
  goldBucketSqlForColumn(bucket, Prisma.sql`sb.gold_ecosystem_path`);

// Derived by asking the SQL, so the error message cannot list a bucket that does not work.
export const GOLD_BUCKETS = [
  'host-animal', 'host-plant', 'marine', 'freshwater', 'soil-terrestrial',
  'other-environmental', 'engineered', 'mixed', 'unknown',
].filter((bucket) => goldBucketSqlForColumn(bucket, Prisma.sql`x`) !== null);

export class UnknownGoldBucketError extends Error {
  readonly bucket: string;

  constructor(bucket: string) {
    super(`Unknown goldBucket: ${bucket}. Valid values are ${GOLD_BUCKETS.join(', ')}.`);
    this.name = 'UnknownGoldBucketError';
    this.bucket = bucket;
  }
}

export const parseNumber = (value: string | null, options: { fallback?: number; clampMin?: number; clampMax?: number } = {}) => {
  if (!value) return undefined;
  const num = Number(value);
  if (!Number.isFinite(num)) return options.fallback;
  let result = num;
  if (options.clampMin !== undefined && result < options.clampMin) {
    result = options.clampMin;
  }
  if (options.clampMax !== undefined && result > options.clampMax) {
    result = options.clampMax;
  }
  return result;
};

// `samples.source_type` holds only these four, so anything else matches nothing.
export const SOURCE_TYPES = ['isolate', 'MAG', 'SAG', 'metagenome'] as const;
export type SourceType = (typeof SOURCE_TYPES)[number];

export class UnknownSourceTypeError extends Error {
  readonly unknownTypes: string[];

  constructor(unknownTypes: string[]) {
    super(
      `Unknown sourceType: ${unknownTypes.join(', ')}.`
      + ` Valid values are ${SOURCE_TYPES.join(', ')}.`
    );
    this.name = 'UnknownSourceTypeError';
    this.unknownTypes = unknownTypes;
  }
}

// Validation is raised inside parseSampleFilters, the single parse feeding both the SQL and
// the cache key, so the two cannot drift.
export const parseGoldBucket = (raw: string | undefined): string | undefined => {
  if (!raw) return undefined;
  if (!goldBucketSql(raw)) throw new UnknownGoldBucketError(raw);
  return raw;
};

export const parseSourceTypes = (params: URLSearchParams): string[] => {
  const sourceTypes = [...new Set(params.getAll('sourceType'))].sort();
  const unknownTypes = sourceTypes.filter(
    (type) => !(SOURCE_TYPES as readonly string[]).includes(type)
  );
  if (unknownTypes.length > 0) {
    throw new UnknownSourceTypeError(unknownTypes);
  }
  return sourceTypes;
};

// One parse feeds both the SQL and the statistics cache key, so they cannot disagree on an edge
// case. Everything is canonical: trimmed, empties dropped, source types sorted as a set.
export type SampleFilterInputs = {
  id: string | undefined;
  search: string | undefined;
  environment: string | undefined;
  biome: string | undefined;
  goldEcosystem: string | undefined;
  goldBucket: string | undefined;
  environmentText: string | undefined;
  material: string | undefined;
  feature: string | undefined;
  host: string | undefined;
  latMin: number | undefined;
  latMax: number | undefined;
  lonMin: number | undefined;
  lonMax: number | undefined;
  dataSource: string | undefined;
  study: string | undefined;
  studyKey: string | undefined;
  assembliesMin: number | undefined;
  assembliesMax: number | undefined;
  bgcsMin: number | undefined;
  bgcsMax: number | undefined;
  gcfsMin: number | undefined;
  gcfsMax: number | undefined;
  completenessMin: number | undefined;
  completenessMax: number | undefined;
  contaminationMin: number | undefined;
  contaminationMax: number | undefined;
  genomeQuality: string | undefined;
  sourceTypes: string[];
};

export const parseSampleFilters = (params: URLSearchParams): SampleFilterInputs => {
  const text = (name: string) => params.get(name)?.trim() || undefined;
  const num = (name: string) => parseNumber(params.get(name));
  // Resolve the two spellings on the raw values like the builder: `??` falls through only on
  // absence, so a present-but-empty `dataSource` wins.
  const dataSourceRaw = params.get('dataSource') ?? params.get('dataSourceId');
  const goldBucketRaw = text('goldBucket');

  return {
    id: text('id'),
    search: text('search'),
    environment: text('environment'),
    biome: text('biome'),
    goldEcosystem: text('goldEcosystem'),
    // Refused rather than dropped: dropping would answer every sample at HTTP 200.
    goldBucket: parseGoldBucket(goldBucketRaw),
    environmentText: text('environmentText'),
    material: text('material'),
    feature: text('feature'),
    host: text('host'),
    latMin: num('latMin'),
    latMax: num('latMax'),
    lonMin: num('lonMin'),
    lonMax: num('lonMax'),
    dataSource: dataSourceRaw?.trim() || undefined,
    study: text('study'),
    studyKey: text('studyKey'),
    assembliesMin: num('assembliesMin'),
    assembliesMax: num('assembliesMax'),
    bgcsMin: num('bgcsMin'),
    bgcsMax: num('bgcsMax'),
    gcfsMin: num('gcfsMin'),
    gcfsMax: num('gcfsMax'),
    completenessMin: num('completenessMin'),
    completenessMax: num('completenessMax'),
    contaminationMin: num('contaminationMin'),
    contaminationMax: num('contaminationMax'),
    genomeQuality: text('genomeQuality'),
    sourceTypes: parseSourceTypes(params),
  };
};

export const buildBaseFilters = (params: URLSearchParams) => {
  const f = parseSampleFilters(params);
  const filters: Prisma.Sql[] = [];

  if (f.search) {
    const like = toLike(f.search);
    filters.push(
      Prisma.sql`(
        sb.external_id ILIKE ${like}
        OR sb.name ILIKE ${like}
        OR sb.geographic_location ILIKE ${like}
        OR sb.geolocation_name ILIKE ${like}
        OR sb.environment_biome ILIKE ${like}
        OR sb.environment_feature ILIKE ${like}
        OR sb.environment_material ILIKE ${like}
        OR sb.host_scientific_name ILIKE ${like}
        OR sb.primary_biome ILIKE ${like}
      )`
    );
  }

  if (f.id) {
    const like = toLike(f.id);
    filters.push(Prisma.sql`(sb.external_id ILIKE ${like} OR sb.id::text ILIKE ${like})`);
  }

  if (f.environment) {
    const like = toLike(f.environment);
    filters.push(Prisma.sql`sb.environment_biome ILIKE ${like}`);
  }

  if (f.biome) {
    const like = toLike(f.biome);
    filters.push(Prisma.sql`sb.primary_biome ILIKE ${like}`);
  }

  if (f.goldEcosystem) {
    const like = toLike(f.goldEcosystem);
    filters.push(Prisma.sql`sb.gold_ecosystem_path ILIKE ${like}`);
  }

  if (f.goldBucket) {
    // Non-null: parseSampleFilters drops a bucket this returns null for.
    const bucketSql = goldBucketSql(f.goldBucket);
    if (bucketSql) filters.push(bucketSql);
  }

  if (f.environmentText) {
    const like = toLike(f.environmentText);
    filters.push(
      Prisma.sql`(sb.environment_biome ILIKE ${like} OR sb.environment_feature ILIKE ${like})`
    );
  }

  if (f.material) {
    const like = toLike(f.material);
    filters.push(Prisma.sql`sb.environment_material ILIKE ${like}`);
  }

  if (f.feature) {
    const like = toLike(f.feature);
    filters.push(Prisma.sql`sb.environment_feature ILIKE ${like}`);
  }

  if (f.host) {
    const like = toLike(f.host);
    filters.push(
      Prisma.sql`(
        sb.host_scientific_name ILIKE ${like}
        OR sb.host_taxid::text ILIKE ${like}
      )`
    );
  }

  if (f.latMin !== undefined) {
    filters.push(Prisma.sql`sb.latitude IS NOT NULL AND sb.latitude >= ${f.latMin}`);
  }

  if (f.latMax !== undefined) {
    filters.push(Prisma.sql`sb.latitude IS NOT NULL AND sb.latitude <= ${f.latMax}`);
  }

  if (f.lonMin !== undefined) {
    filters.push(Prisma.sql`sb.longitude IS NOT NULL AND sb.longitude >= ${f.lonMin}`);
  }

  if (f.lonMax !== undefined) {
    filters.push(Prisma.sql`sb.longitude IS NOT NULL AND sb.longitude <= ${f.lonMax}`);
  }

  return filters;
};

export const buildOuterFilters = (params: URLSearchParams) => {
  const f = parseSampleFilters(params);
  const filters: Prisma.Sql[] = [];

  filters.push(Prisma.sql`sb.external_id IS NOT NULL`);

  if (f.dataSource) {
    const value = f.dataSource;
    const isUuid = /^[0-9a-fA-F-]{36}$/.test(value);
    if (isUuid) {
      filters.push(Prisma.sql`${value}::uuid = ANY(sb.data_source_ids)`);
    } else {
      // Backward-compatible name search
      const like = toLike(value);
      filters.push(
        Prisma.sql`EXISTS (
          SELECT 1
          FROM UNNEST(sb.data_source_names) AS ds(name)
          WHERE name ILIKE ${like}
        )`
      );
    }
  }

  if (f.study) {
    const like = toLike(f.study);
    filters.push(
      Prisma.sql`EXISTS (
        SELECT 1
        FROM UNNEST(sb.study_titles) AS st(title)
        WHERE title ILIKE ${like}
      )`
    );
  }

  // ?studyKey= is the exact study (vs ?study= free text); needed so the SQL fallback for a
  // failed browse does not answer with all samples.
  if (f.studyKey) {
    filters.push(
      Prisma.sql`EXISTS (
        SELECT 1
        FROM study_samples ss
        JOIN studies st2 ON st2.id = ss.study_id
        WHERE ss.sample_id = sb.id
          AND COALESCE(NULLIF(st2.study_name, ''), st2.accession, st2.id::text) = ${f.studyKey}
      )`
    );
  }

  if (f.assembliesMin !== undefined) {
    filters.push(Prisma.sql`sb.assembly_count >= ${f.assembliesMin}`);
  }

  if (f.assembliesMax !== undefined) {
    filters.push(Prisma.sql`sb.assembly_count <= ${f.assembliesMax}`);
  }

  if (f.bgcsMin !== undefined) {
    filters.push(Prisma.sql`sb.bgc_count >= ${f.bgcsMin}`);
  }

  if (f.bgcsMax !== undefined) {
    filters.push(Prisma.sql`sb.bgc_count <= ${f.bgcsMax}`);
  }

  // Callers of these must LEFT JOIN sample_gcf_counts_mv AS sgc. A sample with no
  // row there has no BGCs, so it counts as zero families rather than dropping out.
  if (f.gcfsMin !== undefined) {
    filters.push(Prisma.sql`COALESCE(sgc.gcf_count, 0) >= ${f.gcfsMin}`);
  }

  if (f.gcfsMax !== undefined) {
    filters.push(Prisma.sql`COALESCE(sgc.gcf_count, 0) <= ${f.gcfsMax}`);
  }

  // Genome QC lives on `samples`, not sample_summary, and the callers of these
  // filters do not all join it (the count query and /api/samples/map read
  // sample_summary alone), so each is a PK-keyed EXISTS against samples.
  const qc: Prisma.Sql[] = [];
  if (f.completenessMin !== undefined) qc.push(Prisma.sql`q.checkm_completeness >= ${f.completenessMin}`);
  if (f.completenessMax !== undefined) qc.push(Prisma.sql`q.checkm_completeness <= ${f.completenessMax}`);
  if (f.contaminationMin !== undefined) qc.push(Prisma.sql`q.checkm_contamination >= ${f.contaminationMin}`);
  if (f.contaminationMax !== undefined) qc.push(Prisma.sql`q.checkm_contamination <= ${f.contaminationMax}`);
  if (f.genomeQuality) qc.push(Prisma.sql`q.genome_quality = ${f.genomeQuality}`);
  if (qc.length > 0) {
    filters.push(Prisma.sql`EXISTS (
      SELECT 1 FROM samples q WHERE q.id = sb.id AND ${Prisma.join(qc, ' AND ')}
    )`);
  }

  if (f.sourceTypes.length > 0) {
    filters.push(Prisma.sql`sb.source_types && ${f.sourceTypes}::text[]`);
  }

  return filters;
};

export const mapSampleRowToSample = (row: SampleRow) => {
  const num = (v: Prisma.Decimal | number | bigint | null | undefined): number | undefined =>
    v !== null && v !== undefined ? Number(v) : undefined;
  const latitude = row.latitude !== null && row.latitude !== undefined ? Number(row.latitude) : undefined;
  const longitude = row.longitude !== null && row.longitude !== undefined ? Number(row.longitude) : undefined;
  const metadata = row.metadata && typeof row.metadata === 'object' ? (row.metadata as Record<string, unknown>) : {};
  const locationLabel = row.geographic_location
    ?? row.geolocation_name
    ?? (latitude !== undefined && longitude !== undefined ? `${latitude.toFixed(4)}, ${longitude.toFixed(4)}` : null);
  const dataSourceNames = Array.isArray(row.data_source_names) ? row.data_source_names : [];
  const dataSourceIds = Array.isArray(row.data_source_ids) ? row.data_source_ids : [];
  const sourceTypes = Array.isArray(row.source_types) ? row.source_types : [];
  const studyTitles = Array.isArray(row.study_titles) ? row.study_titles : [];
  const createdAt = row.created_at ? new Date(row.created_at) : new Date();
  const updatedAt = row.updated_at ? new Date(row.updated_at) : createdAt;
  // Strip the "source|" prefix (e.g. "metalog|5O_Y1.1"); the data source is shown separately.
  const cleanExternalId = row.external_id ? stripSourcePrefix(row.external_id) : null;
  const name = row.name ?? cleanExternalId ?? row.id;
  const collectionDate = row.collection_date ? new Date(row.collection_date).toISOString().slice(0, 10) : null;
  const collectionDateEnd = row.collection_date_end ? new Date(row.collection_date_end).toISOString().slice(0, 10) : null;

  return {
    id: row.id,
    externalId: cleanExternalId,
    name,
    description: row.description ?? null,
    sampleAlias: row.sample_alias ?? null,
    accession: row.accession ?? null,
    environment: row.environment_biome ?? '',
    geographicLocation: row.geographic_location ?? null,
    geolocationName: row.geolocation_name ?? null,
    locationResolution: row.location_resolution ?? null,
    location: locationLabel,
    latitude,
    longitude,
    depth: row.depth !== null && row.depth !== undefined ? Number(row.depth) : undefined,
    depthMin: row.depth_min_meters !== null && row.depth_min_meters !== undefined ? Number(row.depth_min_meters) : undefined,
    depthMax: row.depth_max_meters !== null && row.depth_max_meters !== undefined ? Number(row.depth_max_meters) : undefined,
    elevationMeters: row.elevation_meters !== null && row.elevation_meters !== undefined ? Number(row.elevation_meters) : undefined,
    temperature: row.temperature !== null && row.temperature !== undefined ? Number(row.temperature) : undefined,
    ph: row.ph !== null && row.ph !== undefined ? Number(row.ph) : undefined,
    salinity: row.salinity !== null && row.salinity !== undefined ? Number(row.salinity) : undefined,
    salinityUnit: row.salinity_unit ?? null,
    dissolvedOxygen: num(row.dissolved_oxygen),
    dissolvedOxygenUnit: row.dissolved_oxygen_unit ?? null,
    nitrate: num(row.nitrate),
    nitrateUnit: row.nitrate_unit ?? null,
    nitrite: num(row.nitrite),
    nitriteUnit: row.nitrite_unit ?? null,
    ammonium: num(row.ammonium),
    ammoniumUnit: row.ammonium_unit ?? null,
    phosphate: num(row.phosphate),
    phosphateUnit: row.phosphate_unit ?? null,
    conductivity: num(row.conductivity),
    conductivityUnit: row.conductivity_unit ?? null,
    dissolvedOrganicCarbon: num(row.dissolved_organic_carbon),
    dissolvedOrganicCarbonUnit: row.dissolved_organic_carbon_unit ?? null,
    filtrationLowerThresholdUm: num(row.filtration_lower_threshold_um),
    filtrationUpperThresholdUm: num(row.filtration_upper_threshold_um),
    checkmCompleteness: num(row.checkm_completeness),
    checkmContamination: num(row.checkm_contamination),
    checkmTool: row.checkm_tool ?? null,
    checkmSource: row.checkm_source ?? null,
    genomeSize: num(row.genome_size),
    genomeQuality: row.genome_quality ?? null,
    currentPrecipitationMm: row.current_precipitation_mm !== null && row.current_precipitation_mm !== undefined ? Number(row.current_precipitation_mm) : undefined,
    meanAnnualPrecipitationMm: row.mean_annual_precipitation_mm !== null && row.mean_annual_precipitation_mm !== undefined ? Number(row.mean_annual_precipitation_mm) : undefined,
    meanAnnualTemperature: row.mean_annual_temperature !== null && row.mean_annual_temperature !== undefined ? Number(row.mean_annual_temperature) : undefined,
    environmentalPackage: row.environmental_package ?? null,
    environmentBiome: row.primary_biome ?? null,
    primaryBiome: row.primary_biome ?? null,
    environmentFeature: row.environment_feature ?? null,
    environmentMaterial: row.environment_material ?? null,
    hostTaxid: row.host_taxid ?? null,
    hostSpecies: row.host_scientific_name ?? null,
    dataSourceIds,
    dataSourceNames,
    sourceTypes,
    studyTitles,
    studyLinks: Array.isArray(row.study_links) ? row.study_links : null,
    env_terms: [],
    collectionDate,
    collectionDateEnd,
    assemblyCount: row.assembly_count ?? 0,
    bgcCount: row.bgc_count ?? 0,
    // null (not 0) when the row didn't join the counts MV: "no data" vs zero families.
    gcfCount: row.gcf_count ?? null,
    clusteredBgcCount: row.clustered_bgc_count ?? null,
    unclusteredBgcCount: row.unclustered_bgc_count ?? null,
    gtdbAccession: row.gtdb_accession ?? null,
    genomeTaxonomy: row.taxonomy ?? null,
    metadata,
    createdAt,
    updatedAt,
    goldEcosystemPath: row.gold_ecosystem_path ?? null,
    goldEcosystemMetadata: row.gold_ecosystem_metadata ?? null,
  };
};

// A scalar subquery rather than a join: the count and data queries share this WHERE clause
// and neither carries the MV.
const sampleGcfCount = (column: Prisma.Sql): Prisma.Sql => Prisma.sql`COALESCE((
  SELECT sgc.${column} FROM sample_gcf_counts_mv sgc WHERE sgc.sample_id = sb.id
), 0)`;

export const buildSampleAdvancedCondition = (condition: FilterCondition): Prisma.Sql | null => {
  switch (condition.field) {
    case 'id':
      return buildMultiColumnTextCondition([
        Prisma.sql`sb.external_id`,
        Prisma.sql`sb.id::text`,
        Prisma.sql`sb.name`,
      ], condition, toLike);
    case 'environment':
      return buildTextCondition(Prisma.sql`sb.environment_biome`, condition, toLike);
    case 'biome':
      return buildTextCondition(Prisma.sql`sb.primary_biome`, condition, toLike);
    case 'goldEcosystem':
      return buildTextCondition(Prisma.sql`sb.gold_ecosystem_path`, condition, toLike);
    case 'environmentFeature':
      return buildTextCondition(Prisma.sql`sb.environment_feature`, condition, toLike);
    case 'environmentMaterial':
      return buildTextCondition(Prisma.sql`sb.environment_material`, condition, toLike);
    case 'host':
      return buildMultiColumnTextCondition([
        Prisma.sql`sb.host_scientific_name`,
        Prisma.sql`sb.host_taxid::text`,
      ], condition, toLike);
    case 'dataSource':
      return buildDataSourceCondition(condition);
    case 'study':
      return buildStudyCondition(condition);
    case 'assemblies':
      return buildNumberCondition(Prisma.sql`sb.assembly_count`, condition);
    case 'bgcs':
      return buildNumberCondition(Prisma.sql`sb.bgc_count`, condition);
    // COALESCE(..., 0), not EXISTS: build_browse_corpus.py indexes a missing row as 0, and the
    // two backends must agree.
    case 'gcfCount':
      return buildNumberCondition(sampleGcfCount(Prisma.sql`gcf_count`), condition);
    case 'clusteredBgcCount':
      return buildNumberCondition(sampleGcfCount(Prisma.sql`clustered_bgc_count`), condition);
    case 'unclusteredBgcCount':
      return buildNumberCondition(sampleGcfCount(Prisma.sql`unclustered_bgc_count`), condition);
    case 'lat':
      return buildNumberCondition(Prisma.sql`sb.latitude`, condition);
    case 'lon':
      return buildNumberCondition(Prisma.sql`sb.longitude`, condition);
    case 'sourceType':
      return buildSourceTypeCondition(condition);
    default:
      return null;
  }
};

const buildDataSourceCondition = (condition: FilterCondition): Prisma.Sql | null => {
  const value = extractStringValue(condition.value);
  if (!value) return null;
  if (isValidUuid(value)) {
    return Prisma.sql`${value}::uuid = ANY(sb.data_source_ids)`;
  }
  const comparison = buildTextCondition(Prisma.sql`ds.name`, condition, toLike);
  if (!comparison) return null;
  return Prisma.sql`
    EXISTS (
      SELECT 1
      FROM UNNEST(sb.data_source_names) AS ds(name)
      WHERE ${comparison}
    )
  `;
};

const buildStudyCondition = (condition: FilterCondition): Prisma.Sql | null => {
  const comparison = buildTextCondition(Prisma.sql`st.title`, condition, toLike);
  if (!comparison) return null;
  return Prisma.sql`
    EXISTS (
      SELECT 1
      FROM UNNEST(sb.study_titles) AS st(title)
      WHERE ${comparison}
    )
  `;
};

const buildSourceTypeCondition = (condition: FilterCondition): Prisma.Sql | null => {
  const values = extractMultipleValues(condition.value);
  if (!values.length) return null;
  const valueExpressions = values.map((val) => Prisma.sql`${val}`);
  const arrayLiteral = Prisma.sql`ARRAY[${Prisma.join(valueExpressions, ', ')}]::text[]`;
  if (condition.operator === 'not_in' || condition.operator === 'not_equals') {
    return Prisma.sql`NOT (sb.source_types && ${arrayLiteral})`;
  }
  return Prisma.sql`sb.source_types && ${arrayLiteral}`;
};
