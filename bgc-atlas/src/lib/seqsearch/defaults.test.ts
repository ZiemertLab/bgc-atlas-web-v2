import { describe, expect, it } from 'vitest';
import { SEARCH_DEFAULTS, thresholdOrDefault } from './defaults';

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
