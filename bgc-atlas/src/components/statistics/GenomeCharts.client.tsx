'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

import { apiFetch } from '@/lib/basePath';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ChartSkeleton } from '@/components/ui/chart-skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { getTaxonomyColor } from '@/lib/utils/chart-utils';
import { Sunburst, type SunburstRow } from '@/components/charts/sunburst.client';
import { HorizontalBarChart, type HorizontalBarDatum } from '@/components/charts/horizontal-bar-chart';

interface GenomeTaxonomyRow {
  domain: string | null;
  phylum: string | null;
  class: string | null;
  order_name: string | null;
  family: string | null;
  bgc_count: number;
  genome_count: number;
}

// The rings start at phylum. A domain ring was nearly all "Bacteria" and took
// the innermost, widest ring to say so; the domain is in the tooltip instead.
const RANKS: (keyof GenomeTaxonomyRow)[] = ['phylum', 'class', 'order_name', 'family'];

// Slices under 0.5% of the circle fold into one "Other (N)" arc per parent:
// hundreds of hairline phyla and classes otherwise drew a rainbow smear.
const SUNBURST_MIN_SHARE = 0.005;

const PER_GENOME_RANKS = [
  { value: 'phylum', label: 'Phylum', field: 'phylum' as const },
  { value: 'class', label: 'Class', field: 'class' as const },
  { value: 'order', label: 'Order', field: 'order_name' as const },
  { value: 'family', label: 'Family', field: 'family' as const },
];
type PerGenomeRank = (typeof PER_GENOME_RANKS)[number]['value'];

// Drop taxa with too few genomes so a handful of BGC-rich singletons don't
// dominate the "BGCs per genome" ranking.
const MIN_GENOMES = 10;
const TOP_N = 20;

const stripRank = (raw: string | null | undefined): string =>
  raw ? String(raw).replace(/^[dpcofgs]__/, '').trim() : '';

// Strips GTDB `x__` prefixes and stops at the first gap; rows with no classified
// phylum become a single "Unknown" segment.
function lineageSegments(row: GenomeTaxonomyRow): string[] {
  // Archaea keep a domain arc of their own: their phyla are few and small, and
  // among ~180 bacterial phyla they would mostly fold into "Other".
  const archaeal = stripRank(row.domain) === 'Archaea';
  const segments: string[] = archaeal ? ['Archaea'] : [];
  for (const rank of archaeal ? RANKS.slice(0, -1) : RANKS) {
    const raw = row[rank] as string | null;
    const clean = raw ? String(raw).replace(/^[dpcofgs]__/, '').trim() : '';
    if (!clean) break;
    segments.push(clean);
  }
  return segments.length > 0 ? segments : ['Unknown'];
}

/** Domain shown before the path in the tooltip; the Archaea arc already names its own. */
const domainContext = (row: GenomeTaxonomyRow): string | undefined => {
  const domain = stripRank(row.domain);
  return domain && domain !== 'Archaea' ? domain : undefined;
};

interface PerGenomeBar {
  name: string;
  phylum: string;
  bgcs: number;
  genomes: number;
  ratio: number;
}

// Weighted BGCs per genome (total BGCs / total genomes). Summing genome_count up a
// rank is safe: each genome lives in exactly one lineage.
function perGenomeBars(rows: GenomeTaxonomyRow[], rank: PerGenomeRank): PerGenomeBar[] {
  const field = PER_GENOME_RANKS.find((r) => r.value === rank)!.field;
  const agg = new Map<string, { bgcs: number; genomes: number; phylum: string }>();
  for (const row of rows) {
    const name = stripRank(row[field] as string | null);
    if (!name) continue;
    const entry = agg.get(name) ?? { bgcs: 0, genomes: 0, phylum: stripRank(row.phylum) };
    entry.bgcs += row.bgc_count;
    entry.genomes += row.genome_count;
    agg.set(name, entry);
  }
  return [...agg.entries()]
    .map(([name, { bgcs, genomes, phylum }]) => ({ name, phylum, bgcs, genomes, ratio: genomes > 0 ? bgcs / genomes : 0 }))
    .filter((d) => d.genomes >= MIN_GENOMES)
    .sort((a, b) => b.ratio - a.ratio)
    .slice(0, TOP_N);
}

// Coloured by phylum at every rank, from the shared palette, so the bars agree with
// the sunbursts on the same card.
const toPerGenomeBars = (bars: PerGenomeBar[]): HorizontalBarDatum[] =>
  bars.map((b) => ({
    key: b.name,
    label: b.name,
    title: b.phylum && b.phylum !== b.name ? `${b.name} — ${b.phylum}` : b.name,
    value: b.ratio,
    color: getTaxonomyColor(b.phylum),
    details: [
      `${b.ratio.toFixed(1)} BGCs per genome`,
      `${b.bgcs.toLocaleString()} BGCs across ${b.genomes.toLocaleString()} genomes`,
    ],
  }));

export function GenomeCharts() {
  const [rows, setRows] = useState<GenomeTaxonomyRow[] | null>(null);
  const [error, setError] = useState(false);
  const [bgcMode, setBgcMode] = useState<'total' | 'perGenome'>('total');
  const [perGenomeRank, setPerGenomeRank] = useState<PerGenomeRank>('phylum');
  const genomeContainerRef = useRef<HTMLDivElement | null>(null);
  const bgcContainerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    apiFetch('/api/statistics/genomes/taxonomy-hierarchy')
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`))))
      .then((payload) => {
        if (cancelled) return;
        setRows(Array.isArray(payload?.data?.hierarchy) ? payload.data.hierarchy : []);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const genomeRows = useMemo<SunburstRow[]>(
    () => (rows ?? []).map((r) => ({ segments: lineageSegments(r), value: r.genome_count, context: domainContext(r) })),
    [rows],
  );
  const bgcRows = useMemo<SunburstRow[]>(
    () => (rows ?? []).map((r) => ({ segments: lineageSegments(r), value: r.bgc_count, context: domainContext(r) })),
    [rows],
  );
  const bars = useMemo(() => toPerGenomeBars(perGenomeBars(rows ?? [], perGenomeRank)), [rows, perGenomeRank]);

  if (error) {
    return <p className="py-8 text-center text-sm text-muted-foreground">Unable to load taxonomy distribution.</p>;
  }

  if (rows === null) {
    return (
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Genome Distribution</CardTitle></CardHeader>
          <CardContent><ChartSkeleton height={400} /></CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>BGC Yield</CardTitle></CardHeader>
          <CardContent><ChartSkeleton height={400} /></CardContent>
        </Card>
      </div>
    );
  }

  return (
    // The cards stretch to one height, so the Per genome bar card ends where
    // the sunburst beside it does.
    <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
      <Card>
        {/* min-h-9 matches the BGC Yield header, whose toggle is 36px, so the two sunbursts sit level. */}
        <CardHeader className="flex min-h-9 items-center">
          <CardTitle className="whitespace-nowrap">Genome Distribution</CardTitle>
        </CardHeader>
        <CardContent>
          {genomeRows.length > 0 ? (
            <Sunburst
              rows={genomeRows}
              colorOf={getTaxonomyColor}
              valueLabel="genomes"
              minShare={SUNBURST_MIN_SHARE}
              rootLabel="All taxa"
              containerRef={genomeContainerRef}
            />
          ) : (
            <p className="py-8 text-center text-sm text-muted-foreground">No taxonomy data.</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex min-h-9 flex-row flex-wrap items-center justify-between gap-2 space-y-0">
          <CardTitle className="whitespace-nowrap">BGC Yield</CardTitle>
          <div className="flex items-center gap-2">
            {bgcMode === 'perGenome' && (
              <Select value={perGenomeRank} onValueChange={(v) => setPerGenomeRank(v as PerGenomeRank)}>
                <SelectTrigger className="h-7 w-auto min-w-24 text-xs px-2">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PER_GENOME_RANKS.map((r) => (
                    <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <div className="inline-flex rounded-md border bg-background p-0.5">
              <Button
                type="button"
                size="sm"
                variant={bgcMode === 'total' ? 'secondary' : 'ghost'}
                className="h-7 px-3 text-xs"
                aria-pressed={bgcMode === 'total'}
                onClick={() => setBgcMode('total')}
              >
                Total
              </Button>
              <Button
                type="button"
                size="sm"
                variant={bgcMode === 'perGenome' ? 'secondary' : 'ghost'}
                className="h-7 px-3 text-xs"
                aria-pressed={bgcMode === 'perGenome'}
                onClick={() => setBgcMode('perGenome')}
              >
                Per genome
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="flex flex-1 flex-col">
          {bgcMode === 'total' ? (
            bgcRows.length > 0 ? (
              <Sunburst
                rows={bgcRows}
                colorOf={getTaxonomyColor}
                valueLabel="BGCs"
                minShare={SUNBURST_MIN_SHARE}
                rootLabel="All taxa"
                containerRef={bgcContainerRef}
              />
            ) : (
              <p className="py-8 text-center text-sm text-muted-foreground">No taxonomy data.</p>
            )
          ) : (
            <>
              <p className="mb-3 text-xs text-muted-foreground">
                Mean BGCs per genome — top {TOP_N} taxa with ≥ {MIN_GENOMES} genomes.
              </p>
              {bars.length > 0 ? (
                <HorizontalBarChart
                  data={bars}
                  formatValue={(d) => `${d.value.toFixed(1)} / genome`}
                  label="Mean BGCs per genome by taxon"
                  className="flex-1"
                  fill
                />
              ) : (
                <p className="py-8 text-center text-sm text-muted-foreground">No taxa with enough genomes.</p>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
