import { describe, expect, it } from 'vitest';

import {
  BIT_SCORE_BANDS,
  bitScoreBand,
  classifyColumn,
  toColumnRuns,
} from './result-colors';

describe('bitScoreBand', () => {
  it('places scores in the NCBI bands', () => {
    expect(bitScoreBand(0).label).toBe('< 40');
    expect(bitScoreBand(39.9).label).toBe('< 40');
    expect(bitScoreBand(40).label).toBe('40–50');
    expect(bitScoreBand(49.9).label).toBe('40–50');
    expect(bitScoreBand(50).label).toBe('50–80');
    expect(bitScoreBand(79.9).label).toBe('50–80');
    expect(bitScoreBand(80).label).toBe('80–200');
    expect(bitScoreBand(199.9).label).toBe('80–200');
    expect(bitScoreBand(200).label).toBe('≥ 200');
    expect(bitScoreBand(940).label).toBe('≥ 200');
  });

  it('clamps nonsense to the weakest band rather than throwing', () => {
    expect(bitScoreBand(-5).label).toBe('< 40');
    expect(bitScoreBand(NaN).label).toBe('< 40');
    expect(bitScoreBand(Infinity).label).toBe('< 40');
  });

  it('gives every band a distinct colour', () => {
    const colors = BIT_SCORE_BANDS.map((b) => b.color);
    expect(new Set(colors).size).toBe(colors.length);
  });
});

describe('classifyColumn', () => {
  it('reads the class off the midline character', () => {
    expect(classifyColumn('M', 'M', 'M')).toBe('identity');
    expect(classifyColumn('K', 'R', '+')).toBe('positive');
    expect(classifyColumn('A', 'V', ' ')).toBe('mismatch');
  });

  it('treats a gap on either side as a gap, whatever the midline says', () => {
    expect(classifyColumn('-', 'M', ' ')).toBe('gap');
    expect(classifyColumn('M', '-', ' ')).toBe('gap');
  });
});

describe('toColumnRuns', () => {
  it('collapses consecutive same-class columns', () => {
    const runs = toColumnRuns('MKTAY', 'MKTVY', 'MKT Y');
    expect(runs).toEqual([
      { className: 'identity', start: 0, length: 3 },
      { className: 'mismatch', start: 3, length: 1 },
      { className: 'identity', start: 4, length: 1 },
    ]);
  });

  it('covers every column exactly once, in order', () => {
    const query = 'MK-TAYKW';
    const runs = toColumnRuns(query, 'MRQTAYPW', 'M+ TAY W');
    expect(runs.reduce((sum, r) => sum + r.length, 0)).toBe(query.length);
    let cursor = 0;
    for (const run of runs) {
      expect(run.start).toBe(cursor);
      cursor += run.length;
    }
  });

  it('slices all three lines in register', () => {
    const q = 'MKTAY';
    const t = 'MKTVY';
    const mid = 'MKT Y';
    const runs = toColumnRuns(q, t, mid);
    const mismatch = runs.find((r) => r.className === 'mismatch')!;
    expect(q.slice(mismatch.start, mismatch.start + mismatch.length)).toBe('A');
    expect(t.slice(mismatch.start, mismatch.start + mismatch.length)).toBe('V');
    expect(mid.slice(mismatch.start, mismatch.start + mismatch.length)).toBe(' ');
  });

  it('returns nothing for an empty line', () => {
    expect(toColumnRuns('', '', '')).toEqual([]);
  });
});
