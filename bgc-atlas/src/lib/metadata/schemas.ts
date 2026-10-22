import { z } from 'zod';

const isValidISODate = (dateStr: string): boolean => {
  const isoDateRegex = /^\d{4}-\d{2}-\d{2}$/;
  if (!isoDateRegex.test(dateStr)) {
    return false;
  }
  const date = new Date(dateStr);
  return !isNaN(date.getTime()) && date.toISOString().startsWith(dateStr);
};

/** Cells that mean "not given". */
const isMissing = (trimmed: string) =>
  trimmed === '' || trimmed === 'NA' || trimmed === 'N/A' || trimmed === 'null';

/** A plain decimal number: optional sign, digits, a dot, an exponent. Nothing else. */
const PLAIN_NUMBER = /^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/;

/**
 * Read a number strictly: anything that is not a plain number is a validation error naming it,
 * not a silent "not given" or a leading-digits guess. A decimal comma is refused ('1,200' could
 * be a thousands separator). A coordinate's hemisphere letter ('12.5 S', 'W 45') sets the sign.
 */
function readNumber(hemisphere?: { positive: string; negative: string }) {
  // unknown, not string: a form field arrives as a number, and z.union would hide the message.
  return z
    .unknown()
    .transform((input, ctx) => {
      if (input === undefined || input === null) return undefined;
      if (typeof input === 'number') {
        if (Number.isFinite(input)) return input;
        ctx.addIssue({ code: 'custom', message: 'is not a number' });
        return z.NEVER;
      }
      if (typeof input !== 'string') {
        ctx.addIssue({ code: 'custom', message: 'is not a number' });
        return z.NEVER;
      }
      const val = input;
      let text = val.trim();
      if (isMissing(text)) return undefined;
      let sign = 1;
      if (hemisphere) {
        const letters = `${hemisphere.positive}${hemisphere.negative}`;
        const m = new RegExp(`^(?:([${letters}])\\s*)?(.*?)\\s*°?\\s*(?:([${letters}]))?$`, 'i').exec(text);
        const letter = (m?.[1] ?? m?.[3])?.toUpperCase();
        if (m && letter && !(m[1] && m[3])) {
          text = m[2].trim();
          if (/^[+-]/.test(text)) {
            ctx.addIssue({ code: 'custom', message: `'${val.trim()}' has both a sign and a hemisphere letter` });
            return z.NEVER;
          }
          sign = letter === hemisphere.negative ? -1 : 1;
        }
      }
      if (/^[+-]?\d*,\d+$/.test(text)) {
        ctx.addIssue({ code: 'custom', message: `'${val.trim()}': use a dot as the decimal separator (6.5, not 6,5)` });
        return z.NEVER;
      }
      if (!PLAIN_NUMBER.test(text)) {
        ctx.addIssue({ code: 'custom', message: `'${val.trim()}' is not a number` });
        return z.NEVER;
      }
      return sign * Number(text);
    })
    .optional();
}

const stringToNumber = readNumber();
const latitudeString = readNumber({ positive: 'N', negative: 'S' });
const longitudeString = readNumber({ positive: 'E', negative: 'W' });

/** The column is a Postgres integer. */
const MAX_INT32 = 2_147_483_647;

const stringToInteger = z
  .unknown()
  .transform((input, ctx) => {
    if (input === undefined || input === null) return undefined;
    if (typeof input === 'number') return input;
    if (typeof input !== 'string') {
      ctx.addIssue({ code: 'custom', message: 'is not a whole number' });
      return z.NEVER;
    }
    const trimmed = input.trim();
    if (isMissing(trimmed)) return undefined;
    if (!/^\d+$/.test(trimmed)) {
      ctx.addIssue({ code: 'custom', message: `'${trimmed}' is not a whole number` });
      return z.NEVER;
    }
    return Number(trimmed);
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

    host_taxid: z.number().int().positive().max(MAX_INT32).optional(),
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

const CsvRowObject = z
  .object({
    sample_alias: z.string().min(1, 'Sample alias is required').max(255),

    latitude: latitudeString,
    longitude: longitudeString,
    geographic_location: optionalString,
    location_resolution: optionalString,
    geolocation_name: optionalString,

    environment_biome: optionalString,
    environment_feature: optionalString,
    environment_material: optionalString,
    environmental_package: optionalString,

    depth_min_meters: stringToNumber,
    depth_max_meters: stringToNumber,
    elevation_meters: stringToNumber,

    temperature: stringToNumber,
    ph: stringToNumber,
    salinity: stringToNumber,
    salinity_unit: optionalString,
    current_precipitation_mm: stringToNumber,
    mean_annual_precipitation_mm: stringToNumber,
    mean_annual_temperature: stringToNumber,

    collection_date: optionalString,
    collection_date_end: optionalString,
    description: optionalString,

    host_taxid: stringToInteger,
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
  });

/** The columns the schema reads; anything else in a row is additional metadata. */
export const CSV_ROW_FIELDS: ReadonlySet<string> = new Set(Object.keys(CsvRowObject.shape));

export const CsvRowSchema = CsvRowObject
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
