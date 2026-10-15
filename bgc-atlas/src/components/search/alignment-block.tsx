"use client";

import { useMemo } from 'react';

import { formatAlignment } from '@/lib/seqsearch/alignment';
import { toColumnRuns, type ColumnClass } from '@/lib/seqsearch/result-colors';
import type { SequenceSearchHit } from '@/lib/hooks/use-sequence-search';

// Background washes keep the residues legible; identity is left unpainted so breaks stand out. Sky blue vs
// vermillion (Okabe-Ito) because two warm washes were indistinguishable (ΔE 3.2). Gaps get no wash.
const COLUMN_TINT: Record<ColumnClass, string> = {
  identity: 'transparent',
  positive: 'color-mix(in oklch, var(--chart-2) 55%, transparent)',
  mismatch: 'color-mix(in oklch, var(--chart-6) 55%, transparent)',
  gap: 'transparent',
};

const COLUMN_LABEL: Record<ColumnClass, string> = {
  identity: 'identical',
  positive: 'conservative substitution',
  mismatch: 'mismatch',
  gap: 'gap',
};

function TintedLine({ text, runs }: { text: string; runs: ReturnType<typeof toColumnRuns> }) {
  return (
    <>
      {runs.map((run) => {
        const slice = text.slice(run.start, run.start + run.length);
        if (run.className === 'identity' || run.className === 'gap') {
          return <span key={run.start}>{slice}</span>;
        }
        return (
          <span
            key={run.start}
            style={{ background: COLUMN_TINT[run.className] }}
            title={COLUMN_LABEL[run.className]}
          >
            {slice}
          </span>
        );
      })}
    </>
  );
}

interface AlignmentBlockProps {
  hit: SequenceSearchHit;
  isNucleotideQuery: boolean;
}

function pad(value: number, width: number) {
  return String(value).padStart(width, ' ');
}

/** NCBI-style pairwise block: a stat header, then wrapped Query / midline / Sbjct triplets. */
export function AlignmentBlock({ hit, isNucleotideQuery }: AlignmentBlockProps) {
  const alignment = useMemo(
    () =>
      formatAlignment({
        queryAligned: hit.queryAligned ?? '',
        targetAligned: hit.targetAligned ?? '',
        queryStart: hit.queryStart,
        queryEnd: hit.queryEnd,
        targetStart: hit.targetStart,
        isNucleotideQuery,
      }),
    [hit, isNucleotideQuery]
  );

  if (!alignment) {
    return (
      <p className="py-2 text-xs text-muted-foreground">
        No pairwise alignment stored for this hit. Searches run before alignments were
        captured, and gapped hits from before the traceback was recorded, need re-running
        to display one.
      </p>
    );
  }

  const { lines, length, identities, positives, gaps, identityPct, positivesPct, gapsPct } =
    alignment;

  // Widest coordinate across both sequences, so the two gutters share a width.
  const gutter = Math.max(
    ...lines.flatMap((line) => [
      String(line.queryStart).length,
      String(line.queryEnd).length,
      String(line.targetStart).length,
      String(line.targetEnd).length,
    ])
  );

  return (
    <div className="space-y-3 py-2">
      <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-muted-foreground">
        <span>
          Score = <span className="font-medium text-foreground">{hit.bitScore.toFixed(1)}</span> bits
        </span>
        <span>
          Expect ={' '}
          <span className="font-medium text-foreground">{hit.eValue.toExponential(2)}</span>
        </span>
        <span>
          Identities ={' '}
          <span className="font-medium text-foreground">
            {identities}/{length}
          </span>{' '}
          ({identityPct.toFixed(0)}%)
        </span>
        <span>
          Positives ={' '}
          <span className="font-medium text-foreground">
            {positives}/{length}
          </span>{' '}
          ({positivesPct.toFixed(0)}%)
        </span>
        <span>
          Gaps ={' '}
          <span className="font-medium text-foreground">
            {gaps}/{length}
          </span>{' '}
          ({gapsPct.toFixed(0)}%)
        </span>
      </div>

      <pre className="overflow-x-auto rounded border border-border bg-muted/30 p-3 font-mono text-[11.5px] leading-[1.45]">
        {lines.map((line, index) => {
          const runs = toColumnRuns(line.queryLine, line.targetLine, line.midline);
          return (
            <div key={index} className={index ? 'mt-3' : undefined}>
              <div>
                <span className="text-muted-foreground">Query  </span>
                {pad(line.queryStart, gutter)}
                {'  '}
                <span className="text-foreground">
                  <TintedLine text={line.queryLine} runs={runs} />
                </span>
                {'  '}
                <span className="text-muted-foreground">{line.queryEnd}</span>
              </div>
              <div className="text-muted-foreground">
                {/* Indent past "Query  " + gutter + two spaces so the midline sits under the residues. */}
                {' '.repeat(7 + gutter + 2)}
                {line.midline}
              </div>
              <div>
                <span className="text-muted-foreground">Sbjct  </span>
                {pad(line.targetStart, gutter)}
                {'  '}
                <span className="text-foreground">
                  <TintedLine text={line.targetLine} runs={runs} />
                </span>
                {'  '}
                <span className="text-muted-foreground">{line.targetEnd}</span>
              </div>
            </div>
          );
        })}
      </pre>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
        {(['positive', 'mismatch'] as const).map((cls) => (
          <span key={cls} className="inline-flex items-center gap-1.5">
            <span
              className="inline-block size-2.5 rounded-[2px] border border-border"
              style={{ background: COLUMN_TINT[cls] }}
              aria-hidden
            />
            {COLUMN_LABEL[cls]}
          </span>
        ))}
        <span className="text-muted-foreground/70">
          identities and gaps are left unshaded
        </span>
      </div>

      {isNucleotideQuery && (
        <p className="text-[11px] text-muted-foreground">
          Query coordinates are nucleotides on the submitted sequence; the aligned residues are
          its translation
          {hit.queryEnd < hit.queryStart ? ' on the minus strand' : ''}.
        </p>
      )}
    </div>
  );
}
