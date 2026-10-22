import { dsvFormat } from 'd3-dsv';
import { ZodError } from 'zod';
import { SampleMetadataSchema, CsvRowSchema, CSV_ROW_FIELDS } from './schemas';
import { RECOMMENDED_FIELDS } from './constants';
import type { SampleValidationResult, BatchValidationResult, FieldError, FieldWarning, CsvParsingOptions, CsvParsingResult, CsvFormat } from './types';

/** Decode an uploaded metadata file: a UTF-8 BOM is dropped, and UTF-16 (Excel's "Unicode Text") decoded. */
export function decodeMetadataBytes(bytes: Uint8Array): string {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes.subarray(2));
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes.subarray(2));
  return new TextDecoder('utf-8').decode(bytes).replace(/^\uFEFF/, '');
}

// Counts only separators outside quotes, so a quoted "a, b" header does not vote.
function detectDelimiter(line: string): ',' | '\t' | ';' {
  const outside = line.replace(/"[^"]*"/g, '');
  const commas = (outside.match(/,/g) || []).length;
  const tabs = (outside.match(/\t/g) || []).length;
  const semicolons = (outside.match(/;/g) || []).length;

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

/** Trailing empty cells, as Excel writes them after a last delimiter, are no column. */
function dropTrailingEmpty(cells: string[], keep: number): string[] {
  let end = cells.length;
  while (end > keep && cells[end - 1] === '') end -= 1;
  return cells.slice(0, end);
}

// Quoting, escaped quotes and every line ending (\r\n, \n, a bare \r) are d3-dsv's.
export async function parseCsv(
  fileContent: string,
  options: CsvParsingOptions = {}
): Promise<CsvParsingResult> {
  const {
    skipEmptyRows = true,
    trimValues = true,
  } = options;
  const clean = (v: string) => (trimValues ? v.trim() : v);

  // '#' lines are comments: the template /api/contribute/template serves opens with them.
  const text = fileContent
    .replace(/^\uFEFF/, '')
    .split(/\r\n|\r|\n/)
    .filter((line) => !line.trimStart().startsWith('#'))
    .join('\n');
  const headerLine = text.split('\n').find((line) => line.trim() !== '');

  if (headerLine === undefined) {
    return {
      format: 'wide',
      delimiter: ',',
      samples: [],
      errors: [{ row: 0, message: 'CSV file is empty' }],
    };
  }

  const delimiter = options.delimiter || detectDelimiter(headerLine);
  const rows = dsvFormat(delimiter)
    .parseRows(text)
    .map((cells) => cells.map(clean))
    .filter((cells) => !(skipEmptyRows && cells.every((c) => c === '')));

  const headers = dropTrailingEmpty(rows[0] ?? [], 1);
  const format = options.format || detectFormat(headers);

  const errors: Array<{ row: number; message: string }> = [];
  const samples: Record<string, string>[] = [];
  const tooWide = (row: number, got: number, want: number) => errors.push({
    row,
    message: `Row has ${got} columns but expected ${want}. A value containing the delimiter `
      + `(${delimiter === '\t' ? 'a tab' : `'${delimiter}'`}) must be in double quotes.`,
  });

  if (format === 'wide') {
    // Wide format: each row is a sample. A short row (an editor dropping trailing
    // empty cells) is padded; a long one cannot be told apart from a split value.
    for (let i = 1; i < rows.length; i++) {
      const values = dropTrailingEmpty(rows[i], headers.length);
      if (values.length > headers.length) {
        tooWide(i + 1, values.length, headers.length);
        continue;
      }
      const sample: Record<string, string> = {};
      headers.forEach((header, idx) => {
        sample[header] = values[idx] ?? '';
      });
      samples.push(sample);
    }
  } else {
    // Long format: key-value pairs grouped by sample_alias
    const at = (name: string) => headers.findIndex((h) => h.toLowerCase() === name);
    const [aliasAt, keyAt, valueAt] = [at('sample_alias'), at('metadata_key'), at('value')];
    const sampleMap = new Map<string, Record<string, string>>();

    for (let i = 1; i < rows.length; i++) {
      const values = dropTrailingEmpty(rows[i], 3);
      if (values.length > headers.length) {
        // Was silently cut to three: 'Germany, Kiel' stored as 'Germany'.
        tooWide(i + 1, values.length, headers.length);
        continue;
      }
      const sampleAlias = values[aliasAt] ?? '';
      const key = values[keyAt] ?? '';
      if (!sampleAlias || !key) {
        errors.push({ row: i + 1, message: 'Long format needs a sample_alias and a metadata_key on every row' });
        continue;
      }

      if (!sampleMap.has(sampleAlias)) {
        sampleMap.set(sampleAlias, { sample_alias: sampleAlias });
      }
      sampleMap.get(sampleAlias)![key] = values[valueAt] ?? '';
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

    // Columns the schema does not read are kept in additional_metadata, not stripped.
    const additional: Record<string, string> = {};
    if (typeof data === 'object' && data !== null) {
      for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
        if (CSV_ROW_FIELDS.has(key) || key === 'additional_metadata') continue;
        const text = typeof value === 'string' ? value.trim() : value == null ? '' : String(value);
        if (text !== '' && text !== 'NA' && text !== 'N/A' && text !== 'null') additional[key] = text;
      }
    }

    const validated = SampleMetadataSchema.parse(
      Object.keys(additional).length > 0 ? { ...parsed, additional_metadata: additional } : parsed,
    );

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

/**
 * What to fix before a metadata file may be submitted: unreadable rows and invalid samples, the
 * first few named. A submission is refused rather than half-stored.
 */
export function metadataProblems(
  parsing: CsvParsingResult,
  validation: BatchValidationResult,
  limit = 5,
): string[] {
  const problems: string[] = [];
  for (const e of parsing.errors) problems.push(e.row > 0 ? `Row ${e.row}: ${e.message}` : e.message);
  for (const sample of validation.samples) {
    if (sample.valid) continue;
    const detail = sample.errors.map((e) => (e.field === 'unknown' ? e.message : `${e.field} ${e.message}`)).join('; ');
    problems.push(`Sample '${sample.sampleAlias}': ${detail}`);
  }
  if (problems.length === 0 && validation.totalSamples === 0) problems.push('The file has no samples.');
  return problems.length > limit
    ? [...problems.slice(0, limit), `and ${(problems.length - limit).toLocaleString('en-US')} more`]
    : problems;
}

/** Lower-cased, with anything but letters and digits as one separator. */
const tokenise = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, '_');
const stem = (filename: string) => filename.replace(/(\.gz)?$/i, '').replace(/\.[^.]*$/, '');

/**
 * The assemblies a sample's alias names, as a whole token of the file name: S1 matches S1.fa and
 * S1_contigs.fa but not S10.fa, and 'Soil 1' matches Soil_1.fa. One sample and one assembly are
 * always paired.
 */
export function assembliesForSample(
  sampleAlias: string,
  assemblyFilenames: string[],
  sampleCount: number,
): string[] {
  if (sampleCount === 1 && assemblyFilenames.length === 1) return [...assemblyFilenames];
  const alias = tokenise(sampleAlias).replace(/^_+|_+$/g, '');
  if (!alias) return [];
  return assemblyFilenames.filter((filename) =>
    `_${tokenise(stem(filename))}_`.includes(`_${alias}_`),
  );
}
