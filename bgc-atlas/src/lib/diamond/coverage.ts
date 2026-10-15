// Alignment length is in amino acids, but blastx `qlen` is nucleotides; uncorrected, a
// full-length match would read as 33% query coverage.

export interface Coverages {
  queryCoverage: number;
  targetCoverage: number;
}

export function computeCoverages(
  alignmentLength: number,
  queryLen: number,
  targetLen: number,
  sequenceType: 'nucleotide' | 'protein',
): Coverages {
  const queryUnitsPerResidue = sequenceType === 'nucleotide' ? 3 : 1;

  const queryCoverage = queryLen > 0
    ? Math.min(100, (alignmentLength * queryUnitsPerResidue / queryLen) * 100)
    : 0;
  // The subject side is protein in both modes, so it needs no correction.
  const targetCoverage = targetLen > 0
    ? Math.min(100, (alignmentLength / targetLen) * 100)
    : 0;

  return { queryCoverage, targetCoverage };
}
