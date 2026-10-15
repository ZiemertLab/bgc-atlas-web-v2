import { describe, expect, it } from 'vitest';

import {
  exportEpilogue,
  exportFilename,
  exportPreamble,
  exportRows,
  serializeExport,
  type ExportColumn,
  type ExportFormat,
} from './format';

interface Row { id: string; title: string | null; n: number | null }

const columns: ExportColumn<Row>[] = [
  { id: 'id', label: 'ID', value: (r) => r.id },
  { id: 'title', label: 'Title, full', value: (r) => r.title },
  { id: 'n', label: 'Count', value: (r) => r.n },
];

const rows: Row[] = [
  { id: 'a', title: 'Center for Microbial Communities, Aalborg', n: 3 },
  { id: 'b', title: 'He said "hi"\tthen\nleft', n: null },
  { id: 'c', title: null, n: 0 },
];

describe('serializeExport', () => {
  it('quotes CSV fields that carry the separator, a quote or a newline', () => {
    const csv = serializeExport(rows, columns, 'csv');
    expect(csv.split('\n')[0]).toBe('ID,"Title, full",Count');
    expect(csv).toContain('a,"Center for Microbial Communities, Aalborg",3');
    expect(csv).toContain('"He said ""hi""\tthen\nleft"');
  });

  it('flattens tabs and newlines in TSV instead of quoting', () => {
    const tsv = serializeExport(rows, columns, 'tsv');
    expect(tsv.split('\n')).toEqual([
      'ID\tTitle, full\tCount',
      'a\tCenter for Microbial Communities, Aalborg\t3',
      'b\tHe said "hi" then left\t',
      'c\t\t0',
      '',
    ]);
  });

  it('writes JSON keyed by column id, numbers as numbers and absent as null', () => {
    expect(JSON.parse(serializeExport(rows, columns, 'json'))).toEqual([
      { id: 'a', title: 'Center for Microbial Communities, Aalborg', n: 3 },
      { id: 'b', title: 'He said "hi"\tthen\nleft', n: null },
      { id: 'c', title: null, n: 0 },
    ]);
  });

  it('writes an empty result as a valid file', () => {
    expect(JSON.parse(serializeExport([], columns, 'json'))).toEqual([]);
    expect(serializeExport([], columns, 'csv')).toBe('ID,"Title, full",Count\n');
  });
});

describe('the streamed form', () => {
  // The page download and the full export share a serializer; batching must not change a byte.
  it.each(['csv', 'tsv', 'json'] as ExportFormat[])('%s: batches concatenate to the whole', (format) => {
    const streamed = exportPreamble(columns, format)
      + exportRows(rows.slice(0, 1), columns, format, true)
      + exportRows(rows.slice(1, 1), columns, format, false)
      + exportRows(rows.slice(1), columns, format, false)
      + exportEpilogue(format);
    expect(streamed).toBe(serializeExport(rows, columns, format));
  });
});

describe('exportFilename', () => {
  const at = new Date(2026, 9, 2, 19, 5);

  it('names the row count', () => {
    expect(exportFilename('bgcs', 32104, 32104, 'tsv', at)).toBe('bgcs_32104_20261002-1905.tsv');
  });

  it('says so when the file holds the first rows of a larger result', () => {
    expect(exportFilename('bgcs', 100000, 1234567, 'csv', at))
      .toBe('bgcs_first100000of1234567_20261002-1905.csv');
  });
});
