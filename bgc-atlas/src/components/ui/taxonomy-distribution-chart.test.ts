import { describe, expect, it } from 'vitest';
import { buildTaxonomySegments } from './taxonomy-distribution-chart';

const WIDTH = 260;

describe('buildTaxonomySegments', () => {
  it('without taxaCount, Other counts the given entries that are not drawn', () => {
    const segs = buildTaxonomySegments({ a: 60, b: 30, c: 4, d: 3, e: 3 }, WIDTH);
    expect(segs.map((s) => s.taxon)).toEqual(['a', 'b', '__other__']);
    const other = segs[2];
    expect(other.count).toBe(3);
    expect(other.percentage).toBeCloseTo(10);
  });

  it('without taxaCount, no Other when every entry is drawn', () => {
    const segs = buildTaxonomySegments({ a: 70, b: 30 }, WIDTH);
    expect(segs.some((s) => s.isOther)).toBe(false);
  });

  it('with a trimmed top-20 map, Other counts every taxon not drawn', () => {
    const dist: Record<string, number> = { a: 20, b: 10 };
    for (let i = 0; i < 18; i++) dist[`t${i}`] = 1;
    const segs = buildTaxonomySegments(dist, WIDTH, 22103);
    const drawn = segs.filter((s) => !s.isOther);
    expect(drawn.map((s) => s.taxon)).toEqual(['a', 'b']);
    const other = segs.find((s) => s.isOther);
    expect(other?.count).toBe(22103 - drawn.length);
    expect(other?.percentage).toBeCloseTo(70);
  });

  it('shows Other when every given entry is drawn but taxaCount says more exist', () => {
    const segs = buildTaxonomySegments({ a: 50, b: 30 }, WIDTH, 40);
    const other = segs.find((s) => s.isOther);
    expect(other).toBeDefined();
    expect(other?.count).toBe(38);
    expect(other?.percentage).toBeCloseTo(20);
  });

  it('a stale taxaCount never reports fewer than the entries held', () => {
    const segs = buildTaxonomySegments({ a: 50, b: 3, c: 3 }, WIDTH, 1);
    expect(segs.find((s) => s.isOther)?.count).toBe(2);
  });

  it('with taxaCount, Other still needs to be wide enough to draw', () => {
    // 99.9% drawn leaves 0.1% = 0.26px, under the 0.5px floor.
    const segs = buildTaxonomySegments({ a: 99.9 }, WIDTH, 5);
    expect(segs.some((s) => s.isOther)).toBe(false);
  });
});
