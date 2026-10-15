export interface SeqSearchHit {
  queryId: string;
  targetId: string;
  identity: number;         // percentage
  alignmentLength: number;
  mismatches: number;
  gapOpens: number;
  queryStart: number;
  queryEnd: number;
  targetStart: number;
  targetEnd: number;
  eValue: number;
  bitScore: number;
  queryLen: number;
  targetLen: number;
  queryCoverage: number;    // (alignmentLength / queryLen) * 100
  targetCoverage: number;   // (alignmentLength / targetLen) * 100
  /**
   * Absent in older result files. For blastx these are protein even though
   * queryStart/queryEnd are nucleotide coordinates.
   */
  queryAligned?: string;
  targetAligned?: string;
}
