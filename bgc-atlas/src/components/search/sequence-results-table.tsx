"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  useSequenceSearch,
  useSequenceGroupHits,
  type SequenceSearchGroup,
} from '@/lib/hooks/use-sequence-search';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  ChevronDown,
  ChevronRight,
  Download,
  Loader2,
  AlertCircle,
  CheckCircle2,
  ExternalLink,
} from 'lucide-react';
import { AlignmentBlock } from '@/components/search/alignment-block';
import { BIT_SCORE_BANDS, bitScoreBand } from '@/lib/seqsearch/result-colors';
import { ContigMap, DEFAULT_STACK_GROUPS } from '@/components/search/contig-map';
import { SampleMapDots } from '@/components/ui/sample-map-dots';
import { useSequenceMapSamples } from '@/lib/hooks/use-sequence-map-samples';
import { useContigMap, type ContigLocus } from '@/lib/hooks/use-contig-map';
import { withBase } from '@/lib/basePath';
import { ResizableTable, type TableColumn } from '@/components/ui/resizable-table';
import { Pagination } from '@/components/ui/pagination';

interface SequenceResultsTableProps {
  sessionId: string;
}

/** Seeded to the search's own thresholds, never below them. */
interface Filters {
  minIdentity: number;
  minCoverage: number;
}

const groupId = (group: SequenceSearchGroup) => group.groupKey;

type SortKey = 'evalue' | 'identity' | 'bitscore' | 'querygenes';
const SORTABLE: SortKey[] = ['evalue', 'identity', 'bitscore', 'querygenes'];

// A first header click sends 'asc', which on a count column would lead with single-gene matches.
const DESCENDING_FIRST: SortKey[] = ['querygenes'];

const PAGE_SIZES = [25, 50, 100];
const DEFAULT_PAGE_SIZE = 25;

/** What actually reaches the API: only thresholds stricter than the search's own. */
interface ActiveFilters {
  minIdentity?: number;
  minCoverage?: number;
}

/** NCBI's bit-score banding, as a BLAST report colours hits. */
function BitScore({ value, className }: { value: number; className?: string }) {
  const band = bitScoreBand(value);
  return (
    <span className={className ? `inline-flex items-center gap-1.5 ${className}` : 'inline-flex items-center gap-1.5'}>
      <span
        className="inline-block size-2.5 shrink-0 rounded-[2px]"
        style={{ background: band.color }}
        aria-hidden
      />
      <span className="tabular-nums">{value.toFixed(1)}</span>
      <span className="sr-only">bits, {band.label} band</span>
    </span>
  );
}

function BitScoreLegend() {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
      <span className="uppercase tracking-wide">Bit score</span>
      {BIT_SCORE_BANDS.map((band) => (
        <span key={band.label} className="inline-flex items-center gap-1.5">
          <span
            className="inline-block size-2.5 rounded-[2px]"
            style={{ background: band.color }}
            aria-hidden
          />
          {band.label}
        </span>
      ))}
    </div>
  );
}

// Separate component so the fetch only runs for rows the user opened.
function GroupAlignments({
  sessionId,
  group,
  filters,
  isNucleotideQuery,
}: {
  sessionId: string;
  group: SequenceSearchGroup;
  /** undefined means no filter beyond the search's own. */
  filters: ActiveFilters;
  isNucleotideQuery: boolean;
}) {
  const [openAlignments, setOpenAlignments] = useState<Set<string>>(new Set());

  const toggleAlignment = (resultId: string) => {
    setOpenAlignments(prev => {
      const next = new Set(prev);
      if (next.has(resultId)) next.delete(resultId);
      else next.add(resultId);
      return next;
    });
  };

  const showQueryGene = group.queryIds.length > 1;

  const { hits, isLoading, error } = useSequenceGroupHits(
    sessionId,
    { groupKey: group.groupKey },
    true,
    filters,
  );

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading alignments…
      </div>
    );
  }

  if (error) {
    return <div className="py-4 text-sm text-destructive">{error.message}</div>;
  }

  if (!hits || hits.length === 0) {
    return <div className="py-4 text-sm text-muted-foreground">No alignments to show.</div>;
  }

  return (
    <div className="space-y-3">
      <h4 className="text-sm font-semibold">
        {hits.length} CDS alignment{hits.length !== 1 ? 's' : ''}
        {group.bgcFilename && (
          <span className="ml-2 font-normal text-muted-foreground font-mono text-xs">
            {group.bgcFilename}
          </span>
        )}
      </h4>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
              <th className="w-6 py-1 pr-1 font-medium sr-only">Expand</th>
              {/* One BGC can be hit by several query genes, and a target CDS can repeat. */}
              {showQueryGene && <th className="py-1 pr-4 font-medium">Query gene</th>}
              <th className="py-1 pr-4 font-medium">Target CDS</th>
              <th className="py-1 pr-4 font-medium">Identity</th>
              <th className="py-1 pr-4 font-medium">
                {isNucleotideQuery ? 'Subject cov.' : 'Query cov.'}
              </th>
              <th className="py-1 pr-4 font-medium">E-value</th>
              <th className="py-1 pr-4 font-medium">Bit score</th>
              <th className="py-1 pr-4 font-medium">Query range</th>
              <th className="py-1 pr-4 font-medium">Target range</th>
              <th className="py-1 pr-4 font-medium">Aln. length</th>
            </tr>
          </thead>
          <tbody>
            {hits.map(hit => {
              const alignmentOpen = openAlignments.has(hit.resultId);
              const hasAlignment = Boolean(hit.queryAligned && hit.targetAligned);
              return (
              <Fragment key={hit.resultId}>
              <tr className="border-t">
                <td className="py-1.5 pr-1 align-top">
                  <button
                    type="button"
                    onClick={() => toggleAlignment(hit.resultId)}
                    disabled={!hasAlignment}
                    aria-expanded={alignmentOpen}
                    aria-label={alignmentOpen ? 'Hide alignment' : 'Show alignment'}
                    title={hasAlignment ? 'Show the pairwise alignment' : 'No alignment stored for this hit'}
                    className="inline-flex size-5 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:cursor-default disabled:opacity-30"
                  >
                    {alignmentOpen
                      ? <ChevronDown className="size-3.5" />
                      : <ChevronRight className="size-3.5" />}
                  </button>
                </td>
                {showQueryGene && (
                  <td className="py-1.5 pr-4 font-mono text-xs">{hit.queryId ?? '—'}</td>
                )}
                <td className="py-1.5 pr-4 font-mono text-xs" title={hit.targetId}>{hit.cdsLabel}</td>
                <td className="py-1.5 pr-4">{hit.identity.toFixed(1)}%</td>
                <td className="py-1.5 pr-4">{hit.coverage.toFixed(1)}%</td>
                <td className="py-1.5 pr-4 font-mono text-xs">{hit.eValue.toExponential(2)}</td>
                <td className="py-1.5 pr-4"><BitScore value={hit.bitScore} /></td>
                <td className="py-1.5 pr-4 font-mono text-xs">
                  {hit.queryStart}–{hit.queryEnd} of {hit.queryLength} {isNucleotideQuery ? 'nt' : 'aa'}
                </td>
                <td className="py-1.5 pr-4 font-mono text-xs">
                  {hit.targetStart}–{hit.targetEnd} of {hit.targetLength} aa
                </td>
                <td className="py-1.5 pr-4 font-mono text-xs">{hit.alignmentLength} aa</td>
              </tr>
              {alignmentOpen && (
                <tr className="border-t-0">
                  <td />
                  <td colSpan={8} className="pb-3 pr-4">
                    <AlignmentBlock hit={hit} isNucleotideQuery={isNucleotideQuery} />
                  </td>
                </tr>
              )}
              </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// Undefined when the value only restates the floor: passing the seeded floors through would
// change the query key on arrival and refetch an identical page.
function narrowed(value: number | undefined, floor: number | undefined): number | undefined {
  if (value === undefined || floor === undefined) return undefined;
  return value > floor ? value : undefined;
}

export function SequenceResultsTable({ sessionId }: SequenceResultsTableProps) {
  // Null until the session supplies the floors; DIAMOND already filtered to them, so these can only narrow.
  const [draftFilters, setDraftFilters] = useState<Filters | null>(null);
  const [filters, setFilters] = useState<Filters | null>(null);
  // The thresholds DIAMOND already applied.
  const [floors, setFloors] = useState<Filters | null>(null);
  const [selectedLocus, setSelectedLocus] = useState<ContigLocus | null>(null);
  // Owned here: the bit-score legend moves into the table when the map is closed.
  const [mapOpen, setMapOpen] = useState(true);
  // The query only runs once opened; it is computed per request.
  const [sampleMapOpen, setSampleMapOpen] = useState(false);

  // Paging and sort live in the URL; the threshold filters do not, as they seed from the session.
  const router = useRouter();
  const searchParams = useSearchParams();
  const page = Math.max(0, Number(searchParams.get('page') ?? '1') - 1);
  const pageSize = PAGE_SIZES.includes(Number(searchParams.get('size')))
    ? Number(searchParams.get('size'))
    : DEFAULT_PAGE_SIZE;
  const sortBy = (SORTABLE.includes(searchParams.get('sort') as SortKey)
    ? searchParams.get('sort')
    : 'evalue') as SortKey;
  const sortOrder = searchParams.get('order') === 'desc' ? 'desc' : 'asc';

  const setParams = useCallback(
    (next: Record<string, string | null>) => {
      const params = new URLSearchParams(searchParams.toString());
      for (const [k, v] of Object.entries(next)) {
        if (v === null) params.delete(k);
        else params.set(k, v);
      }
      const query = params.toString();
      // Link/router already carry the basePath; withBase here would double-prefix it.
      router.replace(query ? `?${query}` : '?', { scroll: false });
    },
    [router, searchParams],
  );

  const setPage = useCallback(
    (next: number) => setParams({ page: next === 0 ? null : String(next + 1) }),
    [setParams],
  );

  const activeFilters: ActiveFilters = {
    minIdentity: narrowed(filters?.minIdentity, floors?.minIdentity),
    minCoverage: narrowed(filters?.minCoverage, floors?.minCoverage),
  };

  const {
    data: groups,
    session,
    isLoading,
    error,
    totalGroups,
  } = useSequenceSearch(sessionId, {
    ...activeFilters,
    queryFrom: selectedLocus?.start,
    queryTo: selectedLocus?.end,
    limit: pageSize,
    offset: page * pageSize,
    sortBy,
    sortOrder,
  });

  // Seed once, when the session arrives.
  useEffect(() => {
    if (floors || !session) return;
    const seed = {
      minIdentity: session.parameters.minIdentity,
      minCoverage: session.parameters.minCoverage,
    };
    setFloors(seed);
    setFilters(seed);
    setDraftFilters(seed);
  }, [session, floors]);


  const isNucleotideQuery = session?.sequenceType === 'nucleotide';

  const showQueryColumn = new Set((groups ?? []).flatMap((g) => g.queryIds)).size > 1;

  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const toggleRow = useCallback((key: string) => {
    setExpandedRows((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const [columnWidths, setColumnWidths] = useState<Record<string, number>>({});
  const [hiddenColumns, setHiddenColumns] = useState<Set<string>>(new Set());

  // Rows are grouped by (query, BGC) in SQL, so only the aggregate columns can be sorted.
  const columns = useMemo<TableColumn<SequenceSearchGroup>[]>(() => {
    const linkClass =
      'min-w-0 flex-1 truncate underline underline-offset-2 decoration-foreground/50 hover:decoration-foreground';
    const all: TableColumn<SequenceSearchGroup>[] = [
      {
        id: 'rank',
        label: 'Rank',
        width: columnWidths.rank ?? 70,
        sortable: false,
        renderCell: (row, index) => {
          const key = groupId(row);
          const isExpanded = expandedRows.has(key);
          return (
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => toggleRow(key)}
                className="shrink-0 text-muted-foreground hover:text-foreground"
                aria-expanded={isExpanded}
                title={isExpanded ? 'Hide CDS alignments' : 'Show CDS alignments'}
              >
                {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
              </button>
              <span className="tabular-nums">{page * pageSize + index + 1}</span>
            </div>
          );
        },
      },
      {
        id: 'querygenes',
        label: 'Query genes',
        width: columnWidths.querygenes ?? 130,
        sortable: true,
        defaultSortDirection: 'desc',
        headerTooltip:
          'How many of your query sequences aligned to this BGC. A BGC matched by several of your genes resembles the query more broadly than one matched by a single gene.',
        // Gene names go in the title: a BGC can match a dozen genes.
        renderCell: (row) => (
          <span className="block truncate text-xs" title={row.queryIds.join(', ')}>
            {row.queryIds.length
              ? `${row.queryIds.length} gene${row.queryIds.length === 1 ? '' : 's'}`
              : '—'}
          </span>
        ),
      },
      {
        id: 'bgc',
        label: 'BGC',
        width: columnWidths.bgc ?? 260,
        sortable: false,
        renderCell: (row) =>
          row.linked && row.bgcId ? (
            <div className="flex items-center gap-1">
              <Link
                href={`/bgcs/${row.bgcId}`}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                className={`${linkClass} font-mono text-xs`}
                title={row.bgcFilename ?? row.bgcId}
              >
                {row.bgcFilename ?? row.bgcId}
              </Link>
              <ExternalLink className="h-3 w-3 shrink-0 text-muted-foreground" />
            </div>
          ) : (
            <span
              className="block truncate font-mono text-xs text-muted-foreground"
              title="This region is in the search database but has no Atlas BGC record"
            >
              {row.groupKey} <span className="italic">(not in Atlas)</span>
            </span>
          ),
      },
      {
        id: 'product',
        label: 'Product',
        width: columnWidths.product ?? 140,
        sortable: false,
        renderCell: (row) => (
          <span className="block truncate text-xs" title={row.products.join(', ')}>
            {row.products.length ? row.products.join(', ') : '—'}
          </span>
        ),
      },
      {
        id: 'sample',
        label: 'Sample',
        width: columnWidths.sample ?? 150,
        sortable: false,
        renderCell: (row) =>
          row.sampleId ? (
            <div className="flex items-center gap-1">
              <Link
                href={`/samples/${encodeURIComponent(row.sampleId)}`}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                className={`${linkClass} text-xs`}
                title={row.sampleName ?? row.sampleId}
              >
                {row.sampleName ?? row.sampleId}
              </Link>
              <ExternalLink className="h-3 w-3 shrink-0 text-muted-foreground" />
            </div>
          ) : (
            <span className="block truncate text-xs" title={row.sampleName ?? ''}>
              {row.sampleName ?? '—'}
            </span>
          ),
      },
      {
        id: 'source',
        label: 'Source',
        width: columnWidths.source ?? 110,
        sortable: false,
        renderCell: (row) => <span className="text-xs">{row.dataSource ?? '—'}</span>,
      },
      {
        id: 'gcf',
        label: 'GCF',
        width: columnWidths.gcf ?? 150,
        sortable: false,
        renderCell: (row) =>
          row.gcfId && row.gcfName ? (
            <Link
              href={`/gcfs/${row.gcfId}`}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="text-xs underline underline-offset-2 decoration-foreground/50 hover:decoration-foreground"
            >
              {row.gcfName}
            </Link>
          ) : (
            <span className="text-xs">—</span>
          ),
      },
      {
        id: 'taxonomy',
        label: 'Taxonomy',
        width: columnWidths.taxonomy ?? 160,
        sortable: false,
        renderCell: (row) => (
          <span className="block truncate text-xs" title={row.taxonLineage ?? ''}>
            {row.taxonName ?? '—'}
          </span>
        ),
      },
      {
        id: 'cdsHits',
        label: 'CDS hits',
        width: columnWidths.cdsHits ?? 110,
        sortable: false,
        headerTooltip: 'How many coding sequences of this BGC the query aligned to.',
        renderCell: (row) => <span className="tabular-nums">{row.cdsHits}</span>,
      },
      {
        id: 'identity',
        label: 'Best ident.',
        width: columnWidths.identity ?? 120,
        sortable: true,
        defaultSortDirection: 'desc',
        headerTooltip: 'Percentage of exact matches in the best alignment against this BGC.',
        renderCell: (row) => (
          <span className="font-mono tabular-nums">{row.bestIdentity.toFixed(1)}%</span>
        ),
      },
      {
        id: 'evalue',
        label: 'Best E-value',
        width: columnWidths.evalue ?? 130,
        sortable: true,
        headerTooltip:
          'Expectation value of the best alignment: the number of hits one can expect to see by chance in a database of this size.',
        renderCell: (row) => (
          <span className="font-mono text-xs">{row.bestEValue.toExponential(2)}</span>
        ),
      },
      {
        id: 'bitscore',
        label: 'Best bit score',
        width: columnWidths.bitscore ?? 140,
        sortable: true,
        defaultSortDirection: 'desc',
        headerTooltip:
          'Bit score of the best alignment — a database-size-independent measure of alignment strength. Banded and coloured as in an NCBI BLAST report.',
        renderCell: (row) => <BitScore value={row.bestBitScore} />,
      },
    ];
    return all
      .filter((c) => (c.id === 'querygenes' ? showQueryColumn : true))
      .map((c) => ({ ...c, visible: !hiddenColumns.has(c.id) }));
  }, [columnWidths, hiddenColumns, page, pageSize, showQueryColumn, expandedRows, toggleRow]);


  const sampleMap = useSequenceMapSamples(
    sessionId,
    {
      ...activeFilters,
      queryFrom: selectedLocus?.start,
      queryTo: selectedLocus?.end,
    },
    sampleMapOpen
  );

  const sessionGroups = session?.totalGroups ?? totalGroups;
  const isFiltered =
    Boolean(selectedLocus) ||
    activeFilters.minIdentity !== undefined ||
    activeFilters.minCoverage !== undefined;

  const [stackGroups, setStackGroups] = useState<number>(DEFAULT_STACK_GROUPS);
  const { data: contigMap } = useContigMap(
    sessionId,
    // A GenBank record searched by its CDS translations is a protein search but still maps onto its contig.
    session?.hasContigMap ?? isNucleotideQuery,
    stackGroups,
  );
  // DIAMOND caps hits per query at --max-target-seqs; say so rather than present a capped list as complete.
  const truncatedCount = session?.truncatedQueries?.length ?? 0;

  // Fetched rather than a plain <a download>: a cold export takes seconds and a bare anchor shows nothing meanwhile.
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  const exportCsv = useCallback(async () => {
    setExporting(true);
    setExportError(null);
    try {
      const res = await fetch(withBase(`/api/search/sequence/${sessionId}/export`));
      if (!res.ok) {
        const detail = await res.json().catch(() => null);
        throw new Error(detail?.error || `Export failed (${res.status})`);
      }
      const disposition = res.headers.get('content-disposition') ?? '';
      const filename = /filename="([^"]+)"/.exec(disposition)?.[1]
        ?? `sequence-search-${sessionId}.csv`;
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 0);
    } catch (err) {
      setExportError(err instanceof Error ? err.message : 'Export failed');
    } finally {
      setExporting(false);
    }
  }, [sessionId]);

  if (isLoading && !groups) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <span className="ml-3 text-lg">Loading results...</span>
      </div>
    );
  }

  if (error) {
    return (
      <Alert variant="destructive">
        <AlertCircle className="h-4 w-4" />
        <AlertTitle>Error</AlertTitle>
        <AlertDescription>{error.message}</AlertDescription>
      </Alert>
    );
  }

  if (!groups || groups.length === 0) {
    return (
      <div className="py-12 text-center">
        <AlertCircle className="mx-auto h-12 w-12 text-muted-foreground" />
        <p className="mt-4 text-lg font-medium">No results found</p>
        <p className="mt-2 text-sm text-muted-foreground">
          Try adjusting your filters or search parameters
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {session && (
        <div className="flex items-center justify-between rounded-lg border bg-muted/30 p-4">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-success" />
              <span className="font-medium">Search Completed</span>
            </div>
            <div className="text-sm text-muted-foreground">
              {/* totalHits is session-wide, so it pairs with the session-wide BGC count. */}
              {session.totalHits.toLocaleString()} CDS hit{session.totalHits !== 1 ? 's' : ''} in{' '}
              {sessionGroups.toLocaleString()} BGC{sessionGroups !== 1 ? 's' : ''}
              {isFiltered && (
                <span className="text-foreground">
                  {' · '}
                  {totalGroups.toLocaleString()} match the current filter
                </span>
              )}
            </div>
            <div className="text-sm text-muted-foreground">
              {isNucleotideQuery ? 'DIAMOND blastx (nucleotide query)' : 'DIAMOND blastp (protein query)'}
            </div>
            {session.searchDurationMs && (
              <div className="text-sm text-muted-foreground">
                Search time: {(session.searchDurationMs / 1000).toFixed(1)}s
              </div>
            )}
          </div>
          {/* Server-side, so the CSV covers the whole session, not just the loaded page. */}
          <div className="flex flex-col items-end gap-1">
            <Button variant="outline" size="sm" onClick={exportCsv} disabled={exporting}>
              {exporting
                ? <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                : <Download className="mr-2 h-4 w-4" />}
              {exporting ? 'Preparing CSV…' : 'Export CSV'}
            </Button>
            {exportError && (
              <span className="text-[11px] text-destructive">{exportError}</span>
            )}
          </div>
        </div>
      )}

      {truncatedCount > 0 && session && (
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Showing the top {session.maxResults.toLocaleString()} matches</AlertTitle>
          <AlertDescription>
            {truncatedCount === 1
              ? 'This query reached the per-query result limit, so more matches exist than are shown.'
              : `${truncatedCount} of your query sequences reached the per-query result limit, so more matches exist than are shown.`}{' '}
            Narrow the search with a higher identity or coverage threshold to see the most
            similar hits.
          </AlertDescription>
        </Alert>
      )}

      {/* Disabled until the floors are known, so nobody filters below what was searched. */}
      <div className="flex gap-4 items-end rounded-lg border p-4">
        <div className="flex-1">
          <label className="text-sm font-medium">Min Identity %</label>
          <Input
            type="number"
            min={floors?.minIdentity ?? 0}
            max="100"
            step="1"
            disabled={!draftFilters}
            value={draftFilters?.minIdentity ?? ''}
            onChange={(e) => setDraftFilters(prev => prev && ({ ...prev, minIdentity: Number(e.target.value) }))}
            className="mt-1"
          />
        </div>
        <div className="flex-1">
          <label className="text-sm font-medium">Min Coverage %</label>
          <Input
            type="number"
            min={floors?.minCoverage ?? 0}
            max="100"
            step="1"
            disabled={!draftFilters}
            value={draftFilters?.minCoverage ?? ''}
            onChange={(e) => setDraftFilters(prev => prev && ({ ...prev, minCoverage: Number(e.target.value) }))}
            className="mt-1"
          />
        </div>
        <Button onClick={() => setFilters(draftFilters)} variant="secondary" disabled={!draftFilters}>
          Apply Filters
        </Button>
      </div>

      {floors && (
        <p className="text-xs text-muted-foreground">
          The search itself ran at {floors.minIdentity}% identity and {floors.minCoverage}%
          coverage, so these filters can only narrow the results further.
        </p>
      )}

      <p className="text-xs text-muted-foreground">
        Hits are grouped by the BGC they belong to — expand a row to see the individual CDS
        alignments. Identity, coverage, E-value and bit score are those of the best alignment
        in the group.{' '}
        {isNucleotideQuery
          ? 'For nucleotide queries coverage is measured over the hit CDS, since a query spanning several genes cannot be covered by any single one.'
          : 'Coverage is measured over the query sequence.'}
      </p>

      {contigMap && contigMap.loci.length > 0 && (
        <ContigMap
          data={contigMap}
          groups={stackGroups}
          onGroupsChange={setStackGroups}
          selectedLocus={selectedLocus}
          onSelectLocus={setSelectedLocus}
          open={mapOpen}
          onOpenChange={setMapOpen}
        />
      )}

      <div className="rounded-sm border border-border bg-card">
        <button
          type="button"
          onClick={() => setSampleMapOpen((v) => !v)}
          aria-expanded={sampleMapOpen}
          className="flex w-full items-baseline gap-2 px-3 py-2 text-left transition-colors hover:bg-muted/40"
        >
          <ChevronDown
            className={`size-4 shrink-0 self-center text-muted-foreground transition-transform duration-200${sampleMapOpen ? '' : ' -rotate-90'}`}
            aria-hidden
          />
          <span className="text-sm font-semibold tracking-tight">Sample map</span>
          <span className="truncate font-mono text-xs font-normal text-muted-foreground">
            {sampleMap.hasLoaded
              ? `${sampleMap.data.total.toLocaleString()} of ${sessionGroups.toLocaleString()} hit BGCs placed`
              : 'where these hits come from'}
          </span>
        </button>
        {sampleMapOpen && (
          <div className="space-y-2 border-t border-border p-3">
            {sampleMap.isLoading ? (
              // Normally cached, but an uncached run takes minutes on a large search.
              <div className="flex items-start gap-2 py-8 text-sm text-muted-foreground">
                <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin" />
                <span>
                  Locating {sessionGroups.toLocaleString()} hit BGC
                  {sessionGroups === 1 ? '' : 's'}…
                  <span className="block text-xs">
                    This can take a couple of minutes the first time a large search is mapped.
                  </span>
                </span>
              </div>
            ) : sampleMap.error ? (
              <div className="py-8 text-sm text-destructive">{sampleMap.error.message}</div>
            ) : sampleMap.data.total === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                None of these hits come from a sample with coordinates.
              </p>
            ) : (
              <>
                <SampleMapDots samples={sampleMap.data.data} height={460} />
                {/* Most samples have no coordinates, so state how many are drawn. */}
                <p className="text-[11px] text-muted-foreground">
                  {sampleMap.data.total.toLocaleString()} sample
                  {sampleMap.data.total === 1 ? '' : 's'} with coordinates, out of{' '}
                  {sessionGroups.toLocaleString()} hit BGC
                  {sessionGroups === 1 ? '' : 's'}. Samples without coordinates are not shown, and
                  the map follows the filters applied above.
                </p>
              </>
            )}
          </div>
        )}
      </div>

      {/* The open map carries the legend; otherwise the table needs its own. */}
      {(!contigMap || !mapOpen) && <BitScoreLegend />}

      {/* ResizableTable has its own scroll container; do not wrap it in another. */}
      <ResizableTable<SequenceSearchGroup>
        columns={columns}
        data={groups}
        sortColumn={sortBy}
        sortDirection={sortOrder}
        onSort={(columnId, direction) => {
          const first = columnId !== sortBy;
          const next =
            first && DESCENDING_FIRST.includes(columnId as SortKey) ? 'desc' : direction;
          setParams({
            sort: columnId === 'evalue' ? null : columnId,
            order: next === 'asc' ? null : next,
            page: null,
          });
        }}
        onColumnResize={(columnId, width) =>
          setColumnWidths((prev) => ({ ...prev, [columnId]: width }))
        }
        onColumnVisibilityChange={(columnId, visible) =>
          setHiddenColumns((prev) => {
            const next = new Set(prev);
            if (visible) next.delete(columnId);
            else next.add(columnId);
            return next;
          })
        }
        renderExpandedRow={(group) =>
          expandedRows.has(groupId(group)) ? (
            <div className="bg-muted/30 p-6">
              <GroupAlignments
                sessionId={sessionId}
                group={group}
                filters={activeFilters}
                isNucleotideQuery={isNucleotideQuery}
              />
            </div>
          ) : null
        }
      />

      {totalGroups > 0 && (
        <Pagination
          currentPage={page}
          totalPages={Math.max(1, Math.ceil(totalGroups / pageSize))}
          totalItems={totalGroups}
          offset={page * pageSize}
          pageSize={pageSize}
          onPageChange={setPage}
          onPageSizeChange={(size) => setParams({ size: size === DEFAULT_PAGE_SIZE ? null : String(size), page: null })}
        />
      )}
    </div>
  );
}
