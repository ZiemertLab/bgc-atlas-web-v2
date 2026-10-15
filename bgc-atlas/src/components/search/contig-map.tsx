"use client";

import { useMemo, useState } from 'react';
import { ChevronDown } from 'lucide-react';

import { GENE_TYPE_COLORS, GENE_TYPE_LABELS } from '@/lib/utils/gene-type-colors';
import { BIT_SCORE_BANDS, bitScoreBand } from '@/lib/seqsearch/result-colors';
import type { GeneKind } from '@/lib/seqsearch/genbank';
import type { ContigHit, ContigLocus, ContigMapData, QueryGene } from '@/lib/hooks/use-contig-map';

interface ContigViewProps {
  data: ContigMapData;
  onSelectLocus?: (locus: ContigLocus | null) => void;
  selectedLocus?: ContigLocus | null;
}

interface ContigMapProps extends ContigViewProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  groups: number;
  onGroupsChange: (groups: number) => void;
}

// Matches MAX_STACK_GROUPS in the contig-map route; 100 measured at ~1.8 s cold.
export const STACK_GROUP_OPTIONS = [30, 50, 100] as const;
export const DEFAULT_STACK_GROUPS = 30;

// Match strength as opacity, since colour is spent on gene function.
function matchOpacity(bestBitScore: number, matched: boolean): number {
  if (!matched) return 0.25;
  if (bestBitScore >= 200) return 1;
  if (bestBitScore >= 80) return 0.75;
  if (bestBitScore >= 50) return 0.55;
  if (bestBitScore >= 40) return 0.42;
  return 0.32;
}

const GENE_KIND_ORDER: GeneKind[] = [
  'biosynthetic',
  'biosynthetic-additional',
  'regulatory',
  'transport',
  'resistance',
  'other',
];

const MATCH_OPACITY_LEGEND = [
  { label: '≥ 200', opacity: 1 },
  { label: '80–200', opacity: 0.75 },
  { label: '50–80', opacity: 0.55 },
  { label: '40–50', opacity: 0.42 },
  { label: '< 40', opacity: 0.32 },
  { label: 'no hits', opacity: 0.25 },
];

const WIDTH = 1000;
const MARGIN = { left: 8, right: 8 };
const TRACK_Y = 34;
const TRACK_H = 22;
const ARROW = 7;
const STACK_Y = 96;
const STACK_ROW = 5;
const STACK_GAP = 2;
// Defensive ceiling only; must not be below the largest STACK_GROUP_OPTIONS value.
const MAX_STACK_ROWS = 100;

function tickStep(length: number) {
  const raw = length / 6;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  return [1, 2, 5, 10].map((m) => m * magnitude).find((s) => s >= raw) ?? magnitude * 10;
}

const formatBp = (v: number) => (v >= 1000 ? `${(v / 1000).toFixed(v % 1000 === 0 ? 0 : 1)}k` : String(v));

// Above this many contigs (up to 100 per submission), show a selector instead of stacking.
const MAX_STACKED_CONTIGS = 3;

export function ContigMap({
  data,
  onSelectLocus,
  selectedLocus,
  open,
  onOpenChange,
  groups,
  onGroupsChange,
}: ContigMapProps) {
  const contigs = data.queries;
  const [selected, setSelected] = useState<string | null>(null);

  if (!contigs.length) return null;

  const genes = data.queryGenes?.length ?? 0;
  const summary = [
    contigs.length > 1
      ? `${contigs.length} contigs`
      : contigs[0].queryId ?? 'query',
    genes ? `${genes} gene${genes === 1 ? '' : 's'}` : `${data.loci.length} loci`,
  ].join(' · ');

  const body = contigs.length <= MAX_STACKED_CONTIGS
    ? (
      <div className="space-y-4">
        {contigs.map((contig) => (
          <ContigTrack
            key={contig.queryId ?? 'query'}
            data={data}
            contig={contig}
            onSelectLocus={onSelectLocus}
            selectedLocus={selectedLocus}
            hideHeading={contigs.length === 1}
          />
        ))}
      </div>
    )
    : <ContigSelector
        data={data}
        contigs={contigs}
        selected={selected}
        setSelected={setSelected}
        onSelectLocus={onSelectLocus}
        selectedLocus={selectedLocus}
      />;

  return (
    <div className="rounded-sm border border-border bg-card">
      <div className="flex items-center justify-between gap-3 px-3 py-2">
        <button
          type="button"
          onClick={() => onOpenChange(!open)}
          aria-expanded={open}
          className="flex min-w-0 flex-1 items-baseline gap-2 text-left"
        >
          <ChevronDown
            className={`size-4 shrink-0 self-center text-muted-foreground transition-transform duration-200${open ? '' : ' -rotate-90'}`}
            aria-hidden
          />
          <span className="text-sm font-semibold tracking-tight">
            {data.queryGenes?.length ? 'Query gene map' : 'Contig map'}
          </span>
          <span className="truncate font-mono text-xs font-normal text-muted-foreground">
            {summary}
          </span>
        </button>
        {open && (
          <label className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
            <span className="hidden sm:inline">Stack</span>
            <select
              value={groups}
              onChange={(e) => onGroupsChange(Number(e.target.value))}
              // Outside the disclosure button, so choosing a depth does not collapse the panel.
              className="rounded border border-border bg-background px-1.5 py-0.5 text-xs"
              aria-label="Number of BGCs drawn in the stack"
            >
              {STACK_GROUP_OPTIONS.map((n) => (
                <option key={n} value={n}>
                  Top {n} BGCs
                </option>
              ))}
            </select>
          </label>
        )}
        {selectedLocus && (
          <button
            type="button"
            onClick={() => onSelectLocus?.(null)}
            className="shrink-0 text-xs text-brand hover:underline"
          >
            Clear locus filter
          </button>
        )}
      </div>
      {open && <div className="border-t border-border p-3">{body}</div>}
    </div>
  );
}

function ContigSelector({
  data,
  contigs,
  selected,
  setSelected,
  onSelectLocus,
  selectedLocus,
}: ContigViewProps & {
  contigs: ContigMapData['queries'];
  selected: string | null;
  setSelected: (v: string) => void;
}) {
  const active = contigs.find((c) => (c.queryId ?? '') === selected) ?? contigs[0];
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="mr-1 text-[11px] uppercase tracking-wide text-muted-foreground">
          Contig
        </span>
        {contigs.map((contig) => {
          const key = contig.queryId ?? '';
          const isActive = contig === active;
          return (
            <button
              key={key || 'query'}
              type="button"
              onClick={() => setSelected(key)}
              className={
                isActive
                  ? 'border border-foreground bg-foreground px-2 py-0.5 text-[11px] text-background'
                  : 'border border-border bg-card px-2 py-0.5 text-[11px] text-muted-foreground hover:text-foreground'
              }
            >
              <span className="font-mono">{contig.queryId ?? 'query'}</span>
              <span className="ml-1.5 tabular-nums opacity-70">{contig.hits.toLocaleString()}</span>
            </button>
          );
        })}
      </div>
      <ContigTrack
        data={data}
        contig={active}
        onSelectLocus={onSelectLocus}
        selectedLocus={selectedLocus}
        hideHeading
      />
    </div>
  );
}

function ContigTrack({
  data,
  contig: query,
  onSelectLocus,
  selectedLocus,
  hideHeading,
}: ContigViewProps & { contig: ContigMapData['queries'][number]; hideHeading?: boolean }) {
  const [hovered, setHovered] = useState<{ x: number; y: number; text: string } | null>(null);

  const length = query?.length ?? 0;
  // Coordinates from another contig would be plotted against the wrong axis.
  const contigKey = query?.queryId ?? null;
  const loci = useMemo(
    () => data.loci.filter((l) => l.contig === contigKey),
    [data.loci, contigKey]
  );
  const contigHits = useMemo(
    () => data.hits.filter((h) => h.contig === contigKey),
    [data.hits, contigKey]
  );

  const scale = useMemo(() => {
    const inner = WIDTH - MARGIN.left - MARGIN.right;
    return (bp: number) => MARGIN.left + (length ? (bp / length) * inner : 0);
  }, [length]);

  const ticks = useMemo(() => {
    if (!length) return [];
    const step = tickStep(length);
    const out: number[] = [];
    for (let v = 0; v <= length; v += step) out.push(v);
    return out;
  }, [length]);

  // A blastx search has no annotation, so it falls back to loci merged from hits.
  const queryGenes: QueryGene[] | null = data.queryGenes?.length ? data.queryGenes : null;

  // The API orders by each BGC's best score, so insertion order is rank order.
  const stackRows = useMemo(() => {
    const byGroup = new Map<string, ContigHit[]>();
    for (const hit of contigHits) {
      const row = byGroup.get(hit.groupKey);
      if (row) row.push(hit);
      else byGroup.set(hit.groupKey, [hit]);
    }
    return [...byGroup.values()].slice(0, MAX_STACK_ROWS);
  }, [contigHits]);

  // From stackRows, not raw hits: a gene can match many BGCs none of which are drawn.
  const queriesInStack = useMemo(
    () => new Set(stackRows.flat().map((hit) => hit.queryId).filter(Boolean)),
    [stackRows],
  );

  if (!query || !length || (!loci.length && !data.queryGenes?.length)) return null;

  const totalGroups = data.totalGroups ?? stackRows.length;

  const drawn = queryGenes ?? loci;
  const trackTotal = drawn.length;
  const cappedCount = drawn.filter((d) => d.truncated).length;
  const geneKindsPresent = queryGenes
    ? ([...new Set(queryGenes.map((g) => g.geneKind ?? 'other'))].sort(
        (a, b2) => GENE_KIND_ORDER.indexOf(a) - GENE_KIND_ORDER.indexOf(b2),
      ) as GeneKind[])
    : [];
  const offStackCount = queryGenes
    ? queryGenes.filter((g) => g.hits > 0 && !queriesInStack.has(g.locusTag)).length
    : 0;

  const stackHeight = stackRows.length * (STACK_ROW + STACK_GAP);
  const height = STACK_Y + stackHeight + 24;

  const show = (e: React.MouseEvent, text: string) =>
    setHovered({ x: e.clientX, y: e.clientY, text });

  return (
    <div className="space-y-2">
      <div
        className={
          hideHeading
            ? 'hidden'
            : 'flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1'
        }
      >
        <h3 className="text-sm font-semibold">
          {queryGenes ? 'Query gene map' : 'Contig map'}
          <span className="ml-2 font-mono text-xs font-normal text-muted-foreground">
            {query.queryId ?? 'query'} · {length.toLocaleString()} nt
          </span>
        </h3>
      </div>

      <div className="overflow-x-auto">
        <svg
          viewBox={`0 0 ${WIDTH} ${height}`}
          className="w-full"
          style={{ minWidth: 640 }}
          role="img"
          aria-label={
            queryGenes
              ? `Contig map: ${queryGenes.length} annotated genes across ${length} nucleotides`
              : `Contig map: ${loci.length} loci across ${length} nucleotides`
          }
        >
          <line x1={MARGIN.left} y1={22} x2={WIDTH - MARGIN.right} y2={22} className="stroke-border" strokeWidth={1} />
          {ticks.map((t) => (
            <g key={t}>
              <line x1={scale(t)} y1={16} x2={scale(t)} y2={22} className="stroke-border" strokeWidth={1} />
              <text x={scale(t)} y={11} textAnchor="middle" className="fill-muted-foreground" fontSize={9}>
                {formatBp(t)}
              </text>
            </g>
          ))}

          {queryGenes?.map((gene) => {
            const x0 = scale(gene.start);
            const w = Math.max(scale(gene.end) - x0, 3);
            const tip = Math.min(ARROW, w);
            const y = TRACK_Y;
            const mid = y + TRACK_H / 2;
            const points =
              gene.strand === '+'
                ? `${x0},${y} ${x0 + w - tip},${y} ${x0 + w},${mid} ${x0 + w - tip},${y + TRACK_H} ${x0},${y + TRACK_H}`
                : `${x0 + w},${y} ${x0 + tip},${y} ${x0},${mid} ${x0 + tip},${y + TRACK_H} ${x0 + w},${y + TRACK_H}`;
            const matched = gene.hits > 0;
            const offStack = matched && !queriesInStack.has(gene.locusTag);
            return (
              <g
                key={gene.locusTag}
                onMouseMove={(e) =>
                  show(
                    e,
                    `${gene.locusTag} · ${gene.start.toLocaleString()}–${gene.end.toLocaleString()} (${gene.strand})` +
                      (gene.product ? ` · ${gene.product}` : '') +
                      (gene.isCore ? ' · core biosynthetic gene' : '') +
                      ' · ' +
                      (matched
                        ? `${gene.truncated ? 'at least ' : ''}${gene.bgcs.toLocaleString()} BGCs · ` +
                          `best ${gene.bestBitScore.toFixed(0)} bits` +
                          (offStack ? ` · none among the ${stackRows.length} BGCs shown below` : '')
                        : 'no hits')
                  )
                }
                onMouseLeave={() => setHovered(null)}
              >
                {/* White backing so a faded arrow does not pick up what is behind it. */}
                <polygon points={points} fill="#ffffff" stroke="none" />
                <polygon
                  points={points}
                  fill={GENE_TYPE_COLORS[gene.geneKind ?? 'other']}
                  fillOpacity={matchOpacity(gene.bestBitScore, matched)}
                  className={gene.isCore ? 'stroke-foreground' : 'stroke-border'}
                  strokeWidth={gene.isCore ? 1.75 : 0.75}
                />
                {offStack && (
                  <line
                    x1={x0}
                    x2={x0 + w}
                    y1={TRACK_Y + TRACK_H + 3.5}
                    y2={TRACK_Y + TRACK_H + 3.5}
                    className="stroke-muted-foreground"
                    strokeWidth={1.5}
                    strokeDasharray="2 2"
                  />
                )}
                {w > 34 && (
                  <text
                    x={x0 + w / 2}
                    y={TRACK_Y + TRACK_H + 13}
                    textAnchor="middle"
                    className="fill-foreground"
                    fontSize={9}
                  >
                    {gene.locusTag.replace(/^ctg\d+_/, '')}
                  </text>
                )}
                {w > 34 && matched && (
                  <text
                    x={x0 + w / 2}
                    y={TRACK_Y + TRACK_H + 24}
                    textAnchor="middle"
                    className="fill-muted-foreground"
                    fontSize={8.5}
                  >
                    {gene.truncated ? '\u2265 ' : ''}
                    {gene.bgcs}
                  </text>
                )}
              </g>
            );
          })}

          {!queryGenes && loci.map((locus) => {
            const x0 = scale(locus.start);
            const x1 = scale(locus.end);
            const w = Math.max(x1 - x0, 3);
            const tip = Math.min(ARROW, w);
            const y = TRACK_Y;
            const mid = y + TRACK_H / 2;
            const points =
              locus.strand === '+'
                ? `${x0},${y} ${x0 + w - tip},${y} ${x0 + w},${mid} ${x0 + w - tip},${y + TRACK_H} ${x0},${y + TRACK_H}`
                : `${x0 + w},${y} ${x0 + tip},${y} ${x0},${mid} ${x0 + tip},${y + TRACK_H} ${x0 + w},${y + TRACK_H}`;
            const isSelected =
              selectedLocus?.start === locus.start && selectedLocus?.end === locus.end;
            return (
              <g
                key={`${locus.strand}-${locus.start}-${locus.end}`}
                className="cursor-pointer"
                onClick={() => onSelectLocus?.(isSelected ? null : locus)}
                onMouseMove={(e) =>
                  show(
                    e,
                    `${locus.start.toLocaleString()}–${locus.end.toLocaleString()} (${locus.strand}) · ` +
                      `${locus.truncated ? 'at least ' : ''}${locus.bgcs.toLocaleString()} BGCs · ` +
                      `${locus.avgIdentity.toFixed(1)}% mean identity · ` +
                      `best ${locus.bestBitScore.toFixed(0)} bits`
                  )
                }
                onMouseLeave={() => setHovered(null)}
              >
                <polygon
                  points={points}
                  fill={bitScoreBand(locus.bestBitScore).color}
                  className={isSelected ? 'stroke-foreground' : 'stroke-transparent'}
                  strokeWidth={1.5}
                  opacity={selectedLocus && !isSelected ? 0.45 : 1}
                />
                <text
                  x={x0 + w / 2}
                  y={TRACK_Y + TRACK_H + 13}
                  textAnchor="middle"
                  className="fill-foreground"
                  fontSize={10}
                >
                  {locus.truncated ? '\u2265 ' : ''}
                  {locus.bgcs.toLocaleString()} BGC{locus.bgcs === 1 ? '' : 's'}
                </text>
                <text
                  x={x0 + w / 2}
                  y={TRACK_Y + TRACK_H + 25}
                  textAnchor="middle"
                  className="fill-muted-foreground"
                  fontSize={9}
                >
                  {locus.avgIdentity.toFixed(0)}% id
                </text>
              </g>
            );
          })}

          {stackRows.map((row, rowIndex) => {
            const y = STACK_Y + rowIndex * (STACK_ROW + STACK_GAP);
            const label = row[0].bgcFilename ?? row[0].groupKey;
            return (
              <g key={row[0].groupKey}>
                <line
                  x1={scale(Math.min(...row.map((h) => h.start)))}
                  y1={y + STACK_ROW / 2}
                  x2={scale(Math.max(...row.map((h) => h.end)))}
                  y2={y + STACK_ROW / 2}
                  className="stroke-border"
                  strokeWidth={1}
                />
                {row.map((hit) => {
                  const x0 = scale(hit.start);
                  const w = Math.max(scale(hit.end) - x0, 1.5);
                  return (
                    <rect
                      key={`${hit.cdsLabel}-${hit.start}-${hit.end}`}
                      x={x0}
                      y={y}
                      width={w}
                      height={STACK_ROW}
                      rx={1}
                      fill={bitScoreBand(hit.bitScore).color}
                      opacity={0.9}
                      onMouseMove={(e) =>
                        show(
                          e,
                          `${label} · ${hit.cdsLabel} · ` +
                            `${hit.start.toLocaleString()}–${hit.end.toLocaleString()} (${hit.strand}) · ` +
                            `${hit.identity.toFixed(1)}% id · ${hit.bitScore.toFixed(0)} bits` +
                            (row.length > 1 ? ` · ${row.length} CDS hits from this BGC` : '')
                        )
                      }
                      onMouseLeave={() => setHovered(null)}
                    />
                  );
                })}
              </g>
            );
          })}
        </svg>
      </div>

      {queryGenes && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
          <span className="uppercase tracking-wide">Gene</span>
          {geneKindsPresent.map((kind) => (
            <span key={kind} className="inline-flex items-center gap-1.5">
              <span
                className="inline-block size-2.5 rounded-[2px]"
                style={{ background: GENE_TYPE_COLORS[kind] }}
                aria-hidden
              />
              {GENE_TYPE_LABELS[kind]}
            </span>
          ))}
          <span className="inline-flex items-center gap-1.5">
            <span
              className="inline-block size-2.5 rounded-[2px] border-[1.5px] border-foreground bg-muted"
              aria-hidden
            />
            core biosynthetic gene
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="mr-0.5">shade = best bits</span>
            {MATCH_OPACITY_LEGEND.map((step) => (
              <span key={step.label} className="inline-flex items-center gap-1">
                <span
                  className="inline-block size-2.5 rounded-[2px]"
                  style={{ background: GENE_TYPE_COLORS.biosynthetic, opacity: step.opacity }}
                  aria-hidden
                />
                {step.label}
              </span>
            ))}
          </span>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
        <span className="uppercase tracking-wide">{queryGenes ? 'Hit bit score' : 'Bit score'}</span>
        {BIT_SCORE_BANDS.map((band) => (
          <span key={band.label} className="inline-flex items-center gap-1.5">
            <span className="inline-block size-2.5 rounded-[2px]" style={{ background: band.color }} aria-hidden />
            {band.label}
          </span>
        ))}
        {offStackCount > 0 && (
          <span className="inline-flex items-center gap-1.5">
            <svg width="14" height="4" aria-hidden className="shrink-0">
              <line
                x1={0}
                x2={14}
                y1={2}
                y2={2}
                className="stroke-muted-foreground"
                strokeWidth={1.5}
                strokeDasharray="2 2"
              />
            </svg>
            {offStackCount} {offStackCount === 1 ? 'gene matches' : 'genes match'} BGCs outside the
            rows shown
          </span>
        )}
        <span className="ml-auto">
          {/* Not "N of M": the row count is this contig's, the total the whole search's. */}
          one row per BGC · {stackRows.length.toLocaleString()} shown by best bit score ·{' '}
          {totalGroups.toLocaleString()} BGCs across the search
          {cappedCount > 0 && (
            <>
              {' · '}
              {cappedCount === trackTotal
                ? 'every depth is a lower bound (≥) — each hit the result cap'
                : `${cappedCount} of ${trackTotal} depths are lower bounds (≥) — those queries hit the result cap`}
            </>
          )}
        </span>
      </div>

      {hovered && (
        <div
          className="pointer-events-none fixed z-[1400] max-w-sm rounded border border-border bg-popover px-2 py-1 text-[11px] text-popover-foreground shadow-md"
          style={{ left: hovered.x + 12, top: hovered.y + 12 }}
        >
          {hovered.text}
        </div>
      )}
    </div>
  );
}
