import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/redis-client', () => ({ default: {} }));

const { samplesMapCacheKey } = await import('./samples-map-cache-key');

const key = (qs: string) => samplesMapCacheKey(new URLSearchParams(qs));

describe('samplesMapCacheKey', () => {
  it('keeps every value of a repeated sourceType', () => {
    expect(key('sourceType=isolate&sourceType=MAG&sourceType=SAG'))
      .not.toBe(key('sourceType=SAG'));
  });

  it('ignores value and parameter order', () => {
    expect(key('bgcsMin=41&sourceType=SAG&sourceType=MAG'))
      .toBe(key('sourceType=MAG&sourceType=SAG&bgcsMin=41'));
  });

  it('distinguishes different filters', () => {
    expect(key('bgcsMin=41')).not.toBe(key('bgcsMin=42'));
  });

  it('is versioned after the namespace', () => {
    expect(key('limit=1')).toMatch(/^map:samples:v2:/);
  });
});
