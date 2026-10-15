import { describe, it, expect } from 'vitest';
import {
  ENVIRONMENT_FIELDS,
  MIN_VALUES_TO_OFFER,
  MIN_VALUES_FOR_HISTOGRAM,
  HISTOGRAM_BINS,
  summarizeEnvField,
  decimalsForSpan,
  formatEnvValue,
  formatEnvRange,
  type EnvFieldDef,
} from './environment-fields';

const field = (over: Partial<EnvFieldDef> = {}): EnvFieldDef => ({
  key: 'temperature',
  label: 'Temperature',
  unit: '°C',
  column: 'temperature',
  min: -25,
  max: 150,
  ...over,
});

const spread = (n: number, lo: number, hi: number): number[] =>
  Array.from({ length: n }, (_, i) => lo + ((hi - lo) * i) / (n - 1));

describe('ENVIRONMENT_FIELDS catalogue', () => {
  it('has unique keys', () => {
    const keys = ENVIRONMENT_FIELDS.map((f) => f.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('offers nitrate and dissolved oxygen once per unit, never converted', () => {
    const nitrate = ENVIRONMENT_FIELDS.filter((f) => f.column === 'nitrate');
    expect(nitrate.map((f) => f.unitValue).sort()).toEqual(['mg/L', 'µmol/L']);
    const oxygen = ENVIRONMENT_FIELDS.filter((f) => f.column === 'dissolved_oxygen');
    expect(oxygen.map((f) => f.unitValue).sort()).toEqual(['mg/L', 'µmol/kg']);
  });

  it('omits ammonium, whose values carry no unit', () => {
    expect(ENVIRONMENT_FIELDS.some((f) => f.column === 'ammonium')).toBe(false);
  });

  it('bounds temperature below the 414 °C junk population', () => {
    const temp = ENVIRONMENT_FIELDS.find((f) => f.key === 'temperature');
    expect(temp?.max).toBeLessThan(414);
  });
});

describe('summarizeEnvField', () => {
  it('returns null below the offer threshold', () => {
    expect(summarizeEnvField(field(), [1, 2, 3, 4])).toBeNull();
    expect(summarizeEnvField(field(), [])).toBeNull();
    expect(summarizeEnvField(field(), Array(MIN_VALUES_TO_OFFER).fill(10))).not.toBeNull();
  });

  it('ignores nulls without counting them as excluded', () => {
    const s = summarizeEnvField(field(), [10, null, 11, null, 12, 13, 14]);
    expect(s?.n).toBe(5);
    expect(s?.nExcluded).toBe(0);
  });

  it('drops values outside the plausibility bound and reports how many', () => {
    const s = summarizeEnvField(field(), [10, 11, 12, 13, 14, 500, 161533, -80]);
    expect(s?.n).toBe(5);
    expect(s?.nExcluded).toBe(3);
    expect(s?.max).toBe(14);
  });

  it('keeps raw values instead of bins below the histogram threshold', () => {
    const s = summarizeEnvField(field(), spread(MIN_VALUES_FOR_HISTOGRAM - 1, 0, 20));
    expect(s?.bins).toBeUndefined();
    expect(s?.values).toHaveLength(MIN_VALUES_FOR_HISTOGRAM - 1);
  });

  it('sorts the raw values ascending', () => {
    const s = summarizeEnvField(field(), [12, 3, 7, 1, 9]);
    expect(s?.values).toEqual([1, 3, 7, 9, 12]);
  });

  it('bins at or above the histogram threshold and drops the raw values', () => {
    const s = summarizeEnvField(field(), spread(MIN_VALUES_FOR_HISTOGRAM, 0, 20));
    expect(s?.values).toBeUndefined();
    expect(s?.bins).toHaveLength(HISTOGRAM_BINS);
  });

  it('accounts for every kept value across the bins', () => {
    const s = summarizeEnvField(field(), spread(200, -10, 40));
    const binned = s!.bins!.reduce((sum, b) => sum + b.count, 0);
    expect(binned).toBe(s!.n);
  });

  it('spans the 1st to 99th percentile, folding the tails into the end bins', () => {
    const s = summarizeEnvField(field(), [...spread(100, 10, 20), -20, 140]);
    expect(s!.bins![0].x0).toBeCloseTo(s!.p1, 6);
    expect(s!.bins![HISTOGRAM_BINS - 1].x1).toBeCloseTo(s!.p99, 6);
    expect(s!.min).toBe(-20);
    expect(s!.max).toBe(140);
    expect(s!.nBelow).toBeGreaterThan(0);
    expect(s!.nAbove).toBeGreaterThan(0);
    expect(s!.bins![0].count).toBeGreaterThanOrEqual(s!.nBelow);
  });

  it('computes the median from the kept values', () => {
    const s = summarizeEnvField(field(), [1, 2, 3, 4, 5, 500]);
    expect(s?.median).toBe(3);
  });

  it('survives a field where every sample reports the same value', () => {
    const s = summarizeEnvField(
      field({ key: 'depth', column: 'depth', unit: 'm', min: 0, max: 11100 }),
      Array(200).fill(0)
    );
    expect(s?.n).toBe(200);
    expect(s?.bins).toHaveLength(1);
    expect(s!.bins![0].count).toBe(200);
    expect(Number.isFinite(s!.bins![0].x0)).toBe(true);
    expect(Number.isFinite(s!.bins![0].x1)).toBe(true);
  });

  it('falls back to the full range when the middle 98% is a single value', () => {
    // p1 === p99 === 0, but the data does have spread.
    const s = summarizeEnvField(
      field({ key: 'depth', column: 'depth', unit: 'm', min: 0, max: 11100 }),
      [...Array(199).fill(0), 4000]
    );
    expect(s!.p1).toBe(s!.p99);
    expect(s!.bins![0].x0).toBe(0);
    expect(s!.bins![HISTOGRAM_BINS - 1].x1).toBe(4000);
    expect(s!.bins!.reduce((sum, b) => sum + b.count, 0)).toBe(200);
  });
});

describe('decimalsForSpan', () => {
  it('scales precision to the spread on screen', () => {
    expect(decimalsForSpan(11000)).toBe(0); // depth, metres
    expect(decimalsForSpan(40)).toBe(1); // temperature, °C
    expect(decimalsForSpan(3)).toBe(2); // pH
    expect(decimalsForSpan(0.4)).toBe(3); // nitrite, µmol/L
  });

  it('never returns a negative or fractional precision for a zero span', () => {
    expect(decimalsForSpan(0)).toBeGreaterThanOrEqual(0);
    expect(Number.isInteger(decimalsForSpan(0))).toBe(true);
  });
});

describe('formatEnvValue', () => {
  it('groups thousands and holds the precision', () => {
    expect(formatEnvValue(4000, 0)).toBe('4,000');
    expect(formatEnvValue(24.05, 1)).toBe('24.1');
    expect(formatEnvValue(7, 2)).toBe('7.00');
  });
});

describe('formatEnvRange', () => {
  it('joins the bounds with a dash', () => {
    expect(formatEnvRange(2, 42.5, 1)).toBe('2.0–42.5');
  });

  it('spaces the dash when a bound is negative, so -17–92 cannot be misread', () => {
    expect(formatEnvRange(-17, 92, 0)).toBe('-17 – 92');
  });
});
