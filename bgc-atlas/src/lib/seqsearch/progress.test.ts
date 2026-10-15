import { describe, expect, it } from 'vitest';
import { parseDiamondProgress } from './progress';

const opening = `
#CPU threads: 64
Opening the database...  [0s]
Database: /data/bgc-atlas/.../regions_prot (type: Diamond database, sequences: 170574613, letters: 52471516866)
Loading query sequences...  [0.005s]
Algorithm: Query-indexed
Loading reference sequences...  [20.176s]
`;

const block = (q: number, r: number, t: number, shape: number) =>
  `Processing query block ${q}, reference block ${r}/${t}, shape ${shape}/2.\n` +
  `Building reference seed array...  [2.12s]\nComputing alignments...  [212.813s]\n`;

describe('parseDiamondProgress', () => {
  it('reports nothing during the opening phase, so the caller stays indeterminate', () => {
    expect(parseDiamondProgress(opening)).toBeNull();
  });

  it('reads the latest block position, not the first', () => {
    const log = opening + block(1, 1, 5, 1) + block(1, 1, 5, 2) + block(1, 2, 5, 1) + block(1, 3, 5, 1);
    expect(parseDiamondProgress(log)).toMatchObject({ queryBlock: 1, refBlock: 3, refBlocks: 5 });
  });

  it('counts the running block as half done, so it never reads as finished', () => {
    expect(parseDiamondProgress(opening + block(1, 3, 5, 1))?.fraction).toBeCloseTo(0.5);
    expect(parseDiamondProgress(opening + block(1, 1, 5, 1))?.fraction).toBeCloseTo(0.1);
    expect(parseDiamondProgress(opening + block(1, 5, 5, 2))?.fraction).toBeCloseTo(0.9);
  });

  it('carries the query block through for multi-block queries', () => {
    expect(parseDiamondProgress(opening + block(2, 1, 5, 1))).toMatchObject({ queryBlock: 2, refBlock: 1 });
  });

  it('never returns a fraction outside 0..1', () => {
    const p = parseDiamondProgress(opening + block(1, 1, 1, 1));
    expect(p!.fraction).toBeGreaterThanOrEqual(0);
    expect(p!.fraction).toBeLessThanOrEqual(1);
  });

  it('rejects a nonsensical block count rather than reporting past the end', () => {
    expect(parseDiamondProgress(opening + block(1, 7, 5, 1))).toBeNull();
    expect(parseDiamondProgress(opening + block(1, 1, 0, 1))).toBeNull();
  });

  it('ignores unrelated log text', () => {
    expect(parseDiamondProgress('Total time = 1885s\nReported 28326 pairwise alignments\n')).toBeNull();
  });
});
