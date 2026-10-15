import { CSV_HEADERS, CSV_EXAMPLE_ROW, FIELD_METADATA, ALL_FIELD_NAMES } from './constants';

export function generateCsvTemplate(): string {
  const headers = CSV_HEADERS.join(',');
  const exampleRow = CSV_HEADERS.map((header) => {
    const value = CSV_EXAMPLE_ROW[header as keyof typeof CSV_EXAMPLE_ROW];
    if (value && (value.includes(',') || value.includes('"') || value.includes('\n'))) {
      return `"${value.replace(/"/g, '""')}"`;
    }
    return value || '';
  }).join(',');

  return `${headers}\n${exampleRow}`;
}

export function generateLongFormatTemplate(): string {
  const lines: string[] = [];

  lines.push('# BGC Atlas Sample Metadata Template (TSV Format - Tab Separated)');
  lines.push('# This format uses key-value pairs: sample_alias [TAB] metadata_key [TAB] value');
  lines.push('# Required: sample_alias for each sample');
  lines.push('# Recommended: latitude, longitude, environment_biome, collection_date');
  lines.push('#');
  lines.push('# Available metadata_key values:');
  lines.push('# Location: latitude, longitude, geographic_location, location_resolution, geolocation_name');
  lines.push('# Environmental: environment_biome, environment_feature, environment_material, environmental_package');
  lines.push('# Depth/Elevation: depth_min_meters, depth_max_meters, elevation_meters');
  lines.push('# Measurements: temperature, ph, salinity, salinity_unit, current_precipitation_mm,');
  lines.push('#               mean_annual_precipitation_mm, mean_annual_temperature');
  lines.push('# Collection: collection_date, collection_date_end, description');
  lines.push('# Host: host_taxid, host_scientific_name');
  lines.push('# Identifiers: external_id, accession');
  lines.push('#');
  lines.push('# To add multiple samples:');
  lines.push('#   - Repeat rows with different sample_alias values');
  lines.push('#   - Each sample can have different metadata fields');
  lines.push('#   - Only include fields you have data for');
  lines.push('#');

  lines.push('sample_alias\tmetadata_key\tvalue');

  const allFields = ALL_FIELD_NAMES.filter(f => f !== 'sample_alias');

  for (const field of allFields) {
    const value = CSV_EXAMPLE_ROW[field as keyof typeof CSV_EXAMPLE_ROW];
    const metadata = FIELD_METADATA[field as keyof typeof FIELD_METADATA];
    const marker = metadata.required ? '[REQUIRED]' : metadata.recommended ? '[RECOMMENDED]' : '';

    if (value) {
      lines.push(`${CSV_EXAMPLE_ROW.sample_alias}\t${field}\t${value}`);
    } else {
      lines.push(`# ${CSV_EXAMPLE_ROW.sample_alias}\t${field}\t${marker} ${metadata.description}`);
    }
  }

  lines.push('');
  lines.push('# Add more samples below (example for sample_002):');
  lines.push(`# sample_002\tlatitude\t48.8566`);
  lines.push(`# sample_002\tlongitude\t2.3522`);
  lines.push(`# sample_002\tenvironment_biome\turban soil [ENVO:00005776]`);
  lines.push(`# sample_002\tcollection_date\t2024-02-01`);

  return lines.join('\n');
}

export function getTemplateDownloadContent(format: 'tsv' | 'csv' | 'wide' = 'tsv'): {
  content: string;
  filename: string;
  contentType: string;
} {
  let content: string;
  let filename: string;
  let contentType: string;

  switch (format) {
    case 'csv':
      // Long format but comma-separated
      content = generateLongFormatTemplate().replace(/\t/g, ',');
      filename = 'bgc-atlas-metadata-template.csv';
      contentType = 'text/csv; charset=utf-8';
      break;
    case 'wide':
      content = generateCsvTemplate();
      filename = 'bgc-atlas-metadata-template-wide.csv';
      contentType = 'text/csv; charset=utf-8';
      break;
    case 'tsv':
    default:
      content = generateLongFormatTemplate();
      filename = 'bgc-atlas-metadata-template.tsv';
      contentType = 'text/tab-separated-values; charset=utf-8';
      break;
  }

  return {
    content,
    filename,
    contentType,
  };
}
