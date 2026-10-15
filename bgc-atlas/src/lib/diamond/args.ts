// DIAMOND command-line construction, kept separate from process spawning so the flag choices
// can be asserted directly.

export interface DiamondArgsOptions {
  sequenceType: 'nucleotide' | 'protein';
  queryFile: string;
  dbPath: string;
  resultsFile: string;
  eValue: number;
  minIdentity: number;
  minCoverage: number;
  maxResults: number;
  threads: number;
  tmpDir: string;
  blockSize?: string;
}

export function buildDiamondArgs(options: DiamondArgsOptions): string[] {
  const {
    sequenceType, queryFile, dbPath, resultsFile,
    eValue, minIdentity, minCoverage, maxResults, threads, tmpDir, blockSize,
  } = options;

  const isNucleotide = sequenceType === 'nucleotide';

  // No single CDS covers a large fraction of a multi-gene nucleotide query, so blastx filters on
  // the hit's own coverage (--subject-cover).
  const coverageFlag = isNucleotide ? '--subject-cover' : '--query-cover';

  return [
    'diamond', isNucleotide ? 'blastx' : 'blastp',
    '--query', queryFile,
    '--db', dbPath,
    '--out', resultsFile,
    // qseq/sseq/btop go last so older result files still parse. For blastx `qseq` is nucleotides,
    // so qseq_translated is used. Neither carries gaps; btop is the traceback that rebuilds them.
    '--outfmt', '6', 'qseqid', 'sseqid', 'pident', 'length', 'mismatch', 'gapopen', 'qstart', 'qend', 'sstart', 'send', 'evalue', 'bitscore', 'qlen', 'slen', isNucleotide ? 'qseq_translated' : 'qseq', 'sseq', 'btop',
    '--evalue', eValue.toString(),
    '--id', minIdentity.toString(),
    coverageFlag, minCoverage.toString(),
    '--max-target-seqs', maxResults.toString(),
    '--threads', threads.toString(),
    // Larger blocks mean fewer passes over the 63 GB DB, at ~6 GB RAM per unit.
    ...(blockSize ? ['--block-size', blockSize] : []),
    '--tmpdir', tmpDir,
  ];
}
