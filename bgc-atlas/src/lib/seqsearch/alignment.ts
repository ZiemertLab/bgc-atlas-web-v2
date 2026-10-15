// Renders a DIAMOND hit as an NCBI BLAST-style pairwise alignment block.

const BLOSUM62_ALPHABET = 'ARNDCQEGHILKMFPSTWYVBZX*';

// prettier-ignore
const BLOSUM62_ROWS: number[][] = [
  [ 4,-1,-2,-2, 0,-1,-1, 0,-2,-1,-1,-1,-1,-2,-1, 1, 0,-3,-2, 0,-2,-1, 0,-4], // A
  [-1, 5, 0,-2,-3, 1, 0,-2, 0,-3,-2, 2,-1,-3,-2,-1,-1,-3,-2,-3,-1, 0,-1,-4], // R
  [-2, 0, 6, 1,-3, 0, 0, 0, 1,-3,-3, 0,-2,-3,-2, 1, 0,-4,-2,-3, 3, 0,-1,-4], // N
  [-2,-2, 1, 6,-3, 0, 2,-1,-1,-3,-4,-1,-3,-3,-1, 0,-1,-4,-3,-3, 4, 1,-1,-4], // D
  [ 0,-3,-3,-3, 9,-3,-4,-3,-3,-1,-1,-3,-1,-2,-3,-1,-1,-2,-2,-1,-3,-3,-2,-4], // C
  [-1, 1, 0, 0,-3, 5, 2,-2, 0,-3,-2, 1, 0,-3,-1, 0,-1,-2,-1,-2, 0, 3,-1,-4], // Q
  [-1, 0, 0, 2,-4, 2, 5,-2, 0,-3,-3, 1,-2,-3,-1, 0,-1,-3,-2,-2, 1, 4,-1,-4], // E
  [ 0,-2, 0,-1,-3,-2,-2, 6,-2,-4,-4,-2,-3,-3,-2, 0,-2,-2,-3,-3,-1,-2,-1,-4], // G
  [-2, 0, 1,-1,-3, 0, 0,-2, 8,-3,-3,-1,-2,-1,-2,-1,-2,-2, 2,-3, 0, 0,-1,-4], // H
  [-1,-3,-3,-3,-1,-3,-3,-4,-3, 4, 2,-3, 1, 0,-3,-2,-1,-3,-1, 3,-3,-3,-1,-4], // I
  [-1,-2,-3,-4,-1,-2,-3,-4,-3, 2, 4,-2, 2, 0,-3,-2,-1,-2,-1, 1,-4,-3,-1,-4], // L
  [-1, 2, 0,-1,-3, 1, 1,-2,-1,-3,-2, 5,-1,-3,-1, 0,-1,-3,-2,-2, 0, 1,-1,-4], // K
  [-1,-1,-2,-3,-1, 0,-2,-3,-2, 1, 2,-1, 5, 0,-2,-1,-1,-1,-1, 1,-3,-1,-1,-4], // M
  [-2,-3,-3,-3,-2,-3,-3,-3,-1, 0, 0,-3, 0, 6,-4,-2,-2, 1, 3,-1,-3,-3,-1,-4], // F
  [-1,-2,-2,-1,-3,-1,-1,-2,-2,-3,-3,-1,-2,-4, 7,-1,-1,-4,-3,-2,-2,-1,-2,-4], // P
  [ 1,-1, 1, 0,-1, 0, 0, 0,-1,-2,-2, 0,-1,-2,-1, 4, 1,-3,-2,-2, 0, 0, 0,-4], // S
  [ 0,-1, 0,-1,-1,-1,-1,-2,-2,-1,-1,-1,-1,-2,-1, 1, 5,-2,-2, 0,-1,-1, 0,-4], // T
  [-3,-3,-4,-4,-2,-2,-3,-2,-2,-3,-2,-3,-1, 1,-4,-3,-2,11, 2,-3,-4,-3,-2,-4], // W
  [-2,-2,-2,-3,-2,-1,-2,-3, 2,-1,-1,-2,-1, 3,-3,-2,-2, 2, 7,-1,-3,-2,-1,-4], // Y
  [ 0,-3,-3,-3,-1,-2,-2,-3,-3, 3, 1,-2, 1,-1,-2,-2, 0,-3,-1, 4,-3,-2,-1,-4], // V
  [-2,-1, 3, 4,-3, 0, 1,-1, 0,-3,-4, 0,-3,-3,-2, 0,-1,-4,-3,-3, 4, 1,-1,-4], // B
  [-1, 0, 0, 1,-3, 3, 4,-2, 0,-3,-3, 1,-1,-3,-1, 0,-1,-3,-2,-2, 1, 4,-1,-4], // Z
  [ 0,-1,-1,-1,-2,-1,-1,-1,-1,-1,-1,-1,-1,-1,-2, 0, 0,-2,-1,-1,-1,-1,-1,-4], // X
  [-4,-4,-4,-4,-4,-4,-4,-4,-4,-4,-4,-4,-4,-4,-4,-4,-4,-4,-4,-4,-4,-4,-4, 1], // *
];

const BLOSUM62_INDEX = new Map<string, number>(
  BLOSUM62_ALPHABET.split('').map((residue, i) => [residue, i])
);

export function blosum62(a: string, b: string): number {
  const i = BLOSUM62_INDEX.get(a.toUpperCase());
  const j = BLOSUM62_INDEX.get(b.toUpperCase());
  if (i === undefined || j === undefined) return 0;
  return BLOSUM62_ROWS[i][j];
}

export interface AlignmentLine {
  queryStart: number;
  queryLine: string;
  queryEnd: number;
  midline: string;
  targetStart: number;
  targetLine: string;
  targetEnd: number;
}

export interface FormattedAlignment {
  lines: AlignmentLine[];
  /** Gaps included. */
  length: number;
  identities: number;
  positives: number;
  gaps: number;
  identityPct: number;
  positivesPct: number;
  gapsPct: number;
}

export interface FormatAlignmentOptions {
  queryAligned: string;
  targetAligned: string;
  queryStart: number;
  queryEnd: number;
  targetStart: number;
  /** blastx: aligned strings are protein but query coordinates are nucleotides. */
  isNucleotideQuery?: boolean;
  lineWidth?: number;
}

export function buildMidline(queryAligned: string, targetAligned: string): string {
  let midline = '';
  for (let i = 0; i < queryAligned.length; i++) {
    const q = queryAligned[i];
    const t = targetAligned[i] ?? '-';
    if (q === '-' || t === '-') {
      midline += ' ';
    } else if (q.toUpperCase() === t.toUpperCase()) {
      midline += q.toUpperCase();
    } else {
      midline += blosum62(q, t) > 0 ? '+' : ' ';
    }
  }
  return midline;
}

/**
 * Rebuild gapped aligned strings from DIAMOND's BTOP; its qseq/sseq carry no gap characters.
 * BTOP: match run-lengths as numbers, then query+subject letter pairs ("7AG10", "7-G10").
 * Returns null if the traceback does not consume both sequences exactly.
 */
export function expandBtop(
  btop: string,
  queryAligned: string,
  targetAligned: string
): { query: string; target: string } | null {
  if (!btop || !queryAligned || !targetAligned) return null;

  let query = '';
  let target = '';
  let qi = 0;
  let si = 0;

  for (let i = 0; i < btop.length; ) {
    const char = btop[i];

    if (char >= '0' && char <= '9') {
      let digits = '';
      while (i < btop.length && btop[i] >= '0' && btop[i] <= '9') digits += btop[i++];
      const run = Number(digits);
      if (qi + run > queryAligned.length || si + run > targetAligned.length) return null;
      query += queryAligned.slice(qi, qi + run);
      target += targetAligned.slice(si, si + run);
      qi += run;
      si += run;
      continue;
    }

    if (i + 1 >= btop.length) return null;
    const q = btop[i];
    const t = btop[i + 1];
    i += 2;

    if (q === '-' && t === '-') return null;

    if (q === '-') {
      query += '-';
      target += targetAligned[si++] ?? t;
    } else if (t === '-') {
      query += queryAligned[qi++] ?? q;
      target += '-';
    } else {
      query += queryAligned[qi++] ?? q;
      target += targetAligned[si++] ?? t;
    }
  }

  if (qi !== queryAligned.length || si !== targetAligned.length) return null;
  if (query.length !== target.length) return null;

  return { query, target };
}

export function formatAlignment(options: FormatAlignmentOptions): FormattedAlignment | null {
  const { queryAligned, targetAligned, queryStart, queryEnd, targetStart } = options;
  const lineWidth = options.lineWidth ?? 60;

  if (!queryAligned || !targetAligned) return null;

  // Unequal lengths, e.g. a blastx row captured with `qseq` instead of `qseq_translated`.
  if (queryAligned.length !== targetAligned.length) return null;

  const length = queryAligned.length;
  if (length === 0) return null;

  const midline = buildMidline(queryAligned.slice(0, length), targetAligned.slice(0, length));

  let identities = 0;
  let positives = 0;
  let gaps = 0;
  for (let i = 0; i < length; i++) {
    const q = queryAligned[i];
    const t = targetAligned[i];
    if (q === '-' || t === '-') {
      gaps++;
      continue;
    }
    if (q.toUpperCase() === t.toUpperCase()) {
      identities++;
      positives++;
    } else if (blosum62(q, t) > 0) {
      positives++;
    }
  }

  // blastx advances one codon per residue and runs high→low on the minus strand (qstart > qend).
  const queryStep = options.isNucleotideQuery ? 3 : 1;
  const queryDir = queryEnd < queryStart ? -1 : 1;

  let queryCursor = queryStart;
  let targetCursor = targetStart;

  const lines: AlignmentLine[] = [];

  for (let offset = 0; offset < length; offset += lineWidth) {
    const queryChunk = queryAligned.slice(offset, offset + lineWidth);
    const targetChunk = targetAligned.slice(offset, offset + lineWidth);

    const lineQueryStart = queryCursor;
    const lineTargetStart = targetCursor;
    let lastQueryCoord = queryCursor;
    let lastTargetCoord = targetCursor;
    let consumedQuery = false;
    let consumedTarget = false;

    for (const residue of queryChunk) {
      if (residue === '-') continue;
      lastQueryCoord = queryCursor + queryDir * (queryStep - 1);
      queryCursor += queryDir * queryStep;
      consumedQuery = true;
    }
    for (const residue of targetChunk) {
      if (residue === '-') continue;
      lastTargetCoord = targetCursor;
      targetCursor += 1;
      consumedTarget = true;
    }

    lines.push({
      // An all-gap line has no coordinates of its own; BLAST repeats the last one.
      queryStart: consumedQuery ? lineQueryStart : lastQueryCoord,
      queryLine: queryChunk,
      queryEnd: lastQueryCoord,
      midline: midline.slice(offset, offset + lineWidth),
      targetStart: consumedTarget ? lineTargetStart : lastTargetCoord,
      targetLine: targetChunk,
      targetEnd: lastTargetCoord,
    });
  }

  const pct = (n: number) => (length ? (n / length) * 100 : 0);

  return {
    lines,
    length,
    identities,
    positives,
    gaps,
    identityPct: pct(identities),
    positivesPct: pct(positives),
    gapsPct: pct(gaps),
  };
}
