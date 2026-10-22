import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/prisma', () => ({ default: {} }));

import { parseIntParam } from './studies-query';

describe('parseIntParam', () => {
  it('uses the fallback for an absent or blank value, not 0', () => {
    // Number(null) is 0, which clamped a missing /api/studies ?limit= to one study.
    expect(parseIntParam(null, 50, 1, 200)).toBe(50);
    expect(parseIntParam('', 50, 1, 200)).toBe(50);
    expect(parseIntParam('  ', 50, 1, 200)).toBe(50);
  });

  it('still parses, truncates and clamps a real value', () => {
    expect(parseIntParam('20', 50, 1, 200)).toBe(20);
    expect(parseIntParam('2.9', 50, 1, 200)).toBe(2);
    expect(parseIntParam('0', 50, 1, 200)).toBe(1);
    expect(parseIntParam('999', 50, 1, 200)).toBe(200);
    expect(parseIntParam('abc', 50, 1, 200)).toBe(50);
  });
});
