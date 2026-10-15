import { describe, expect, it } from 'vitest';
import { buildDiamondArgs } from './args';

const base = {
  queryFile: '/s/query.fasta',
  dbPath: '/db/regions_prot',
  resultsFile: '/s/out.tsv',
  eValue: 1e-5,
  minIdentity: 30,
  minCoverage: 50,
  maxResults: 1000,
  threads: 64,
  tmpDir: '/s/tmp',
};

const flagValue = (args: string[], flag: string) => args[args.indexOf(flag) + 1];

describe('buildDiamondArgs — alignment mode', () => {
  it('uses blastp for protein queries', () => {
    expect(buildDiamondArgs({ ...base, sequenceType: 'protein' })[1]).toBe('blastp');
  });

  it('uses blastx for nucleotide queries', () => {
    expect(buildDiamondArgs({ ...base, sequenceType: 'nucleotide' })[1]).toBe('blastx');
  });
});

describe('buildDiamondArgs — coverage filter', () => {
  it('filters on query coverage for protein queries', () => {
    const args = buildDiamondArgs({ ...base, sequenceType: 'protein' });
    expect(args).toContain('--query-cover');
    expect(args).not.toContain('--subject-cover');
    expect(flagValue(args, '--query-cover')).toBe('50');
  });

  it('filters on subject coverage for nucleotide queries', () => {
    // No single CDS covers half a multi-kb nucleotide query, so --query-cover 50 would return nothing.
    const args = buildDiamondArgs({ ...base, sequenceType: 'nucleotide' });
    expect(args).toContain('--subject-cover');
    expect(args).not.toContain('--query-cover');
    expect(flagValue(args, '--subject-cover')).toBe('50');
  });
});

describe('buildDiamondArgs — passthrough', () => {
  it('carries the search parameters through', () => {
    const args = buildDiamondArgs({ ...base, sequenceType: 'protein' });
    expect(flagValue(args, '--query')).toBe('/s/query.fasta');
    expect(flagValue(args, '--db')).toBe('/db/regions_prot');
    expect(flagValue(args, '--out')).toBe('/s/out.tsv');
    expect(flagValue(args, '--evalue')).toBe('0.00001');
    expect(flagValue(args, '--id')).toBe('30');
    expect(flagValue(args, '--max-target-seqs')).toBe('1000');
    expect(flagValue(args, '--threads')).toBe('64');
    expect(flagValue(args, '--tmpdir')).toBe('/s/tmp');
  });

  it('requests the 14 statistic columns the parser expects, in order', () => {
    const args = buildDiamondArgs({ ...base, sequenceType: 'protein' });
    const start = args.indexOf('--outfmt');
    expect(args.slice(start + 1, start + 16)).toEqual([
      '6', 'qseqid', 'sseqid', 'pident', 'length', 'mismatch', 'gapopen',
      'qstart', 'qend', 'sstart', 'send', 'evalue', 'bitscore', 'qlen', 'slen',
    ]);
  });

  it('appends the aligned sequences after the statistics', () => {
    const args = buildDiamondArgs({ ...base, sequenceType: 'protein' });
    const start = args.indexOf('--outfmt');
    expect(args.slice(start + 16, start + 18)).toEqual(['qseq', 'sseq']);
  });

  it('asks for the traceback so gapped alignments can be reconstructed', () => {
    for (const sequenceType of ['protein', 'nucleotide'] as const) {
      const args = buildDiamondArgs({ ...base, sequenceType });
      const start = args.indexOf('--outfmt');
      expect(args[start + 18]).toBe('btop');
    }
  });

  // blastx `qseq` is the nucleotide segment, which cannot be shown against a protein subject.
  it('asks for the translated query on a nucleotide search', () => {
    const args = buildDiamondArgs({ ...base, sequenceType: 'nucleotide' });
    const start = args.indexOf('--outfmt');
    expect(args.slice(start + 16, start + 18)).toEqual(['qseq_translated', 'sseq']);
    expect(args).not.toContain('qseq');
  });

  it('includes the block size only when one is configured', () => {
    expect(buildDiamondArgs({ ...base, sequenceType: 'protein', blockSize: '12' }))
      .toContain('--block-size');
    expect(buildDiamondArgs({ ...base, sequenceType: 'protein' }))
      .not.toContain('--block-size');
  });
});
