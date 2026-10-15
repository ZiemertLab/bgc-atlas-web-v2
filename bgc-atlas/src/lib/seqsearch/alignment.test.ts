import { describe, expect, it } from 'vitest';

import { blosum62, buildMidline, expandBtop, formatAlignment } from './alignment';

describe('blosum62', () => {
  it('matches known matrix entries', () => {
    expect(blosum62('A', 'A')).toBe(4);
    expect(blosum62('W', 'W')).toBe(11);
    expect(blosum62('C', 'C')).toBe(9);
    expect(blosum62('L', 'I')).toBe(2);
    expect(blosum62('K', 'R')).toBe(2);
    expect(blosum62('F', 'Y')).toBe(3);
    expect(blosum62('D', 'E')).toBe(2);
    expect(blosum62('S', 'T')).toBe(1);
  });

  it('is symmetric', () => {
    for (const [a, b] of [['A', 'W'], ['L', 'K'], ['G', 'P'], ['Y', 'C']]) {
      expect(blosum62(a, b)).toBe(blosum62(b, a));
    }
  });

  it('scores dissimilar pairs negatively', () => {
    expect(blosum62('W', 'P')).toBeLessThan(0);
    expect(blosum62('C', 'E')).toBeLessThan(0);
  });

  it('returns 0 for characters outside the alphabet', () => {
    expect(blosum62('-', 'A')).toBe(0);
    expect(blosum62('?', '?')).toBe(0);
  });
});

describe('buildMidline', () => {
  it('shows the residue for identities', () => {
    expect(buildMidline('MKT', 'MKT')).toBe('MKT');
  });

  it('shows + for a conservative substitution and a space otherwise', () => {
    //  K/R = 2 (positive), W/P = -4 (negative)
    expect(buildMidline('KW', 'RP')).toBe('+ ');
  });

  it('leaves a space against a gap on either side', () => {
    expect(buildMidline('M-T', 'MAT')).toBe('M T');
    expect(buildMidline('MAT', 'M-T')).toBe('M T');
  });
});

describe('formatAlignment', () => {
  const protein = {
    queryAligned: 'MKTAYIAKQR',
    targetAligned: 'MKTAYIAKQR',
    queryStart: 1,
    queryEnd: 10,
    targetStart: 12,
  };

  it('counts identities, positives and gaps over the alignment columns', () => {
    const result = formatAlignment({
      queryAligned: 'MKTAY',
      targetAligned: 'MRT-Y',
      queryStart: 1,
      queryEnd: 5,
      targetStart: 1,
    })!;
    expect(result.length).toBe(5);
    expect(result.identities).toBe(3);      // M, T, Y
    expect(result.positives).toBe(4);       // + K/R
    expect(result.gaps).toBe(1);
    expect(result.identityPct).toBeCloseTo(60);
    expect(result.positivesPct).toBeCloseTo(80);
    expect(result.gapsPct).toBeCloseTo(20);
  });

  it('walks protein coordinates one residue at a time', () => {
    const [line] = formatAlignment(protein)!.lines;
    expect(line.queryStart).toBe(1);
    expect(line.queryEnd).toBe(10);
    expect(line.targetStart).toBe(12);
    expect(line.targetEnd).toBe(21);
  });

  it('does not advance a coordinate across a gap', () => {
    const [line] = formatAlignment({
      queryAligned: 'MK-AY',
      targetAligned: 'MKTAY',
      queryStart: 1,
      queryEnd: 4,
      targetStart: 1,
    })!.lines;
    expect(line.queryEnd).toBe(4);
    expect(line.targetEnd).toBe(5);
  });

  it('wraps at the requested width with running coordinates', () => {
    const result = formatAlignment({
      queryAligned: 'A'.repeat(25),
      targetAligned: 'A'.repeat(25),
      queryStart: 1,
      queryEnd: 25,
      targetStart: 101,
      lineWidth: 10,
    })!;
    expect(result.lines).toHaveLength(3);
    expect(result.lines.map((l) => [l.queryStart, l.queryEnd])).toEqual([
      [1, 10], [11, 20], [21, 25],
    ]);
    expect(result.lines.map((l) => [l.targetStart, l.targetEnd])).toEqual([
      [101, 110], [111, 120], [121, 125],
    ]);
  });

  // blastx: the aligned strings are protein, the query ruler is nucleotides.
  it('advances a nucleotide query by one codon per residue', () => {
    const [line] = formatAlignment({
      queryAligned: 'MKTAY',
      targetAligned: 'MKTAY',
      queryStart: 1,
      queryEnd: 15,
      targetStart: 1,
      isNucleotideQuery: true,
    })!.lines;
    expect(line.queryStart).toBe(1);
    expect(line.queryEnd).toBe(15);
    expect(line.targetEnd).toBe(5);
  });

  it('runs the ruler backwards on a minus-strand hit', () => {
    const [line] = formatAlignment({
      queryAligned: 'MKTAY',
      targetAligned: 'MKTAY',
      queryStart: 100,
      queryEnd: 86,
      targetStart: 1,
      isNucleotideQuery: true,
    })!.lines;
    expect(line.queryStart).toBe(100);
    expect(line.queryEnd).toBe(86);
  });

  it('keeps the reported endpoint consistent with DIAMOND for a gapped blastx hit', () => {
    const result = formatAlignment({
      queryAligned: 'MK-TAY',
      targetAligned: 'MKQTAY',
      queryStart: 1,
      queryEnd: 15,
      targetStart: 1,
      isNucleotideQuery: true,
    })!;
    expect(result.lines[0].queryEnd).toBe(15);
  });

  it('returns null when a sequence is missing', () => {
    expect(formatAlignment({ ...protein, queryAligned: '' })).toBeNull();
    expect(formatAlignment({ ...protein, targetAligned: '' })).toBeNull();
  });

  it('refuses unequal-length sequences rather than misaligning columns', () => {
    expect(
      formatAlignment({
        queryAligned: 'MKTAY',
        targetAligned: 'MKT',
        queryStart: 1,
        queryEnd: 3,
        targetStart: 1,
      })
    ).toBeNull();
  });

  it('refuses a blastx row captured as nucleotides instead of the translation', () => {
    // A row written with qseq rather than qseq_translated is 3x too long.
    expect(
      formatAlignment({
        queryAligned: 'ATGAAAACT',
        targetAligned: 'MKT',
        queryStart: 1,
        queryEnd: 9,
        targetStart: 1,
        isNucleotideQuery: true,
      })
    ).toBeNull();
  });
});

describe('expandBtop', () => {
  it('expands a run of matches', () => {
    expect(expandBtop('5', 'MKTAY', 'MKTAY')).toEqual({ query: 'MKTAY', target: 'MKTAY' });
  });

  it('expands a mismatch between runs', () => {
    expect(expandBtop('2AV2', 'MKATY', 'MKVTY')).toEqual({ query: 'MKATY', target: 'MKVTY' });
  });

  it('places a gap in the query', () => {
    expect(expandBtop('2-Q2', 'MKTY', 'MKQTY')).toEqual({ query: 'MK-TY', target: 'MKQTY' });
  });

  it('places a gap in the subject', () => {
    expect(expandBtop('2A-2', 'MKATY', 'MKTY')).toEqual({ query: 'MKATY', target: 'MK-TY' });
  });

  it('handles multi-digit runs', () => {
    const q = 'A'.repeat(12) + 'C' + 'A'.repeat(3);
    const t = 'A'.repeat(12) + 'D' + 'A'.repeat(3);
    expect(expandBtop('12CD3', q, t)).toEqual({ query: q, target: t });
  });

  it('always returns equal-length sides', () => {
    for (const [btop, q, t] of [
      ['2-Q2', 'MKTY', 'MKQTY'],
      ['2A-2', 'MKATY', 'MKTY'],
      ['1-A-A1', 'MY', 'MAAY'],
    ] as const) {
      const out = expandBtop(btop, q, t)!;
      expect(out.query.length).toBe(out.target.length);
    }
  });

  it('refuses a traceback that does not consume both sequences', () => {
    expect(expandBtop('3', 'MKTAY', 'MKTAY')).toBeNull();   // leaves residues over
    expect(expandBtop('9', 'MKTAY', 'MKTAY')).toBeNull();   // runs past the end
    expect(expandBtop('2A', 'MKATY', 'MKVTY')).toBeNull();  // dangling half-pair
    expect(expandBtop('2--2', 'MKTY', 'MKTY')).toBeNull();  // gap opposite gap
  });

  it('returns null on empty input', () => {
    expect(expandBtop('', 'MK', 'MK')).toBeNull();
    expect(expandBtop('2', '', '')).toBeNull();
  });

  it('feeds formatAlignment a drawable alignment', () => {
    const { query, target } = expandBtop('2-Q2', 'MKTY', 'MKQTY')!;
    const aln = formatAlignment({
      queryAligned: query, targetAligned: target,
      queryStart: 1, queryEnd: 4, targetStart: 1,
    })!;
    expect(aln.length).toBe(5);
    expect(aln.gaps).toBe(1);
    expect(aln.identities).toBe(4);
    expect(aln.lines[0].midline).toBe('MK TY');
  });
});
