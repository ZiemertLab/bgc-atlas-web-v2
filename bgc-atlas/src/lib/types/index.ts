import type { AbstractState } from '@/lib/abstract-license';

export interface Sample {
  id: string;
  externalId?: string | null;
  name: string;
  accession?: string;
  environment: string;
  location?: string; // legacy

  latitude?: number;
  longitude?: number;
  geographicLocation?: string;
  locationResolution?: string;

  collectionDate?: string;
  collectionDateEnd?: string;
  date?: string; // legacy

  environmentBiome?: string;
  primaryBiome?: string | null;
  environmentFeature?: string;
  environmentMaterial?: string;
  environmentalPackage?: string;
  env_terms?: string[];

  depth?: number; // legacy
  depthMin?: number;
  depthMax?: number;
  elevationMeters?: number;

  hostTaxid?: number;
  hostSpecies?: string;

  temperature?: number;
  ph?: number;
  salinity?: number;
  salinityUnit?: string;
  currentPrecipitationMm?: number;
  meanAnnualPrecipitationMm?: number;
  meanAnnualTemperature?: number;
  // Only populated on the sample detail view (read from `samples`, not the MV).
  dissolvedOxygen?: number;
  dissolvedOxygenUnit?: string | null;
  nitrate?: number;
  nitrateUnit?: string | null;
  nitrite?: number;
  nitriteUnit?: string | null;
  ammonium?: number;
  ammoniumUnit?: string | null;
  phosphate?: number;
  phosphateUnit?: string | null;
  conductivity?: number;
  conductivityUnit?: string | null;
  dissolvedOrganicCarbon?: number;
  dissolvedOrganicCarbonUnit?: string | null;
  filtrationLowerThresholdUm?: number;
  filtrationUpperThresholdUm?: number;

  checkmCompleteness?: number;
  checkmContamination?: number;
  /** 'CheckM' (v1) | 'CheckM2' | null when the source does not say. */
  checkmTool?: string | null;
  checkmSource?: string | null;
  genomeSize?: number;
  genomeQuality?: string | null;

  bgcCount?: number;
  // Distinct GCFs at threshold 0.4. Many BGCs belong to no family, so gcfCount is not a
  // grouping of bgcCount; show the clustered/unclustered split with it.
  gcfCount?: number | null;
  clusteredBgcCount?: number | null;
  unclusteredBgcCount?: number | null;
  assemblyCount?: number;
  // Only for rows from /api/assemblies (assembly view mode).
  assemblyId?: string;
  assemblyName?: string | null;
  antismashRunId?: string | null;
  assemblyInfo?: string;
  type?: string; // assembly source type
  assemblies?: Array<{
    id: string;
    external_id?: string;
    type?: string;
    length_bp?: number | null;
    n_contigs?: number | null;
    bgc_count?: number;
  }>;
  assembliesDetailed?: Array<{
    id: string;
    external_id?: string;
    name?: string;
    source_type?: string;
    assembly_level?: string;
    sequencing_technology?: string;
    contig_count?: number;
    bgc_count?: number;
    bgcs?: Array<{
      id: string;
      filename?: string;
      contig?: string;
      start_pos?: number;
      end_pos?: number;
      product_category?: string[];
      // `product` is a mapping alias absent from _source on older documents; read either.
      product_type?: string[];
      product?: string[];
      gcf_id?: string;
      // distance, lower = better
      gcf_distance?: number;
      is_complete?: boolean;
    }>;
    analyses?: Array<{
      id: string;
      name?: string;
      analysis_type?: string;
      tool_name?: string;
      tool_version?: string;
    }>;
    created_at?: string;
    updated_at?: string;
  }>;

  sampleAlias?: string;
  dataSourceIds?: string[];
  dataSourceNames?: string[];
  // 'isolate' | 'MAG' | 'SAG' (genomes) or 'metagenome'.
  sourceTypes?: string[];
  // Only with includeGtdbAccession=1.
  gtdbAccession?: string | null;
  // Only with includeTaxonomy=1.
  genomeTaxonomy?: {
    domain: string | null;
    phylum: string | null;
    class: string | null;
    order: string | null;
    family: string | null;
    genus: string | null;
    species: string | null;
    gtdbLineage: string | null;
  } | null;

  studyInfo?: {
    id: string;
    external_id?: string;
    title?: string;
    abstract?: string;
    study_type?: string;
    bioproject?: string;
    accession?: string;
  };
  studyTitles?: string[];
  // Only with includeStudyLinks=1.
  studyLinks?: Array<{
    accession?: string | null;
    bioproject?: string | null;
    title?: string | null;
  }> | null;

  biomes?: Array<{
    id: string;
    name: string;
    description?: string;
    level?: number;
    parent?: {
      id: string;
      name: string;
    } | null;
  }>;

  measurements?: Record<string, Array<{
    value: string;
    unit?: string;
    measured_at?: string;
    source?: string;
  }>>;

  runs?: Array<{
    id: string;
    external_id?: string;
    name?: string;
    instrument_model?: string;
    instrument_platform?: string;
    accession?: string;
    secondary_accession?: string;
    metadata?: Record<string, unknown>;
    analyses?: Array<{
      id: string;
      name?: string;
      analysis_type?: string;
      tool_name?: string;
      tool_version?: string;
    }>;
    created_at?: string;
    updated_at?: string;
  }>;

  status?: string;

  description?: string;
  metadata: Record<string, unknown>;
  createdAt: Date | string;
  updatedAt: Date | string;

  goldEcosystemPath?: string | null;
  goldEcosystemMetadata?: Record<string, unknown> | null;
}

export interface BGC {
  id: string;
  sampleId: string;
  name: string;
  accession: string;
  length: number;
  startPos: number;
  endPos: number;
  strand: '+' | '-';
  genes: Gene[];
  gcfId?: string;
  taxonomy?: TaxonomyInfo;
  description?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface Gene {
  id: string;
  bgcId: string;
  name: string;
  startPos: number;
  endPos: number;
  strand: '+' | '-';
  product?: string;
  function?: string;
  domains: Domain[];
}

export interface Domain {
  id: string;
  name: string;
  type: string;
  eValue: number;
  score: number;
  startPos: number;
  endPos: number;
}

export interface GCF {
  id: string;
  name: string;
  description?: string;
  bgcCount: number;
  taxonomy?: TaxonomyInfo;
  representative?: BGC;
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export interface GcfListItem {
  id: string;
  name: string;
  clusterMethod: string | null;
  // 'seed' (defined by the truncation seed) | 'fragmented' (de-novo clusters of the leftovers).
  familyClass: 'seed' | 'fragmented' | null;
  representativeBgcId: string | null;
  description: string | null;
  /** Display-only alias, not an identifier. */
  petName: string | null;
  memberBgcCount: number;
  assemblyCount: number;
  completeBgcCount: number;
  partialBgcCount: number;
  // distance, lower = better
  avgDistance: number | null;
  minDistance: number | null;
  maxDistance: number | null;
  medianDistance: number | null;
  uniqueProductCategories: number;
  productCategories: string[];
  uniqueTaxaCount: number;
  seedAssignments: number;
  derivedAssignments: number;
  novelAssignments: number;
  // v3 split of derivedAssignments (gcf_route_counts_mv); detail route only.
  containedAssignments?: number;
  orphanQueryAssignments?: number;
  taxonomySummary?: TaxonomySummary;
}

export interface TaxonomyInfo {
  kingdom?: string;
  phylum?: string;
  class?: string;
  order?: string;
  family?: string;
  genus?: string;
  species?: string;
}

export type TaxonomyRank = 'domain' | 'phylum' | 'class' | 'order' | 'family' | 'genus' | 'species';

export interface TaxonomyDistributionData {
  domain: string | null;
  phylum: string | null;
  class: string | null;
  order: string | null;
  family: string | null;
  genus: string | null;
  species: string | null;
  gtdbLineage: string;
  bgcCount: number;
  percentage: number;
  isPartial: boolean;
  rankDepth: number;
}

export interface TaxonomySummary {
  totalBgcsWithTaxonomy: number;
  totalBgcsWithoutTaxonomy: number;
  coveragePercentage: number;
  uniqueDomains: number;
  uniquePhyla: number;
  uniqueClasses: number;
  uniqueOrders: number;
  uniqueFamilies: number;
  uniqueGenera: number;
  uniqueSpecies: number;
}

export interface TaxonomyDistributionResponse {
  distribution: TaxonomyDistributionData[];
  summary: TaxonomySummary;
}

export type TaxonomyDistributionByRank = Partial<Record<TaxonomyRank, Record<string, number>>>;

export interface ApiResponse<T> {
  success: boolean;
  data: T;
  message?: string;
  error?: string;
}

export type PaginatedResponse<T> = ApiResponse<{
  data: T[];
  total: number;
  offset: number;
  limit: number;
}>;

// study_bgc_summary row; backs /studies.
export interface Study {
  study_key: string;
  study_id: string;
  title: string | null;
  study_name: string | null;
  center_name: string | null;
  accession: string | null;
  bioproject: string | null;
  study_type: string | null;
  sample_count: number;
  total_bgcs: number;
  clustered_bgcs: number;
  gcf_coverage: number | null;   // clustered_bgcs / total_bgcs (0..1)
  distinct_gcfs: number;
  exclusive_gcfs: number;        // GCFs occurring only in this study
  rare_gcfs: number;
  pct_complete: number | null;
  product_type_count: number;
  product_category_dist: Record<string, number> | null;  // {category: bgc_count}
  top_exclusive_gcfs: { gcf_id: string; bgcs_in_study: number }[] | null;
  primary_biome: string | null;
  gold_bucket: string | null;
  // GOLD shares by level (1-3), percentages summing to 100 per level; gold_bucket is the
  // mode of the same data. Null when no sample carries a GOLD path.
  ecosystem_dist_by_level: Record<number, Record<string, number>> | null;
  complete_bgcs: number;
  // MAG / SAG / isolate assemblies; metagenome assemblies are not genomes.
  genome_count: number;
  // {metagenome|MAG|SAG|isolate: bgc_count}. One assembly per BGC, so unlike
  // product_category_dist these partition total_bgcs.
  source_type_dist: Record<string, number> | null;
  // Raw data_sources.name values; display through formatDataSourceName.
  data_sources: string[] | null;
  // The licence/publisher/DOI for attribution are on /api/studies/{id}.
  abstract_state: AbstractState;
}

export interface SampleStudy {
  id: string;
  external_id?: string;
  title?: string;
  abstract?: string;
  study_type?: string;
  study_name?: string;
  center_name?: string;
  accession?: string;
  bioproject?: string;
  secondary_accession?: string;
  data_source_ids?: string[];
  biome_ids?: string[];
  metadata?: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  biomes: Array<{
    id: string;
    name: string;
    description?: string;
    level?: number;
    parent?: {
      id: string;
      name: string;
    } | null;
  }>;
  sample_count: number;
  // A short preview; sample_count is the total.
  related_samples: Array<{
    id: string;
    external_id?: string;
    name?: string;
    environment_biome?: string;
    latitude?: number;
    longitude?: number;
  }>;
  geographic_bounds?: {
    north: number;
    south: number;
    east: number;
    west: number;
    center: {
      latitude: number;
      longitude: number;
    };
  };
  environment_distribution: Record<string, number>;
}

export interface SampleMeasurement {
  id: string;
  key: string;
  value: string;
  unit?: string;
  measured_at?: string;
  source?: string;
  metadata?: Record<string, unknown>;
  created_at: string;
}

export interface MeasurementKeyStats {
  key: string;
  total_measurements: number;
  unique_sources: string[];
  date_range: {
    earliest: string | null;
    latest: string | null;
  };
  units: string[];
  statistics?: {
    count: number;
    min: number;
    max: number;
    mean: number;
    median: number;
  };
}

export interface SampleAssembly {
  id: string;
  external_id?: string;
  name?: string;
  source_type?: string;
  assembly_level?: string;
  sequencing_technology?: string;
  contig_count?: number;
  bgc_count: number;
  accession?: string;
  data_source_ids?: string[];
  metadata?: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  analyses: Array<{
    id: string;
    name?: string;
    analysis_type?: string;
    tool_name?: string;
    tool_version?: string;
  }>;
  // BGCs are not inlined; they come from /api/bgcs?assembly=<id>.
}

export interface SampleStudiesResponse extends ApiResponse<SampleStudy[]> {
  total: number;
  summary: {
    total_studies: number;
    study_types: string[];
    total_related_samples: number;
    all_biomes: string[];
    center_names: string[];
    bioprojects: string[];
  };
}

export interface SampleMeasurementsResponse extends ApiResponse<{
  measurements: SampleMeasurement[];
  measurements_by_key: Record<string, SampleMeasurement[]>;
}> {
  pagination: {
    total: number;
    limit: number;
    offset: number;
    has_more: boolean;
  };
  summary: {
    total_measurements: number;
    total_in_database: number;
    unique_keys: number;
    unique_sources: string[];
    date_range: {
      earliest: string | null;
      latest: string | null;
    };
    key_statistics: MeasurementKeyStats[];
  };
  filters: {
    key?: string;
    source?: string;
    min_date?: string;
    max_date?: string;
  };
}

export interface SampleAssembliesResponse extends ApiResponse<SampleAssembly[]> {
  // Sample-wide, not just this page.
  total: number;
  // Backend defaults: limit=50, offset=0.
  limit?: number;
  offset?: number;
  page_size?: number;
  has_more?: boolean;
  summary: {
    // sample-wide
    total_assemblies: number;
    // this page only
    total_bgcs: number;
    assembly_types: string[];
    sequencing_technologies: string[];
  };
}
