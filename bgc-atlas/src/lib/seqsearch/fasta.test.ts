import { describe, expect, it } from 'vitest';
import { calculateSequenceHash, normalizeToFasta, validateFastaSequence } from './fasta';

const protein = 'MLRRKLLYLLLTVPLYAWLISMTKIELVALFLGYVFIFSQLNRIQEQSILEVCIFSISIELF';

describe('validateFastaSequence — protein', () => {
  it('accepts a protein sequence and reports its type', () => {
    const result = validateFastaSequence(`>q1\n${protein}`);
    expect(result.valid).toBe(true);
    expect(result.sequenceType).toBe('protein');
    expect(result.sequences).toHaveLength(1);
    expect(result.sequences[0].length).toBe(protein.length);
  });

  it('rejects a protein below the 10 aa floor', () => {
    const result = validateFastaSequence('>q1\nMLRRK');
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/too short/i);
  });

  it('rejects a protein above the 10,000 aa ceiling', () => {
    const result = validateFastaSequence(`>q1\n${'MLRRKLLYLW'.repeat(1001)}`);
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/too long/i);
  });
});

describe('validateFastaSequence — nucleotide', () => {
  it('accepts a nucleotide sequence and reports its type', () => {
    const result = validateFastaSequence(`>q1\n${'ATGCATGCAT'.repeat(5)}`);
    expect(result.valid).toBe(true);
    expect(result.sequenceType).toBe('nucleotide');
  });

  it('accepts a nucleotide query longer than the protein ceiling', () => {
    const result = validateFastaSequence(`>q1\n${'ATGC'.repeat(3000)}`);
    expect(result.valid).toBe(true);
    expect(result.sequenceType).toBe('nucleotide');
  });

  it('rejects a nucleotide query above the 30,000 nt ceiling', () => {
    const result = validateFastaSequence(`>q1\n${'ATGC'.repeat(7501)}`);
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/too long/i);
  });

  it('rejects a nucleotide query below the 30 nt floor', () => {
    const result = validateFastaSequence('>q1\nATGCATGCATGCATGC');
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/too short/i);
  });

  it('names the unit in the length error so the bound is not mistaken for amino acids', () => {
    const result = validateFastaSequence('>q1\nATGCATGCATGCATGC');
    expect(result.error).toMatch(/nucleotide/i);
  });

  it('rejects invalid nucleotide characters', () => {
    const result = validateFastaSequence(`>q1\n${'ATGCATGCAT'.repeat(5)}ZZZ`);
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/invalid nucleotide/i);
  });

  it('tolerates lowercase input', () => {
    const result = validateFastaSequence(`>q1\n${'atgcatgcat'.repeat(5)}`);
    expect(result.valid).toBe(true);
    expect(result.sequenceType).toBe('nucleotide');
  });
});

describe('validateFastaSequence — structure', () => {
  it('rejects input that does not start with a header', () => {
    expect(validateFastaSequence(protein).valid).toBe(false);
  });

  it('rejects empty input', () => {
    expect(validateFastaSequence('   ').valid).toBe(false);
  });

  it('rejects a mix of nucleotide and protein sequences', () => {
    const result = validateFastaSequence(`>q1\n${'ATGCATGCAT'.repeat(5)}\n>q2\n${protein}`);
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/mixed|ambiguous/i);
  });

  it('parses multiple sequences of the same type', () => {
    const result = validateFastaSequence(`>q1\n${protein}\n>q2\n${protein}`);
    expect(result.valid).toBe(true);
    expect(result.sequences.map(s => s.header)).toEqual(['>q1', '>q2']);
  });

  it('rejects more than 100 sequences', () => {
    const many = Array.from({ length: 101 }, (_, i) => `>q${i}\n${protein}`).join('\n');
    const result = validateFastaSequence(many);
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/too many sequences/i);
  });
});

describe('calculateSequenceHash', () => {
  it('is stable across surrounding whitespace', () => {
    expect(calculateSequenceHash(`>q1\n${protein}`)).toBe(calculateSequenceHash(`  >q1\n${protein}  `));
  });

  it('differs for different sequences', () => {
    expect(calculateSequenceHash('>q1\nMLRRK')).not.toBe(calculateSequenceHash('>q1\nMLRRQ'));
  });
});

describe('normalizeToFasta', () => {
  it('wraps a bare protein sequence in a header', () => {
    expect(normalizeToFasta(protein)).toBe(`>query\n${protein}`);
  });

  it('wraps a bare nucleotide sequence in a header', () => {
    const nt = 'ATGCATGCAT'.repeat(5);
    expect(normalizeToFasta(nt)).toBe(`>query\n${nt}`);
  });

  it('leaves input that is already FASTA untouched', () => {
    const fasta = `>seq1\n${protein}`;
    expect(normalizeToFasta(fasta)).toBe(fasta);
  });

  it('trims surrounding whitespace before deciding', () => {
    expect(normalizeToFasta(`\n\n  >seq1\n${protein}\n\n`)).toBe(`>seq1\n${protein}`);
  });

  it('keeps a wrapped bare sequence as one record', () => {
    const wrapped = 'MLRRKLLYLW\nMLRRKLLYLW\nMLRRKLLYLW';
    const result = validateFastaSequence(normalizeToFasta(wrapped));
    expect(result.valid).toBe(true);
    expect(result.sequences).toHaveLength(1);
    expect(result.sequences[0].sequence).toBe('MLRRKLLYLWMLRRKLLYLWMLRRKLLYLW');
  });

  it('adds a header only to the leading bare sequence when later ones have their own', () => {
    const mixed = `${protein}\n>seq2\n${protein}`;
    const result = validateFastaSequence(normalizeToFasta(mixed));
    expect(result.valid).toBe(true);
    expect(result.sequences.map(s => s.header)).toEqual(['>query', '>seq2']);
  });

  it('leaves empty input empty so it still fails validation', () => {
    expect(normalizeToFasta('   ')).toBe('');
    expect(validateFastaSequence(normalizeToFasta('   ')).valid).toBe(false);
  });
});

describe('validateFastaSequence — bare input is accepted', () => {
  it('no longer rejects a pasted sequence that lacks a header', () => {
    const result = validateFastaSequence(normalizeToFasta(protein));
    expect(result.valid).toBe(true);
    expect(result.sequenceType).toBe('protein');
  });
});
