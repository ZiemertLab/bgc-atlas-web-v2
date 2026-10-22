import { describe, expect, it } from 'vitest';

import { escapeDelimitedField, toDelimitedText } from './export';

describe('escapeDelimitedField (CSV)', () => {
  it('leaves plain values untouched', () => {
    expect(escapeDelimitedField('Tara Oceans', ',')).toBe('Tara Oceans');
    expect(escapeDelimitedField(42, ',')).toBe('42');
  });

  it('quotes values containing the separator', () => {
    expect(escapeDelimitedField('Center for Microbial Communities, Aalborg', ',')).toBe(
      '"Center for Microbial Communities, Aalborg"'
    );
  });

  it('doubles embedded quotes', () => {
    expect(escapeDelimitedField('the "complete" genome', ',')).toBe('"the ""complete"" genome"');
  });

  it('quotes values containing newlines', () => {
    expect(escapeDelimitedField('line one\nline two', ',')).toBe('"line one\nline two"');
  });

  it('renders null and undefined as empty', () => {
    expect(escapeDelimitedField(null, ',')).toBe('');
    expect(escapeDelimitedField(undefined, ',')).toBe('');
  });
});

describe('escapeDelimitedField (TSV)', () => {
  it('strips structural whitespace rather than quoting', () => {
    expect(escapeDelimitedField('a\tb', '\t')).toBe('a b');
    expect(escapeDelimitedField('line one\nline two', '\t')).toBe('line one line two');
  });

  it('keeps commas and quotes verbatim', () => {
    expect(escapeDelimitedField('Communities, Aalborg', '\t')).toBe('Communities, Aalborg');
    expect(escapeDelimitedField('the "complete" genome', '\t')).toBe('the "complete" genome');
  });
});

describe('toDelimitedText', () => {
  it('keeps the field count stable when a cell contains the separator', () => {
    const csv = toDelimitedText(
      ['ID', 'Title', 'Count'],
      [['abc', 'Soil study, phase 2', 7]],
      ','
    );
    const [header, row] = csv.split('\n');
    expect(header).toBe('ID,Title,Count');
    expect(row).toBe('abc,"Soil study, phase 2",7');
    expect(parseCsvRow(row)).toEqual(['abc', 'Soil study, phase 2', '7']);
    expect(parseCsvRow(row)).toHaveLength(parseCsvRow(header).length);
  });

  it('round-trips quotes inside a comma-bearing cell', () => {
    const csv = toDelimitedText([ 'Title' ], [['a "quoted", tricky title']], ',');
    const row = csv.split('\n')[1];
    expect(parseCsvRow(row)).toEqual(['a "quoted", tricky title']);
  });

  it('escapes header cells too', () => {
    expect(toDelimitedText(['GCF, id'], [], ',')).toBe('"GCF, id"');
  });
});

// Minimal RFC-4180 reader.
function parseCsvRow(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      out.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

describe('escapeDelimitedField: what a spreadsheet would run', () => {
  it.each([
    ['=HYPERLINK("http://x","y")', ','],
    ['+cmd|calc', ','],
    ['@SUM(A1)', ','],
    ['-2+3', ','],
    ['=1+1', '\t'],
  ])('neutralises %j (separator %j) with a leading apostrophe', (value, separator) => {
    const out = escapeDelimitedField(value, separator);
    expect(out.replace(/^"/, '').startsWith("'")).toBe(true);
  });

  it('leaves numbers, negative ones included, and ordinary text alone', () => {
    for (const v of ['-12.5', '-77', '1e-5', '-3.2E+4', '0', 'NRPS', 'GCF-v2b6-000042', 'd__Bacteria']) {
      expect(escapeDelimitedField(v, ',')).toBe(v);
    }
    expect(escapeDelimitedField(-12.5, ',')).toBe('-12.5');
  });

  it('quotes a carriage return in CSV and flattens it in TSV', () => {
    expect(escapeDelimitedField('a\rb', ',')).toBe('"a\rb"');
    expect(escapeDelimitedField('a\rb\tc', '\t')).toBe('a b c');
  });
});
