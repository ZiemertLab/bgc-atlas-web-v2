import { describe, expect, it } from 'vitest';
import { completenessBand, contaminationBand } from './mimag';

describe('MIMAG bands', () => {
  it('bands completeness at 90 and 50, inclusive', () => {
    expect(completenessBand(90)).toBe('high');
    expect(completenessBand(89.99)).toBe('medium');
    expect(completenessBand(50)).toBe('medium');
    expect(completenessBand(49.9)).toBe('low');
  });

  it('bands contamination at <= 5 and < 10', () => {
    expect(contaminationBand(5)).toBe('high');
    expect(contaminationBand(5.01)).toBe('medium');
    expect(contaminationBand(9.99)).toBe('medium');
    expect(contaminationBand(10)).toBe('low');
  });
});
