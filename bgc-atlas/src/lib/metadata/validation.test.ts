import { describe, expect, it } from 'vitest';

import { getTemplateDownloadContent } from './template';
import { parseAndValidateCsv, parseCsv } from './validation';

describe('parseCsv on the templates we serve', () => {
  it.each(['tsv', 'csv', 'wide'] as const)('reads the %s template as served, comments and all', async (format) => {
    // The default (tsv) template opens with ~20 '#' lines; the first was taken as the
    // header row, so the template itself parsed as a comma-separated wide file with no
    // sample_alias column and every sample was rejected.
    const { content } = getTemplateDownloadContent(format);
    const { parsingResult, validationResult } = await parseAndValidateCsv(content);
    expect(parsingResult.errors).toEqual([]);
    expect(parsingResult.samples.length).toBeGreaterThan(0);
    expect(parsingResult.samples.every((s) => typeof s.sample_alias === 'string' && s.sample_alias !== '')).toBe(true);
    expect(validationResult.invalidSamples).toBe(0);
  });

  it('detects the long format and tab delimiter past the comment block', async () => {
    const { content } = getTemplateDownloadContent('tsv');
    const result = await parseCsv(content);
    expect(result.format).toBe('long');
    expect(result.delimiter).toBe('\t');
  });

  it('reads a filled-in long template saved with Windows line endings', async () => {
    const filled = [
      '# my notes',
      'sample_alias\tmetadata_key\tvalue',
      'soil_A\tlatitude\t48.52',
      'soil_A\tlongitude\t9.05',
      'soil_B\tlatitude\t-12.1',
      'soil_B\tlongitude\t-77.0',
    ].join('\r\n');
    const { parsingResult, validationResult } = await parseAndValidateCsv(filled);
    expect(parsingResult.samples.map((s) => s.sample_alias).sort()).toEqual(['soil_A', 'soil_B']);
    expect(validationResult.invalidSamples).toBe(0);
  });
});

import { tsvFormatRows } from 'd3-dsv';
import { assembliesForSample, decodeMetadataBytes, metadataProblems } from './validation';

const parse = (text: string) => parseAndValidateCsv(text);
const dataOf = async (text: string) => (await parse(text)).validationResult.samples.map((s) => s.data);

describe('parseCsv on files real spreadsheets write', () => {
  it('reads an R/Sheets export: every field quoted, a BOM, CRLF endings', async () => {
    const text = '﻿"sample_alias","latitude","longitude","geographic_location"\r\n'
      + '"S1","48.52","9.05","Germany, Kiel"\r\n"S2","-12.1","-77.0","Peru"\r\n';
    const { parsingResult, validationResult } = await parse(text);
    expect(parsingResult.errors).toEqual([]);
    expect(validationResult.validSamples).toBe(2);
    expect(validationResult.samples[0].data?.geographic_location).toBe('Germany, Kiel');
  });

  it('keeps a quoted value holding the delimiter, and tolerates a trailing delimiter', async () => {
    const data = await dataOf('sample_alias,geographic_location,ph,\nS1,"Germany, Kiel",6.5,\n');
    expect(data[0]).toMatchObject({ geographic_location: 'Germany, Kiel', ph: 6.5 });
  });

  it('reads old-Mac CR-only line endings instead of one long line', async () => {
    const { parsingResult } = await parse('sample_alias,ph\rS1,6.5\rS2,7.0\r');
    expect(parsingResult.samples.map((s) => s.sample_alias)).toEqual(['S1', 'S2']);
  });

  it('decodes Excel "Unicode Text" (UTF-16LE with BOM)', async () => {
    const text = 'sample_alias\tph\r\nS1\t6.5\r\n';
    const bytes = new Uint8Array(2 + text.length * 2);
    bytes.set([0xff, 0xfe]);
    for (let i = 0; i < text.length; i++) { bytes[2 + i * 2] = text.charCodeAt(i); bytes[3 + i * 2] = 0; }
    const { validationResult } = await parse(decodeMetadataBytes(bytes));
    expect(validationResult.samples[0].data).toMatchObject({ sample_alias: 'S1', ph: 6.5 });
  });

  it('refuses an unquoted value split across columns instead of cutting it short', async () => {
    const { parsingResult } = await parse('sample_alias,metadata_key,value\nS1,geographic_location,Germany, Kiel\n');
    expect(parsingResult.errors).toHaveLength(1);
    expect(parsingResult.errors[0].message).toMatch(/must be in double quotes/);
    const quoted = await parse('sample_alias,metadata_key,value\nS1,geographic_location,"Germany, Kiel"\n');
    expect(quoted.validationResult.samples[0].data?.geographic_location).toBe('Germany, Kiel');
  });

  it('round-trips form text with a tab, a newline and a quote', async () => {
    const description = 'line one\nline two\twith a "tab"';
    const tsv = tsvFormatRows([['sample_alias', 'metadata_key', 'value'], ['S1', 'description', description]]);
    expect((await dataOf(tsv))[0]?.description).toBe(description);
  });
});

describe('numbers are read strictly', () => {
  const sample = async (fields: Record<string, string>) => {
    const header = Object.keys(fields).join(',');
    return (await parse(`sample_alias,${header}\nS1,${Object.values(fields).join(',')}\n`)).validationResult.samples[0];
  };

  it('keeps zero', async () => {
    expect((await sample({ depth_min_meters: '0', temperature: '0', latitude: '0', longitude: '0' })).data)
      .toMatchObject({ depth_min_meters: 0, temperature: 0, latitude: 0, longitude: 0 });
  });

  it('reads a hemisphere letter as the sign', async () => {
    expect((await sample({ latitude: '12.5 S', longitude: '45.0 W' })).data).toMatchObject({ latitude: -12.5, longitude: -45 });
    expect((await sample({ latitude: 'N 48.5', longitude: '9.05E' })).data).toMatchObject({ latitude: 48.5, longitude: 9.05 });
  });

  it.each([
    ['a unit', { temperature: '5m' }, /'5m' is not a number/],
    ['trailing junk', { temperature: '12abc' }, /'12abc' is not a number/],
    ['a word', { temperature: 'warm' }, /'warm' is not a number/],
    ['a host id over the column', { host_taxid: '99999999999' }, /host_taxid/],
  ])('refuses %s', async (_label, fields, message) => {
    const result = await sample(fields as Record<string, string>);
    expect(result.valid).toBe(false);
    expect(result.errors.map((e) => `${e.field}: ${e.message}`).join(' ')).toMatch(message);
  });

  it('refuses a decimal comma with the fix', async () => {
    const { validationResult } = await parse('sample_alias;ph\nS1;"6,5"\n');
    expect(validationResult.samples[0].errors[0].message).toMatch(/use a dot as the decimal separator/);
  });
});

describe('what is kept, and what blocks a submission', () => {
  it('keeps unknown columns as additional metadata', async () => {
    expect((await dataOf('sample_alias,soil_type,ph\nS1,loam,6.5\n'))[0]?.additional_metadata).toEqual({ soil_type: 'loam' });
  });

  it('names unreadable rows and invalid samples; a clean file has none', async () => {
    const bad = await parse('sample_alias,ph,temperature\nS1,6.5,warm\nS2,7,1,extra\n');
    const problems = metadataProblems(bad.parsingResult, bad.validationResult);
    expect(problems.join(' | ')).toMatch(/Row 3: Row has 4 columns/);
    expect(problems.join(' | ')).toMatch(/Sample 'S1': temperature 'warm' is not a number/);
    const good = await parse('sample_alias,ph\nS1,6.5\n');
    expect(metadataProblems(good.parsingResult, good.validationResult)).toEqual([]);
  });
});

describe('assembliesForSample', () => {
  const files = ['S1.fasta', 'S10.fasta', 'S1_contigs.fa.gz', 'Soil_1.fa'];
  it('matches the alias as a whole token of the file name', () => {
    expect(assembliesForSample('S1', files, 3)).toEqual(['S1.fasta', 'S1_contigs.fa.gz']);
    expect(assembliesForSample('S10', files, 3)).toEqual(['S10.fasta']);
    expect(assembliesForSample('Soil 1', files, 3)).toEqual(['Soil_1.fa']);
  });
  it('pairs one sample with one assembly whatever they are called', () => {
    expect(assembliesForSample('river', ['upload.fasta'], 1)).toEqual(['upload.fasta']);
  });
});
