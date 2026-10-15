export interface SampleMetadata {
  sample_alias: string;

  latitude?: number;
  longitude?: number;
  geographic_location?: string;
  location_resolution?: string;
  geolocation_name?: string;

  environment_biome?: string;
  environment_feature?: string;
  environment_material?: string;
  environmental_package?: string;

  depth_min_meters?: number;
  depth_max_meters?: number;
  elevation_meters?: number;

  temperature?: number;
  ph?: number;
  salinity?: number;
  salinity_unit?: string;
  current_precipitation_mm?: number;
  mean_annual_precipitation_mm?: number;
  mean_annual_temperature?: number;

  collection_date?: string | Date;
  collection_date_end?: string | Date;
  description?: string;

  host_taxid?: number;
  host_scientific_name?: string;

  external_id?: string;
  accession?: string;

  additional_metadata?: Record<string, unknown>;

  assembly_filenames?: string[];
}

export interface MetadataBatch {
  samples: SampleMetadata[];
}

export interface FieldError {
  field: string;
  message: string;
  value?: unknown;
}

// Non-blocking.
export interface FieldWarning {
  field: string;
  message: string;
  value?: unknown;
}

export interface SampleValidationResult {
  sampleAlias: string;
  valid: boolean;
  errors: FieldError[];
  warnings: FieldWarning[];
  data?: SampleMetadata;
}

export interface BatchValidationResult {
  valid: boolean;
  totalSamples: number;
  validSamples: number;
  invalidSamples: number;
  samples: SampleValidationResult[];
}

export type CsvFormat = 'wide' | 'long';

export interface CsvParsingOptions {
  delimiter?: ',' | '\t' | ';';
  format?: CsvFormat;
  skipEmptyRows?: boolean;
  trimValues?: boolean;
}

export interface CsvParsingResult {
  format: CsvFormat;
  delimiter: string;
  samples: Record<string, string>[];
  errors: Array<{ row: number; message: string }>;
}

export type AssemblyMappingStrategy = 'filename_convention' | 'csv_column' | 'single_sample';

export interface AssemblyMappingConfig {
  strategy: AssemblyMappingStrategy;
  assemblyFilenames?: string[]; // Available assembly filenames
  singleSampleAlias?: string; // For single_sample strategy
}

export interface SubmissionData {
  samples: SampleMetadata[];
  validationResults: BatchValidationResult;
  assemblyMapping: Map<string, string[]>; // sampleAlias -> assemblyFilenames[]
}
