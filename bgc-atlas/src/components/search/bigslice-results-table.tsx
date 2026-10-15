"use client";

import { apiFetch, withBase } from "@/lib/basePath";
import Link from 'next/link';
import { useMemo, useState, useEffect } from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Download, Layers, Terminal } from 'lucide-react';
import { CollapsibleSection } from '@/components/ui/collapsible-section';
import { FragmentedBadge } from '@/components/ui/fragmented-badge';
import { InfoTooltip } from '@/components/ui/info-tooltip';
import { ResizableTable } from '@/components/ui/resizable-table';
import type { TableColumn } from '@/components/ui/resizable-table/types';
import { ProductCategoryChart } from '@/components/ui/product-category-chart';
import { BiomeDistributionChart } from '@/components/ui/biome-distribution-chart';
import { TaxonomyDistributionChart } from '@/components/ui/taxonomy-distribution-chart';
import { SampleMapDots } from '@/components/ui/sample-map-dots';
import { useBigsliceMapSamples } from '@/lib/hooks/use-bigslice-map-samples';
import { formatBgcLength } from '@/lib/utils/bgc-length';

/** Mirrors the hydrated gcf_browse document the results API attaches to each row. */
interface HydratedGcf {
  memberBgcCount?: number;
  assemblyCount?: number;
  productCategoryDistribution?: Record<string, number>;
  productTypeDistribution?: Record<string, number>;
  biomeDistributionByLevel?: Record<number, Record<string, number>>;
  taxonomyDistribution?: Record<string, number>;
  taxonomyDistributionByRank?: Record<string, Record<string, number>>;
  lengthStats?: Parameters<typeof formatBgcLength>[0];
}

interface BigSliceResult {
  resultId: string;
  origFilename: string;
  bigsliceGcfId: number | null;
  tier: 'seed' | 'fragmented';
  distance: number;
  rank: number;
  gcfId: string | null;
  gcfName: string | null;
  petName: string | null;
  nBgc: number | null;
  domCategory: string | null;
  isMember: boolean;
  gcf: HydratedGcf | null;
}

interface BigSliceSession {
  sessionId: string;
  status: string;
  totalMatches: number;
  searchDurationMs: number | null;
  parameters: { distanceThreshold: number; numFiles: number };
}

interface BigSliceResultsTableProps {
  sessionId: string;
}

/** The cutoff both v3 models were built at; every verdict on this page is relative to it. */
const THRESHOLD = 0.4;

/** Rank-0 distances reach 1.101, so the axis must extend past 1.0. */
const DISTANCE_AXIS_MAX = 1.2;

const AUTO_OPEN_UP_TO = 3;

interface FileGroup {
  filename: string;
  hits: BigSliceResult[];
  winner: BigSliceResult | null;
  nearest: BigSliceResult | null;
  cascaded: boolean;
}

function groupByFile(results: BigSliceResult[]): FileGroup[] {
  const byFile = new Map<string, BigSliceResult[]>();
  for (const hit of results) {
    const hits = byFile.get(hit.origFilename);
    if (hits) hits.push(hit);
    else byFile.set(hit.origFilename, [hit]);
  }

  const byDistance = (a: BigSliceResult, b: BigSliceResult) => a.distance - b.distance;
  return Array.from(byFile.entries()).map(([filename, hits]) => {
    const members = hits.filter((hit) => hit.isMember);
    return {
      filename,
      hits,
      winner: members.length > 0 ? [...members].sort(byDistance)[0] : null,
      nearest: hits.length > 0 ? [...hits].sort(byDistance)[0] : null,
      // The fragmented model runs only for files the main families could not place.
      cascaded: hits.some((hit) => hit.tier === 'fragmented'),
    };
  });
}

// Phylum, as /gcfs defaults to; at domain nearly every family is 100% d__Bacteria.
function taxonomyForDisplay(gcf: HydratedGcf | null): Record<string, number> | undefined {
  const byRank = gcf?.taxonomyDistributionByRank;
  const phylum = byRank?.phylum;
  if (phylum && Object.keys(phylum).length > 0) return phylum;
  return gcf?.taxonomyDistribution;
}

function familyLabel(hit: BigSliceResult): string {
  return hit.gcfName ?? `GCF ${hit.bigsliceGcfId ?? '?'}`;
}

// Pools the matched families' distributions weighted by member BGC count, on the 0-100 scale.
// Distributions sum to 100 per family, so multi-category BGCs are apportioned, not double-counted.
function shareByBgcs(
  gcfs: HydratedGcf[],
  pick: (gcf: HydratedGcf) => Record<string, number> | undefined,
): Record<string, number> {
  const totals = new Map<string, number>();
  let grandTotal = 0;

  for (const gcf of gcfs) {
    const members = gcf.memberBgcCount ?? 0;
    const distribution = pick(gcf);
    if (members <= 0 || !distribution) continue;
    for (const [label, pct] of Object.entries(distribution)) {
      const bgcs = (pct / 100) * members;
      totals.set(label, (totals.get(label) ?? 0) + bgcs);
      grandTotal += bgcs;
    }
  }

  if (grandTotal === 0) return {};
  return Object.fromEntries(
    Array.from(totals.entries()).map(([label, bgcs]) => [label, (bgcs / grandTotal) * 100]),
  );
}


// The axis is fixed on every row, so bars are comparable down the column.
function DistanceBar({ distance, isMember }: { distance: number; isMember: boolean }) {
  const width = (Math.min(distance, DISTANCE_AXIS_MAX) / DISTANCE_AXIS_MAX) * 100;
  const thresholdAt = (THRESHOLD / DISTANCE_AXIS_MAX) * 100;

  return (
    <div className="flex w-full items-center gap-2">
      <span
        className={`w-14 shrink-0 text-right font-mono text-[12px] tabular-nums ${
          isMember ? 'font-medium text-foreground' : 'text-muted-foreground'
        }`}
      >
        {distance.toFixed(4)}
      </span>
      <span className="relative h-2 min-w-0 flex-1 rounded-sm bg-muted" aria-hidden>
        <span
          className={`absolute inset-y-0 left-0 rounded-sm ${isMember ? 'bg-primary' : 'bg-muted-foreground/40'}`}
          style={{ width: `${width}%` }}
        />
        <span
          className="absolute inset-y-[-2px] w-px bg-foreground/50"
          style={{ left: `${thresholdAt}%` }}
        />
      </span>
    </div>
  );
}

export function BigSliceResultsTable({ sessionId }: BigSliceResultsTableProps) {
  const [results, setResults] = useState<BigSliceResult[]>([]);
  const [session, setSession] = useState<BigSliceSession | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [mapOpen, setMapOpen] = useState(false);

  useEffect(() => {
    if (!sessionId) return;

    const fetchResults = async () => {
      setIsLoading(true);
      setError(null);
      try {
        // Up to six rows per file, and the page groups rather than paginates, so fetch the whole job.
        const response = await apiFetch(`/api/search/bigslice/${sessionId}?limit=1000`);
        if (!response.ok) throw new Error('Failed to fetch results');
        const data = await response.json();
        if (!data.success) throw new Error(data.error || 'Failed to fetch results');

        setResults(data.results ?? []);
        setSession(data.session ?? null);
        // Should never fire, but a silent cap would read as the complete candidate list.
        setTruncated(Boolean(data.pagination?.hasMore));
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to fetch results');
      } finally {
        setIsLoading(false);
      }
    };

    void fetchResults();
  }, [sessionId]);

  const groups = useMemo(() => groupByFile(results), [results]);

  // Families the upload belongs to (within the cutoff). The summary charts and map use only these:
  // a hit past 0.4 is merely the nearest family.
  const matchedFamilies = useMemo(() => {
    const byId = new Map<string, HydratedGcf>();
    for (const hit of results) {
      if (hit.isMember && hit.gcfId && hit.gcf) byId.set(hit.gcfId, hit.gcf);
    }
    return Array.from(byId.values());
  }, [results]);

  const summary = useMemo(() => ({
    categories: shareByBgcs(matchedFamilies, (gcf) => gcf.productCategoryDistribution),
    ecosystems: shareByBgcs(matchedFamilies, (gcf) => gcf.biomeDistributionByLevel?.[1]),
    taxonomy: shareByBgcs(matchedFamilies, taxonomyForDisplay),
  }), [matchedFamilies]);

  /** BGCs across the matched families — what the summary bars are a share of. */
  const matchedBgcs = useMemo(
    () => matchedFamilies.reduce((sum, gcf) => sum + (gcf.memberBgcCount ?? 0), 0),
    [matchedFamilies],
  );

  const mapSamples = useBigsliceMapSamples(sessionId, mapOpen);

  const columns = useMemo<TableColumn<BigSliceResult>[]>(() => [
    {
      id: 'family',
      label: 'Family',
      // Fits `GCF-F-763363` plus the Fragmented badge.
      width: 230,
      minWidth: 160,
      sortable: false,
      renderCell: (hit) => (
        <div className="flex min-w-0 flex-col gap-0.5">
          <div className="flex items-center gap-1.5">
            {hit.gcfId ? (
              <Link
                href={`/gcfs/${hit.gcfId}`}
                className="truncate font-mono text-[12.5px] font-medium text-foreground underline decoration-foreground/50 underline-offset-2 hover:decoration-foreground"
              >
                {familyLabel(hit)}
              </Link>
            ) : (
              <span className="truncate font-mono text-[12.5px] text-muted-foreground">
                {familyLabel(hit)}
              </span>
            )}
            {hit.tier === 'fragmented' && <FragmentedBadge />}
          </div>
          {hit.petName ? (
            <span className="truncate text-[11px] text-muted-foreground">{hit.petName}</span>
          ) : (
            // Reference-only families (MIBiG entries with no atlas member) have no gcfs row.
            <span className="text-[11px] text-muted-foreground">no atlas members</span>
          )}
        </div>
      ),
    },
    {
      id: 'distance',
      label: 'Distance',
      width: 175,
      minWidth: 150,
      sortable: false,
      headerTooltip: 'Distance to the family centroid; lower is nearer. The tick marks 0.4, '
        + 'at or below which the BGC counts as a member.',
      renderCell: (hit) => <DistanceBar distance={hit.distance} isMember={hit.isMember} />,
    },
    {
      id: 'rank',
      label: 'Rank',
      width: 55,
      minWidth: 50,
      sortable: false,
      renderCell: (hit) => (
        <span className="font-mono tabular-nums text-[12.5px] text-muted-foreground">
          {hit.rank + 1}
        </span>
      ),
    },
    {
      id: 'members',
      label: 'Members',
      width: 85,
      minWidth: 70,
      sortable: false,
      headerTooltip: 'Atlas BGCs already in this family.',
      renderCell: (hit) => (
        <span className="block text-right font-mono tabular-nums text-[12.5px] text-muted-foreground">
          {hit.nBgc === null ? '—' : hit.nBgc.toLocaleString()}
        </span>
      ),
    },
    {
      id: 'productCategories',
      label: 'Category distribution',
      width: 205,
      minWidth: 140,
      sortable: false,
      renderCell: (hit) => {
        const distribution = hit.gcf?.productCategoryDistribution;
        if (!distribution || Object.keys(distribution).length === 0) {
          return <span className="text-xs text-muted-foreground">None</span>;
        }
        return (
          <div className="w-full px-1">
            <ProductCategoryChart distribution={distribution} height={24} valueLabel="of members" />
          </div>
        );
      },
    },
    {
      id: 'biomeDistribution',
      label: 'GOLD Ecosystem',
      width: 205,
      minWidth: 140,
      sortable: false,
      headerTooltip: 'The family’s members across GOLD ecosystem level 1.',
      renderCell: (hit) => {
        const distribution = hit.gcf?.biomeDistributionByLevel?.[1];
        if (!distribution || Object.keys(distribution).length === 0) {
          return <span className="text-xs text-muted-foreground">No data</span>;
        }
        return (
          <div className="w-full px-1">
            <BiomeDistributionChart distribution={distribution} height={24} />
          </div>
        );
      },
    },
    {
      id: 'taxonomyDistribution',
      label: 'Taxonomy',
      width: 205,
      minWidth: 140,
      sortable: false,
      headerTooltip: 'The family’s members across GTDB phyla.',
      renderCell: (hit) => {
        const distribution = taxonomyForDisplay(hit.gcf);
        if (!distribution || Object.keys(distribution).length === 0) {
          return <span className="text-xs text-muted-foreground">No data</span>;
        }
        return (
          <div className="w-full px-1">
            <TaxonomyDistributionChart distribution={distribution} height={24} />
          </div>
        );
      },
    },
    // Opt-in: the columns above already fill the panel width.
    {
      id: 'length',
      label: 'Length',
      width: 110,
      minWidth: 90,
      sortable: false,
      visible: false,
      headerTooltip: 'Median length of complete members; ≥ marks families with none.',
      renderCell: (hit) => {
        const len = hit.gcf?.lengthStats ? formatBgcLength(hit.gcf.lengthStats) : null;
        if (!len) return <span className="text-xs text-muted-foreground">—</span>;
        return (
          <span
            className={`block text-right tabular-nums ${len.isBound ? 'text-muted-foreground' : 'text-foreground'}`}
            title={len.tooltip}
          >
            {len.text}
          </span>
        );
      },
    },
    {
      id: 'assemblies',
      label: 'Assemblies',
      width: 110,
      minWidth: 80,
      sortable: false,
      visible: false,
      headerTooltip: 'Assemblies the family’s members come from.',
      renderCell: (hit) => (
        <span className="block text-right font-mono tabular-nums text-[12.5px] text-muted-foreground">
          {hit.gcf?.assemblyCount === undefined ? '—' : hit.gcf.assemblyCount.toLocaleString()}
        </span>
      ),
    },
    {
      id: 'productTypeDistribution',
      label: 'Product distribution',
      width: 205,
      minWidth: 140,
      sortable: false,
      visible: false,
      headerTooltip: 'Granular antiSMASH products (e.g. lassopeptide).',
      renderCell: (hit) => {
        const distribution = hit.gcf?.productTypeDistribution;
        if (!distribution || Object.keys(distribution).length === 0) {
          return <span className="text-xs text-muted-foreground">None</span>;
        }
        return (
          <div className="w-full px-1">
            <ProductCategoryChart distribution={distribution} height={24} />
          </div>
        );
      },
    },
  ], []);

  if (isLoading) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-12 w-full" />
      </div>
    );
  }

  if (error) {
    return (
      <Alert variant="destructive">
        <Terminal className="size-4" />
        <AlertTitle>Could not load results</AlertTitle>
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    );
  }

  if (groups.length === 0) {
    return (
      <Alert>
        <Terminal className="size-4" />
        <AlertTitle>No results</AlertTitle>
        <AlertDescription>This job produced no family assignments.</AlertDescription>
      </Alert>
    );
  }

  const placed = groups.filter((group) => group.winner !== null).length;
  const mapTotal = mapSamples.data?.total ?? 0;
  const mapDrawn = mapSamples.data?.data.length ?? 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-[12.5px] text-muted-foreground">
        <span>
          <span className="font-mono tabular-nums text-foreground">{placed.toLocaleString()}</span>
          {' of '}
          <span className="font-mono tabular-nums text-foreground">{groups.length.toLocaleString()}</span>
          {' uploaded BGCs placed in a gene cluster family'}
        </span>
        <InfoTooltip
          content={
            'Beyond 0.4 means no match by feature distance — not that the BGC is absent from '
            + 'the atlas, which placed most of its own members by stronger evidence.'
          }
        />
        <span className="ml-auto flex items-center gap-3">
          {session?.searchDurationMs != null && (
            <span className="font-mono tabular-nums text-[11px]">
              {(session.searchDurationMs / 1000).toFixed(1)}s
            </span>
          )}
          <Button asChild variant="outline" size="sm">
            <a href={withBase(`/api/search/bigslice/${sessionId}/export`)} download>
              <Download className="size-3.5" />
              Download TSV
            </a>
          </Button>
        </span>
      </div>

      {matchedFamilies.length >= 2 && (
        <CollapsibleSection
          title="Across the families matched"
          icon={Layers}
          badge={matchedFamilies.length.toLocaleString()}
          defaultOpen
        >
          <div className="space-y-4">
            <p className="text-[12.5px] text-muted-foreground">
              Share of the {matchedBgcs.toLocaleString()} atlas BGCs in these families.
            </p>
            {([
              ['Category', summary.categories, ProductCategoryChart],
              ['GOLD ecosystem (L1)', summary.ecosystems, BiomeDistributionChart],
              ['Taxonomy (phylum)', summary.taxonomy, TaxonomyDistributionChart],
            ] as const).map(([label, distribution, Chart]) =>
              Object.keys(distribution).length > 0 ? (
                <div key={label} className="space-y-1">
                  <div className="section-label">{label}</div>
                  <Chart distribution={distribution} height={28} />
                </div>
              ) : null,
            )}
          </div>
        </CollapsibleSection>
      )}

      {matchedFamilies.length > 0 && (
        <CollapsibleSection
          title="Where these families occur"
          onOpenChange={setMapOpen}
        >
          {mapSamples.isLoading ? (
            <Skeleton className="h-[420px] w-full" />
          ) : mapSamples.error ? (
            <p className="py-8 text-center text-sm text-destructive">Failed to load the map.</p>
          ) : mapTotal === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              None of the samples hosting these families have coordinates.
            </p>
          ) : (
            <div className="space-y-2">
              <SampleMapDots samples={mapSamples.data?.data ?? []} height={460} />
              {/* Most of the corpus has no coordinates, so the dot count needs qualifying. */}
              <p className="text-[11px] text-muted-foreground">
                {mapTotal.toLocaleString()} geolocated sample{mapTotal === 1 ? '' : 's'}, one dot
                each{mapDrawn < mapTotal ? `; ${mapDrawn.toLocaleString()} drawn` : ''}.
              </p>
            </div>
          )}
        </CollapsibleSection>
      )}

      {groups.map((group) => (
        <CollapsibleSection
          key={group.filename}
          title={group.filename}
          badge={group.winner ? familyLabel(group.winner) : 'no family within 0.4'}
          defaultOpen={groups.length <= AUTO_OPEN_UP_TO}
        >
          <div className="space-y-3">
            <p className="text-[12.5px] text-muted-foreground">
              {group.winner ? (
                <>
                  Member of{' '}
                  <span className="font-mono text-foreground">{familyLabel(group.winner)}</span>
                  {group.winner.petName ? ` (${group.winner.petName})` : ''} at distance{' '}
                  <span className="font-mono tabular-nums text-foreground">
                    {group.winner.distance.toFixed(4)}
                  </span>
                  {group.winner.tier === 'fragmented' ? ', a fragment-derived family.' : '.'}
                </>
              ) : (
                <>
                  No family within 0.4.{' '}
                  {group.nearest && (
                    <>
                      The nearest is{' '}
                      <span className="font-mono text-foreground">{familyLabel(group.nearest)}</span>
                      {' at '}
                      <span className="font-mono tabular-nums text-foreground">
                        {group.nearest.distance.toFixed(4)}
                      </span>
                      .{' '}
                    </>
                  )}
                  {group.cascaded ? '' : 'Only the main families were searched.'}
                </>
              )}
            </p>
            <ResizableTable
              columns={columns}
              data={group.hits}
              emptyState={<span className="text-[12.5px] text-muted-foreground">No candidates.</span>}
            />
          </div>
        </CollapsibleSection>
      ))}

      {truncated && (
        <Alert>
          <Terminal className="size-4" />
          <AlertTitle>Showing part of this job</AlertTitle>
          <AlertDescription>
            More candidates were found than this page requested, so some are not listed.
          </AlertDescription>
        </Alert>
      )}

      {results.length > 0 && (
        <p className="text-[11px] text-muted-foreground">
          Up to three nearest families per model.
        </p>
      )}
    </div>
  );
}
