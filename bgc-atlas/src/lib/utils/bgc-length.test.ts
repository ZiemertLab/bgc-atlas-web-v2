import { describe, expect, it } from 'vitest';
import { formatBgcLength } from './bgc-length';

const stats = (over: Partial<Parameters<typeof formatBgcLength>[0] & object> = {}) => ({
  medianCompleteLen: 21_900,
  minLen: 1_000,
  maxLen: 22_000,
  completeCount: 13,
  memberCount: 37,
  ...over,
});

describe('formatBgcLength', () => {
  it('formats the median over complete members', () => {
    const result = formatBgcLength(stats());
    expect(result?.text).toBe('21.9 kb');
    expect(result?.isBound).toBe(false);
    expect(result?.valueBp).toBe(21_900);
  });

  it('falls back to the longest member, marked as a lower bound, with no complete member', () => {
    const result = formatBgcLength(stats({ medianCompleteLen: null, maxLen: 28_800, completeCount: 0 }));
    expect(result?.text).toBe('≥28.8 kb');
    expect(result?.isBound).toBe(true);
    expect(result?.valueBp).toBe(28_800);
  });

  it('drops the decimal at or above 100 kb', () => {
    expect(formatBgcLength(stats({ medianCompleteLen: 134_400 }))?.text).toBe('134 kb');
    expect(formatBgcLength(stats({ medianCompleteLen: 99_900 }))?.text).toBe('99.9 kb');
  });

  it('explains which members the value came from', () => {
    expect(formatBgcLength(stats())?.tooltip).toContain('13 complete members of 37');
    expect(formatBgcLength(stats({ completeCount: 1 }))?.tooltip).toContain('1 complete member of 37');
  });

  it('says the value is a floor when it is one', () => {
    const tooltip = formatBgcLength(stats({ medianCompleteLen: null, completeCount: 0 }))?.tooltip ?? '';
    expect(tooltip).toContain('no complete member');
    expect(tooltip).toContain('at least');
  });

  it('returns null when the family has no length statistics at all', () => {
    expect(formatBgcLength(null)).toBeNull();
    expect(formatBgcLength(stats({ medianCompleteLen: null, maxLen: null }))).toBeNull();
  });

  it('omits the range when every member is the same length', () => {
    const result = formatBgcLength(stats({ minLen: 21_900, maxLen: 21_900 }));
    expect(result?.tooltip).not.toContain('range');
  });
});
