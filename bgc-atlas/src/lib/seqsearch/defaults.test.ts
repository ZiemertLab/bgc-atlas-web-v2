import { describe, expect, it } from 'vitest';
import { parseSearchParameters, SEARCH_DEFAULTS, thresholdOrDefault } from './defaults';

describe('thresholdOrDefault', () => {
  it('keeps a real threshold', () => {
    expect(thresholdOrDefault(65, SEARCH_DEFAULTS.identity)).toBe(65);
  });

  it('falls back when nothing was submitted', () => {
    expect(thresholdOrDefault(undefined, SEARCH_DEFAULTS.identity)).toBe(SEARCH_DEFAULTS.identity);
  });

  it('treats 0 as "not set" rather than as "no floor"', () => {
    expect(thresholdOrDefault(0, SEARCH_DEFAULTS.identity)).toBe(SEARCH_DEFAULTS.identity);
    expect(thresholdOrDefault(0, SEARCH_DEFAULTS.coverage)).toBe(SEARCH_DEFAULTS.coverage);
  });

  it('does not treat other small values as unset', () => {
    expect(thresholdOrDefault(1, SEARCH_DEFAULTS.identity)).toBe(1);
    expect(thresholdOrDefault(0.5, SEARCH_DEFAULTS.identity)).toBe(0.5);
  });
});

describe('SEARCH_DEFAULTS', () => {
  it('stays within the range the submit route validates', () => {
    expect(SEARCH_DEFAULTS.identity).toBeGreaterThan(0);
    expect(SEARCH_DEFAULTS.identity).toBeLessThanOrEqual(100);
    expect(SEARCH_DEFAULTS.coverage).toBeGreaterThan(0);
    expect(SEARCH_DEFAULTS.coverage).toBeLessThanOrEqual(100);
    expect(SEARCH_DEFAULTS.maxResults).toBeGreaterThanOrEqual(1);
    expect(SEARCH_DEFAULTS.maxResults).toBeLessThanOrEqual(1000);
  });
});

describe('parseSearchParameters', () => {
  const reject = (raw: Parameters<typeof parseSearchParameters>[0]) => {
    const parsed = parseSearchParameters(raw);
    expect(parsed.ok).toBe(false);
  };

  it('applies the defaults when nothing was submitted', () => {
    expect(parseSearchParameters({})).toEqual({
      ok: true,
      value: {
        eValue: SEARCH_DEFAULTS.eValue,
        identity: SEARCH_DEFAULTS.identity,
        coverage: SEARCH_DEFAULTS.coverage,
        maxResults: SEARCH_DEFAULTS.maxResults,
      },
    });
  });

  it('accepts numbers and the numeric strings a form posts', () => {
    expect(parseSearchParameters({ eValue: '1e-10', minIdentity: '65', minCoverage: 40, maxResults: '250' })).toEqual({
      ok: true,
      value: { eValue: '1e-10', identity: 65, coverage: 40, maxResults: 250 },
    });
    expect(parseSearchParameters({ eValue: ' 0.001 ', minIdentity: '' })).toMatchObject({
      ok: true,
      value: { eValue: '0.001', identity: SEARCH_DEFAULTS.identity },
    });
  });

  it('rejects a string that a range check alone would let through', () => {
    // NaN < 1 and NaN > 1000 are both false: this used to reach DIAMOND's command line.
    reject({ maxResults: '1 $(touch /tmp/pwned)' });
    reject({ minIdentity: '50; id' });
    reject({ eValue: '1e-5 `id`' });
    reject({ eValue: '1e-5;id' });
  });

  it('rejects non-numbers, non-integers and out-of-range values', () => {
    reject({ maxResults: 'abc' });
    reject({ maxResults: 1.5 });
    reject({ maxResults: 0 });
    reject({ maxResults: 1001 });
    reject({ maxResults: Infinity });
    reject({ maxResults: [5] });
    reject({ minIdentity: 101 });
    reject({ minCoverage: -1 });
    reject({ minCoverage: { $gt: 1 } });
    reject({ eValue: '0' });
    reject({ eValue: '-1' });
    reject({ eValue: '1e999' });
    reject({ eValue: 'Infinity' });
    reject({ eValue: true });
  });

  it('accepts every E-value form it accepted before', () => {
    for (const eValue of ['10', '1.', '1.5', '.5', '0.001', '1e-5', '1E-5', '1.5e+3', '2e10']) {
      expect(parseSearchParameters({ eValue })).toMatchObject({ ok: true, value: { eValue } });
    }
    for (const eValue of ['.', 'e5', '1e', '1.2.3', '1e5.5', '+1', '1 e5']) reject({ eValue });
  });

  it('answers a huge adversarial E-value at once', () => {
    // `\d+\.?\d*` backtracked quadratically here: 40,000 digits took 1.3 s.
    const started = performance.now();
    reject({ eValue: `${'1'.repeat(1_000_000)}x` });
    reject({ eValue: '1'.repeat(1_000_000) });
    expect(performance.now() - started).toBeLessThan(100);
  });
});
