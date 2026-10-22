import { describe, expect, it } from 'vitest';
import {
  appliedFilterValue,
  formatAreaLabel,
  formatFilterNumber,
  formatRangeLabel,
  optionLabel,
} from './filter-chip-labels';

const n = (v: number) => v.toLocaleString(undefined, { maximumFractionDigits: 10 });

describe('appliedFilterValue', () => {
  it('shows the applied value while the input holds something', () => {
    expect(appliedFilterValue('soi', 'soil')).toBe('soil');
  });
  it('hides at once when the input is emptied, before the debounce catches up', () => {
    expect(appliedFilterValue('', 'soil')).toBe('');
  });
  it('shows nothing until a first value has been applied', () => {
    expect(appliedFilterValue('so', '')).toBe('');
  });
});

describe('formatFilterNumber', () => {
  it('formats with toLocaleString', () => {
    expect(formatFilterNumber('1000000')).toBe(n(1000000));
  });
  it('keeps the fraction a distance needs', () => {
    expect(formatFilterNumber('0.1234')).toBe(n(0.1234));
  });
  it('shows a non-number as it arrived', () => {
    expect(formatFilterNumber('abc')).toBe('abc');
    expect(formatFilterNumber(' ')).toBe(' ');
  });
});

describe('formatRangeLabel', () => {
  it('both bounds', () => {
    expect(formatRangeLabel('100', '5000')).toBe(`100–${n(5000)}`);
  });
  it('only a min', () => {
    expect(formatRangeLabel('100', '')).toBe('≥ 100');
  });
  it('only a max', () => {
    expect(formatRangeLabel('', '500')).toBe('≤ 500');
  });
  it('neither', () => {
    expect(formatRangeLabel('', '')).toBe('');
  });
  it('puts the unit after the last figure', () => {
    expect(formatRangeLabel('50', '90', '%')).toBe('50–90%');
    expect(formatRangeLabel('50', '', '%')).toBe('≥ 50%');
    expect(formatRangeLabel('', '5', '%')).toBe('≤ 5%');
  });
  it('negative and decimal bounds', () => {
    expect(formatRangeLabel('-5', '-0.5')).toBe(`${n(-5)}–${n(-0.5)}`);
    expect(formatRangeLabel('0.25', '1.5')).toBe(`${n(0.25)}–${n(1.5)}`);
    expect(formatRangeLabel('', '0.125')).toBe(`≤ ${n(0.125)}`);
    expect(formatRangeLabel('-12.75', '', '%')).toBe(`≥ ${n(-12.75)}%`);
  });
  it('a zero bound is a bound', () => {
    expect(formatRangeLabel('0', '')).toBe('≥ 0');
  });
});

describe('optionLabel', () => {
  const options = [{ label: 'GTDB', value: 'a1' }, { label: 'MGnify', value: 'b2' }];
  it('labels a value as its dropdown does', () => {
    expect(optionLabel(options, 'b2')).toBe('MGnify');
  });
  it('falls back to the value when the options do not hold it (or have not loaded)', () => {
    expect(optionLabel(options, 'zz')).toBe('zz');
    expect(optionLabel([], 'a1')).toBe('a1');
  });
});

describe('formatAreaLabel', () => {
  it('a full box', () => {
    expect(formatAreaLabel({ latMin: '13', latMax: '13.5', lonMin: '-17', lonMax: '-16.5' }))
      .toBe('13°N–13.5°N, 17°W–16.5°W');
  });
  it('a half-open box degrades to open bounds', () => {
    expect(formatAreaLabel({ latMin: '-10' })).toBe('≥ 10°S');
    expect(formatAreaLabel({ lonMax: '20' })).toBe('≤ 20°E');
  });
  it('ignores a value that is not a number', () => {
    expect(formatAreaLabel({ latMin: 'x', latMax: '5' })).toBe('≤ 5°N');
  });
});
