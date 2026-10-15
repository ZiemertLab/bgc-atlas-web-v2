import { describe, expect, it } from 'vitest';
import { computeCoverages } from './coverage';

describe('computeCoverages — protein queries (blastp)', () => {
  it('is the aligned fraction of each sequence', () => {
    expect(computeCoverages(50, 100, 200, 'protein')).toEqual({
      queryCoverage: 50,
      targetCoverage: 25,
    });
  });

  it('reports 100% for a full-length self hit', () => {
    expect(computeCoverages(300, 300, 300, 'protein').queryCoverage).toBe(100);
  });
});

describe('computeCoverages — nucleotide queries (blastx)', () => {
  it('scales the query side by 3, because qlen is nucleotides and alnlen is amino acids', () => {
    // 1200 nt fully aligned = 400 aa; uncorrected this reads as 33.3%.
    expect(computeCoverages(400, 1200, 400, 'nucleotide').queryCoverage).toBe(100);
  });

  it('leaves target coverage alone — the subject is protein in both modes', () => {
    expect(computeCoverages(400, 1200, 800, 'nucleotide').targetCoverage).toBe(50);
  });

  it('clamps at 100% when the codon arithmetic overshoots on a partial codon', () => {
    expect(computeCoverages(400, 1199, 400, 'nucleotide').queryCoverage).toBe(100);
  });
});

describe('computeCoverages — degenerate input', () => {
  it('returns 0 rather than Infinity when a length is missing', () => {
    expect(computeCoverages(50, 0, 0, 'protein')).toEqual({ queryCoverage: 0, targetCoverage: 0 });
  });
});
