// NCBI BLAST's bit-score bands, mapped onto the colourblind-safe chart tokens. The deutan
// pair #cc79a7/#009e73 is only acceptable because the numeric score is always shown beside it.

export interface BitScoreBand {
  /** Inclusive lower bound. */
  min: number;
  label: string;
  color: string;
}

export const BIT_SCORE_BANDS: BitScoreBand[] = [
  { min: 200, label: '≥ 200', color: 'var(--chart-6)' }, // vermillion  (NCBI red)
  { min: 80, label: '80–200', color: 'var(--chart-7)' }, // reddish purple (NCBI magenta)
  { min: 50, label: '50–80', color: 'var(--chart-3)' },  // bluish green (NCBI green)
  { min: 40, label: '40–50', color: 'var(--chart-5)' },  // blue        (NCBI blue)
  { min: 0, label: '< 40', color: 'var(--muted-foreground)' }, // neutral (NCBI black)
];

export function bitScoreBand(bitScore: number): BitScoreBand {
  if (!Number.isFinite(bitScore)) return BIT_SCORE_BANDS[BIT_SCORE_BANDS.length - 1];
  return (
    BIT_SCORE_BANDS.find((band) => bitScore >= band.min) ??
    BIT_SCORE_BANDS[BIT_SCORE_BANDS.length - 1]
  );
}

export type ColumnClass = 'identity' | 'positive' | 'mismatch' | 'gap';

export function classifyColumn(
  queryResidue: string,
  targetResidue: string,
  midlineChar: string
): ColumnClass {
  if (queryResidue === '-' || targetResidue === '-') return 'gap';
  if (midlineChar === '+') return 'positive';
  if (midlineChar === ' ' || midlineChar === '') return 'mismatch';
  return 'identity';
}

export interface ColumnRun {
  className: ColumnClass;
  /** Also a stable React key. */
  start: number;
  length: number;
}

// Runs describe columns; the caller slices query, midline and target by the same offsets.
export function toColumnRuns(
  queryLine: string,
  targetLine: string,
  midline: string
): ColumnRun[] {
  const runs: ColumnRun[] = [];

  for (let i = 0; i < queryLine.length; i++) {
    const className = classifyColumn(queryLine[i], targetLine[i] ?? '-', midline[i] ?? ' ');
    const last = runs[runs.length - 1];
    if (last && last.className === className) {
      last.length += 1;
    } else {
      runs.push({ className, start: i, length: 1 });
    }
  }

  return runs;
}
