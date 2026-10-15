import { ZodError } from 'zod';
import { SampleMetadataSchema, CsvRowSchema } from './schemas';
import { RECOMMENDED_FIELDS } from './constants';
import type { SampleValidationResult, BatchValidationResult, FieldError, FieldWarning, CsvParsingOptions, CsvParsingResult, CsvFormat } from './types';

function detectDelimiter(line: string): ',' | '\t' | ';' {
  const commas = (line.match(/,/g) || []).length;
  const tabs = (line.match(/\t/g) || []).length;
  const semicolons = (line.match(/;/g) || []).length;

  if (tabs > commas && tabs > semicolons) return '\t';
  if (semicolons > commas) return ';';
  return ',';
}

function detectFormat(headers: string[]): CsvFormat {
  // Long format has columns like: sample_alias, metadata_key, value
  const longFormatHeaders = ['sample_alias', 'metadata_key', 'value'];
  const hasLongFormat = longFormatHeaders.every((h) =>
    headers.some((header) => header.toLowerCase() === h.toLowerCase())
  );

  return hasLongFormat ? 'long' : 'wide';
}

export async function parseCsv(
  fileContent: string,
  options: CsvParsingOptions = {}
): Promise<CsvParsingResult> {
  const {
    skipEmptyRows = true,
    trimValues = true,
  } = options;

  const lines = fileContent.split('\n').filter((line) => {
    if (!skipEmptyRows) return true;
    return line.trim() !== '';
  });

  if (lines.length === 0) {
    return {
      format: 'wide',
      delimiter: ',',
      samples: [],
      errors: [{ row: 0, message: 'CSV file is empty' }],
    };
  }

  const delimiter = options.delimiter || detectDelimiter(lines[0]);

  const headers = lines[0]
    .split(delimiter)
    .map((h) => (trimValues ? h.trim() : h));

  const format = options.format || detectFormat(headers);

  const errors: Array<{ row: number; message: string }> = [];
  const samples: Record<string, string>[] = [];

  if (format === 'wide') {
    // Wide format: each row is a sample
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line && skipEmptyRows) continue;

      const values = line.split(delimiter).map((v) => (trimValues ? v.trim() : v));

      if (values.length !== headers.length) {
        errors.push({
          row: i + 1,
          message: `Row has ${values.length} columns but expected ${headers.length}`,
        });
        continue;
      }

      const sample: Record<string, string> = {};
      headers.forEach((header, idx) => {
        sample[header] = values[idx];
      });

      samples.push(sample);
    }
  } else {
    // Long format: key-value pairs grouped by sample_alias
    const sampleMap = new Map<string, Record<string, string>>();

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line && skipEmptyRows) continue;

      const values = line.split(delimiter).map((v) => (trimValues ? v.trim() : v));

      if (values.length < 3) {
        errors.push({
          row: i + 1,
          message: 'Long format requires at least 3 columns: sample_alias, metadata_key, value',
        });
        continue;
      }

      const [sampleAlias, key, value] = values;

      if (!sampleMap.has(sampleAlias)) {
        sampleMap.set(sampleAlias, { sample_alias: sampleAlias });
      }

      const sample = sampleMap.get(sampleAlias)!;
      sample[key] = value;
    }

    samples.push(...Array.from(sampleMap.values()));
  }

  return {
    format,
    delimiter,
    samples,
    errors,
  };
}

export function validateSample(data: unknown): SampleValidationResult {
  const errors: FieldError[] = [];
  const warnings: FieldWarning[] = [];

  try {
    // The CSV schema first, for its string-to-number conversions
    const parsed = CsvRowSchema.parse(data);

    const validated = SampleMetadataSchema.parse(parsed);

    for (const field of RECOMMENDED_FIELDS) {
      if (validated[field as keyof typeof validated] === undefined) {
        warnings.push({
          field,
          message: `Recommended field '${field}' is missing`,
        });
      }
    }

    if (validated.salinity !== undefined && !validated.salinity_unit) {
      warnings.push({
        field: 'salinity_unit',
        message: 'Salinity unit is recommended when salinity is provided',
        value: validated.salinity,
      });
    }

    return {
      sampleAlias: validated.sample_alias,
      valid: true,
      errors: [],
      warnings,
      data: validated,
    };
  } catch (error) {
    if (error instanceof ZodError) {
      for (const issue of error.issues) {
        errors.push({
          field: issue.path.join('.') || 'unknown',
          message: issue.message,
          value: issue.code === 'invalid_type' ? undefined : (data as Record<string, unknown>)?.[String(issue.path[0])],
        });
      }
    } else {
      errors.push({
        field: 'unknown',
        message: error instanceof Error ? error.message : 'Unknown validation error',
      });
    }

    return {
      sampleAlias: typeof data === 'object' && data !== null && 'sample_alias' in data
        ? String(data.sample_alias)
        : 'unknown',
      valid: false,
      errors,
      warnings: [],
    };
  }
}

export function validateBatch(samples: unknown[]): BatchValidationResult {
  const results = samples.map((sample) => validateSample(sample));

  const validSamples = results.filter((r) => r.valid).length;
  const invalidSamples = results.length - validSamples;

  return {
    valid: invalidSamples === 0,
    totalSamples: results.length,
    validSamples,
    invalidSamples,
    samples: results,
  };
}

export async function parseAndValidateCsv(
  fileContent: string,
  options: CsvParsingOptions = {}
): Promise<{
  parsingResult: CsvParsingResult;
  validationResult: BatchValidationResult;
}> {
  const parsingResult = await parseCsv(fileContent, options);

  if (parsingResult.errors.length > 0 && parsingResult.samples.length === 0) {
    return {
      parsingResult,
      validationResult: {
        valid: false,
        totalSamples: 0,
        validSamples: 0,
        invalidSamples: 0,
        samples: [],
      },
    };
  }

  const validationResult = validateBatch(parsingResult.samples);

  return {
    parsingResult,
    validationResult,
  };
}
