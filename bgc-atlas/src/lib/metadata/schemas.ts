import { z } from 'zod';

const isValidISODate = (dateStr: string): boolean => {
  const isoDateRegex = /^\d{4}-\d{2}-\d{2}$/;
  if (!isoDateRegex.test(dateStr)) {
    return false;
  }
  const date = new Date(dateStr);
  return !isNaN(date.getTime()) && date.toISOString().startsWith(dateStr);
};

const stringToNumber = z
  .string()
  .transform((val) => {
    const trimmed = val.trim();
    if (trimmed === '' || trimmed === 'NA' || trimmed === 'N/A' || trimmed === 'null') {
      return undefined;
    }
    const num = parseFloat(trimmed);
    return isNaN(num) ? undefined : num;
  })
  .optional();

const stringToInteger = z
  .string()
  .transform((val) => {
    const trimmed = val.trim();
    if (trimmed === '' || trimmed === 'NA' || trimmed === 'N/A' || trimmed === 'null') {
      return undefined;
    }
    const num = parseInt(trimmed, 10);
    return isNaN(num) ? undefined : num;
  })
  .optional();

const optionalString = z
  .string()
  .transform((val) => {
    const trimmed = val.trim();
    return trimmed === '' || trimmed === 'NA' || trimmed === 'N/A' || trimmed === 'null' ? undefined : trimmed;
  })
  .optional();

export const SampleMetadataSchema = z
  .object({
    sample_alias: z.string().min(1, 'Sample alias is required').max(255),

    latitude: z.number().min(-90).max(90).optional(),
    longitude: z.number().min(-180).max(180).optional(),
    geographic_location: z.string().max(500).optional(),
    location_resolution: z.string().max(100).optional(),
    geolocation_name: z.string().max(500).optional(),

    environment_biome: z.string().max(500).optional(),
    environment_feature: z.string().max(500).optional(),
    environment_material: z.string().max(500).optional(),
    environmental_package: z.string().max(100).optional(),

    depth_min_meters: z.number().min(0).optional(),
    depth_max_meters: z.number().min(0).optional(),
    elevation_meters: z.number().optional(),

    temperature: z.number().min(-50).max(100).optional(),
    ph: z.number().min(0).max(14).optional(),
    salinity: z.number().min(0).optional(),
    salinity_unit: z.string().max(20).optional(),
    current_precipitation_mm: z.number().min(0).optional(),
    mean_annual_precipitation_mm: z.number().min(0).optional(),
    mean_annual_temperature: z.number().optional(),

    collection_date: z
      .union([z.string(), z.date()])
      .refine((val) => {
        if (val instanceof Date) return !isNaN(val.getTime());
        return isValidISODate(val);
      }, 'Must be a valid date in YYYY-MM-DD format')
      .optional(),
    collection_date_end: z
      .union([z.string(), z.date()])
      .refine((val) => {
        if (val instanceof Date) return !isNaN(val.getTime());
        return isValidISODate(val);
      }, 'Must be a valid date in YYYY-MM-DD format')
      .optional(),
    description: z.string().max(2000).optional(),

    host_taxid: z.number().int().positive().optional(),
    host_scientific_name: z.string().max(255).optional(),

    external_id: z.string().max(255).optional(),
    accession: z.string().max(255).optional(),

    additional_metadata: z.record(z.string(), z.any()).optional(),

    assembly_filenames: z.array(z.string()).optional(),
  })
  .refine(
    (data) => {
      if ((data.latitude !== undefined && data.longitude === undefined) ||
          (data.latitude === undefined && data.longitude !== undefined)) {
        return false;
      }
      return true;
    },
    {
      message: 'Both latitude and longitude must be provided together',
      path: ['latitude'],
    }
  )
  .refine(
    (data) => {
      if (
        data.depth_min_meters !== undefined &&
        data.depth_max_meters !== undefined &&
        data.depth_min_meters > data.depth_max_meters
      ) {
        return false;
      }
      return true;
    },
    {
      message: 'depth_min_meters must be less than or equal to depth_max_meters',
      path: ['depth_min_meters'],
    }
  )
  .refine(
    (data) => {
      if (data.collection_date && data.collection_date_end) {
        const start = typeof data.collection_date === 'string'
          ? new Date(data.collection_date)
          : data.collection_date;
        const end = typeof data.collection_date_end === 'string'
          ? new Date(data.collection_date_end)
          : data.collection_date_end;
        if (start > end) {
          return false;
        }
      }
      return true;
    },
    {
      message: 'collection_date must be before or equal to collection_date_end',
      path: ['collection_date'],
    }
  );

export const CsvRowSchema = z
  .object({
    sample_alias: z.string().min(1, 'Sample alias is required').max(255),

    latitude: z.union([z.number(), stringToNumber]).optional(),
    longitude: z.union([z.number(), stringToNumber]).optional(),
    geographic_location: optionalString,
    location_resolution: optionalString,
    geolocation_name: optionalString,

    environment_biome: optionalString,
    environment_feature: optionalString,
    environment_material: optionalString,
    environmental_package: optionalString,

    depth_min_meters: z.union([z.number(), stringToNumber]).optional(),
    depth_max_meters: z.union([z.number(), stringToNumber]).optional(),
    elevation_meters: z.union([z.number(), stringToNumber]).optional(),

    temperature: z.union([z.number(), stringToNumber]).optional(),
    ph: z.union([z.number(), stringToNumber]).optional(),
    salinity: z.union([z.number(), stringToNumber]).optional(),
    salinity_unit: optionalString,
    current_precipitation_mm: z.union([z.number(), stringToNumber]).optional(),
    mean_annual_precipitation_mm: z.union([z.number(), stringToNumber]).optional(),
    mean_annual_temperature: z.union([z.number(), stringToNumber]).optional(),

    collection_date: optionalString,
    collection_date_end: optionalString,
    description: optionalString,

    host_taxid: z.union([z.number(), stringToInteger]).optional(),
    host_scientific_name: optionalString,

    external_id: optionalString,
    accession: optionalString,

    // CSV column of comma-separated filenames
    assembly_filenames: z
      .string()
      .transform((val) => {
        const trimmed = val.trim();
        if (trimmed === '' || trimmed === 'NA' || trimmed === 'N/A') {
          return undefined;
        }
        return trimmed.split(',').map((f) => f.trim()).filter(Boolean);
      })
      .optional(),
  })
  .transform((data) => {
    return {
      sample_alias: data.sample_alias,
      latitude: data.latitude,
      longitude: data.longitude,
      geographic_location: data.geographic_location,
      location_resolution: data.location_resolution,
      geolocation_name: data.geolocation_name,
      environment_biome: data.environment_biome,
      environment_feature: data.environment_feature,
      environment_material: data.environment_material,
      environmental_package: data.environmental_package,
      depth_min_meters: data.depth_min_meters,
      depth_max_meters: data.depth_max_meters,
      elevation_meters: data.elevation_meters,
      temperature: data.temperature,
      ph: data.ph,
      salinity: data.salinity,
      salinity_unit: data.salinity_unit,
      current_precipitation_mm: data.current_precipitation_mm,
      mean_annual_precipitation_mm: data.mean_annual_precipitation_mm,
      mean_annual_temperature: data.mean_annual_temperature,
      collection_date: data.collection_date,
      collection_date_end: data.collection_date_end,
      description: data.description,
      host_taxid: data.host_taxid,
      host_scientific_name: data.host_scientific_name,
      external_id: data.external_id,
      accession: data.accession,
      assembly_filenames: data.assembly_filenames,
    };
  });

export const MetadataBatchSchema = z.object({
  samples: z.array(SampleMetadataSchema).min(1).max(1000),
});

export type SampleMetadataInput = z.infer<typeof SampleMetadataSchema>;
export type CsvRowInput = z.input<typeof CsvRowSchema>;
export type MetadataBatchInput = z.infer<typeof MetadataBatchSchema>;
