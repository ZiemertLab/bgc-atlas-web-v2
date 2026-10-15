'use client';

import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { AlertCircle, ChevronDown, ChevronRight, Filter, Search } from 'lucide-react';

import { MainLayout } from '@/components/layout/main-layout';
import { ResizableTable, type TableColumn } from '@/components/ui/resizable-table';
import { StudyDetailsPanel } from '@/components/ui/study-details-panel';
import { Pagination } from '@/components/ui/pagination';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { BiomeDistributionChart } from '@/components/ui/biome-distribution-chart';
import { EcosystemLegend } from '@/components/ui/ecosystem-legend';
import { ProductCategoryChart } from '@/components/ui/product-category-chart';
import { ProductCategoryLegend } from '@/components/ui/product-category-legend';
import { SourceTypeLegend } from '@/components/ui/source-type-legend';
import { getSourceTypeColor, SOURCE_TYPE_LABELS } from '@/lib/utils/chart-utils';
import { SampleDataSourceLinks } from '@/components/ui/sample-data-source-links';
import { EmptyState } from '@/components/ui/empty-state';
import { TableSkeleton } from '@/components/ui/loading-skeleton';
import { ColdLoadHint } from '@/components/ui/cold-load-hint';
import { StudyRow } from '@/components/ui/study-row';
import { FilterChips } from '@/components/ui/filter-chips';
import { RefetchFrame } from '@/components/ui/refetch-frame';
import { AdvancedFilterDrawer } from '@/components/filters/advanced-filter-drawer';
import { studyExportPath, useStudies } from '@/lib/hooks/use-studies';
import { ExportMenu } from '@/components/ui/export-menu';
import { downloadText, exportFilename, serializeExport, type ExportFormat } from '@/lib/export/format';
import { STUDY_EXPORT_COLUMNS } from '@/lib/export/study-columns';
import type { Study } from '@/lib/types';
import { studyFilterFields } from '@/lib/filters/field-definitions';
import { studyFilterRecipes } from '@/lib/filters/recipes';
import {
  createDefaultFilterGroup,
  deserializeFilterGroup,
  hasFilterRules,
  serializeFilterGroup,
  summarizeFilterGroup,
  type FilterGroup,
} from '@/lib/filters/types';
import {
  advancedFilterRequestParam,
  unreadableAdvancedFilterParam,
} from '@/lib/filters/advanced-filter-param';

const num = (n: number | null | undefined) => (n ?? 0).toLocaleString();

// Tallies -> percentages, since ProductCategoryChart takes shares; null when there is
// nothing to draw. For categories the denominator is assignments, not BGCs:
// product_category is multi-label. Dataset-type counts do partition the BGCs.
function toShares(counts: Record<string, number> | null | undefined) {
  const entries = Object.entries(counts ?? {}).filter(([, n]) => n > 0);
  const total = entries.reduce((sum, [, n]) => sum + n, 0);
  if (!total) return null;
  return Object.fromEntries(entries.map(([key, n]) => [key, (n / total) * 100]));
}

const sourceTypeLabel = (key: string) => SOURCE_TYPE_LABELS[key] ?? key;

const DEFAULT_SORT_FIELD = 'exclusive';
const DEFAULT_SORT_ORDER: 'asc' | 'desc' = 'desc';
const DEFAULT_PAGE_SIZE = 50;
const PAGE_SIZE_OPTIONS = [10, 25, 50, 100];

export default function StudiesPage() {
  return (
    <Suspense fallback={null}>
      <StudiesPageInner />
    </Suspense>
  );
}

function StudiesPageInner() {
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();

  const [searchInput, setSearchInput] = useState(() => searchParams.get('search') ?? '');
  const [search, setSearch] = useState(() => searchParams.get('search') ?? '');
  const [sortField, setSortField] = useState(() => searchParams.get('sort') || DEFAULT_SORT_FIELD);
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>(() =>
    searchParams.get('order') === 'asc' ? 'asc' : DEFAULT_SORT_ORDER
  );
  const [page, setPage] = useState(() => {
    const parsed = Number(searchParams.get('page'));
    return Number.isFinite(parsed) && parsed > 1 ? Math.floor(parsed) - 1 : 0;
  });
  const [pageSize, setPageSize] = useState(() => {
    const parsed = Number(searchParams.get('size'));
    return PAGE_SIZE_OPTIONS.includes(parsed) ? parsed : DEFAULT_PAGE_SIZE;
  });
  const [columnVisibility, setColumnVisibility] = useState<Record<string, boolean>>({});
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>({});
  const [expandedStudies, setExpandedStudies] = useState<Set<string>>(new Set());
  // Levels 4-5 are set for too few of a study's samples to describe the study.
  const [ecosystemLevel, setEcosystemLevel] = useState(1);

  const toggleStudyExpansion = (studyId: string) => {
    setExpandedStudies((prev) => {
      const next = new Set(prev);
      if (!next.delete(studyId)) next.add(studyId);
      return next;
    });
  };

  const [advancedFiltersOpen, setAdvancedFiltersOpen] = useState(false);
  // Seeded in an initializer so the first request already carries it.
  const [unreadableAdvancedParam, setUnreadableAdvancedParam] = useState<string | null>(() =>
    unreadableAdvancedFilterParam(searchParams.get('advancedFilters'))
  );
  const [advancedFilters, setAdvancedFilters] = useState<FilterGroup | null>(() =>
    deserializeFilterGroup(searchParams.get('advancedFilters'))
  );
  const [advancedFiltersDraft, setAdvancedFiltersDraft] = useState<FilterGroup>(
    () => deserializeFilterGroup(searchParams.get('advancedFilters')) ?? createDefaultFilterGroup()
  );

  const hasAdvancedFiltersApplied = hasFilterRules(advancedFilters);
  const hasDraftAdvancedFilters = hasFilterRules(advancedFiltersDraft);
  const advancedFiltersEncoded = useMemo(
    () => serializeFilterGroup(hasAdvancedFiltersApplied ? advancedFilters : null),
    [advancedFilters, hasAdvancedFiltersApplied]
  );
  // An unparseable URL value is forwarded so the server refuses it (one place for the rule).
  const advancedFiltersRequestParam = advancedFilterRequestParam(
    advancedFiltersEncoded,
    unreadableAdvancedParam,
  );
  const advancedFilterSummaries = useMemo(
    () =>
      hasAdvancedFiltersApplied && advancedFilters
        ? summarizeFilterGroup(advancedFilters, studyFilterFields)
        : [],
    [advancedFilters, hasAdvancedFiltersApplied]
  );

  const applyAdvancedFilters = () => {
    const next = hasFilterRules(advancedFiltersDraft) ? advancedFiltersDraft : null;
    setAdvancedFilters(next);
    setUnreadableAdvancedParam(null);
    setAdvancedFiltersOpen(false);
    setPage(0);
  };

  const clearAdvancedFilters = () => {
    setAdvancedFilters(null);
    setUnreadableAdvancedParam(null);
    setAdvancedFiltersDraft(createDefaultFilterGroup());
    setAdvancedFiltersOpen(false);
    setPage(0);
  };

  // Skip the first run so an incoming ?page=N is not reset on mount.
  const searchDebounceReady = useRef(false);
  useEffect(() => {
    if (!searchDebounceReady.current) {
      searchDebounceReady.current = true;
      return;
    }
    const timer = setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(0);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchInput]);

  // Reads window.location, not the searchParams hook, so foreign params survive and
  // the effect cannot retrigger itself through router.replace.
  useEffect(() => {
    if (!pathname) return;
    const params = new URLSearchParams(window.location.search);
    const setOrDelete = (key: string, value: string | null) => {
      if (value === null) params.delete(key);
      else params.set(key, value);
    };

    setOrDelete('search', search || null);
    setOrDelete('sort', sortField === DEFAULT_SORT_FIELD ? null : sortField);
    setOrDelete('order', sortOrder === DEFAULT_SORT_ORDER ? null : sortOrder);
    setOrDelete('page', page > 0 ? String(page + 1) : null);
    setOrDelete('size', pageSize === DEFAULT_PAGE_SIZE ? null : String(pageSize));
    // The forwarded value, not the encoded state, so an unreadable value is not dropped.
    setOrDelete('advancedFilters', advancedFiltersRequestParam ?? null);

    const query = params.toString();
    if (query === window.location.search.replace(/^\?/, '')) return;
    router.replace(`${pathname}${query ? `?${query}` : ''}`, { scroll: false });
  }, [
    search,
    sortField,
    sortOrder,
    page,
    pageSize,
    advancedFiltersRequestParam,
    pathname,
    router,
  ]);

  const listParams = {
    search: search || undefined,
    advancedFilters: advancedFiltersRequestParam,
    sortField,
    sortOrder,
  };
  const { data, isLoading, isFetching, error, hasLoaded } = useStudies({
    limit: pageSize,
    offset: page * pageSize,
    ...listParams,
  });

  const studies = data.data.data;
  const total = data.data.total;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const showSkeleton = isLoading && !hasLoaded;
  const hasActiveFilters = Boolean(search) || hasAdvancedFiltersApplied;


  const handleSort = (columnId: string, direction: 'asc' | 'desc') => {
    setSortField(columnId);
    setSortOrder(direction);
    setPage(0);
  };

  const handleColumnReorder = (_newOrder: string[]) => {};
  const handleColumnResize = (columnId: string, width: number) =>
    setColumnWidths((prev) => ({ ...prev, [columnId]: width }));
  const handleColumnVisibilityChange = (columnId: string, visible: boolean) =>
    setColumnVisibility((prev) => ({ ...prev, [columnId]: visible }));

  const clearFilters = () => {
    setSearchInput('');
    setSearch('');
    setAdvancedFilters(null);
    setUnreadableAdvancedParam(null);
    setAdvancedFiltersDraft(createDefaultFilterGroup());
    setPage(0);
  };

  const handleExport = (format: ExportFormat) => {
    if (!studies.length) return;
    downloadText(
      serializeExport(studies, STUDY_EXPORT_COLUMNS, format),
      exportFilename(`studies_page${page + 1}`, studies.length, studies.length, format),
      format,
    );
  };



  // The default set must fit the 1,342px content width at 1440; Complete, % clustered,
  // Composition and Genomes are opt-in through the Columns control. Widths fit each
  // header on one line in its sorted state; where that left no room for a "?" icon the
  // explainer is a headerTitle. Each must agree with its column's `visible` default below.
  const showDatasetLegend = columnVisibility.datasetType !== false;
  const showCategoryLegend = columnVisibility.products === true;
  const showEcosystemLegend = columnVisibility.environment !== false;

  const columns: TableColumn<Study>[] = useMemo(
    () => [
      {
        id: 'title',
        label: 'Study',
        width: columnWidths.title ?? 180,
        sortable: true,
        visible: columnVisibility.title !== false,
        renderCell: (s) => {
          const isExpanded = expandedStudies.has(s.study_id);
          return (
            <div className="flex min-w-0 items-start gap-2">
              <button
                type="button"
                onClick={() => toggleStudyExpansion(s.study_id)}
                className="mt-0.5 shrink-0 text-muted-foreground hover:text-foreground"
                aria-expanded={isExpanded}
                title={isExpanded ? 'Hide study details' : 'Show study details'}
              >
                {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
              </button>
              <div className="min-w-0">
              <div className="flex min-w-0 items-baseline gap-2">
                <Link
                  href={`/studies/${s.study_id}`}
                  className="truncate font-medium hover:text-brand hover:underline"
                  title={s.title || s.study_name || s.study_key}
                >
                  {s.title || s.study_name || s.study_key}
                </Link>
              </div>
              {/* A real separator character, so copied text does not run together. */}
              <div className="truncate text-xs text-muted-foreground">
                {s.center_name || '—'}
                {s.bioproject && (
                  <>
                    <span aria-hidden> · </span>
                    <span className="font-mono">{s.bioproject}</span>
                  </>
                )}
              </div>
              </div>
            </div>
          );
        },
      },
      {
        id: 'samples',
        label: 'Samples',
        width: columnWidths.samples ?? 150,
        sortable: true,
        defaultSortDirection: 'desc',
        visible: columnVisibility.samples !== false,
        className: 'text-right',
        headerTooltip:
          'Physical samples. MAG catalogues hold one row per genome bin, so this counts the sample behind them, not the bins.',
        renderCell: (s) => <span className="font-mono tabular-nums">{num(s.sample_count)}</span>,
      },
      {
        id: 'genomes',
        label: 'Genomes',
        width: columnWidths.genomes ?? 135,
        sortable: true,
        defaultSortDirection: 'desc',
        visible: columnVisibility.genomes === true,
        className: 'text-right',
        headerTooltip: 'MAG, SAG and isolate genomes. Metagenome assemblies are not counted.',
        // A dash, not 0: a metagenome-only study has no genomes to count.
        renderCell: (s) =>
          s.genome_count > 0 ? (
            <span className="font-mono tabular-nums">{num(s.genome_count)}</span>
          ) : (
            <span className="text-xs text-muted-foreground">—</span>
          ),
      },
      {
        id: 'total',
        label: 'BGCs',
        width: columnWidths.total ?? 115,
        sortable: true,
        defaultSortDirection: 'desc',
        visible: columnVisibility.total !== false,
        className: 'text-right',
        renderCell: (s) => <span className="font-mono tabular-nums">{num(s.total_bgcs)}</span>,
      },
      {
        id: 'complete',
        label: 'Complete',
        width: columnWidths.complete ?? 155,
        sortable: true,
        defaultSortDirection: 'desc',
        visible: columnVisibility.complete === true,
        className: 'text-right',
        headerTooltip: 'BGCs not truncated at a contig edge.',
        renderCell: (s) => (
          <span
            className="font-mono tabular-nums"
            title={s.pct_complete == null ? undefined : `${s.pct_complete.toFixed(1)}% of the study's BGCs`}
          >
            {num(s.complete_bgcs)}
          </span>
        ),
      },
      {
        id: 'distinct',
        label: 'GCFs',
        width: columnWidths.distinct ?? 115,
        sortable: true,
        defaultSortDirection: 'desc',
        visible: columnVisibility.distinct !== false,
        className: 'text-right',
        headerTitle:
          'Gene-cluster families with a member in this study. Bounded by how much of the study clustered at all: see % clustered, under Columns or in the row expander.',
        renderCell: (s) => <span className="font-mono tabular-nums">{num(s.distinct_gcfs)}</span>,
      },
      {
        id: 'coverage',
        label: '% clustered',
        width: columnWidths.coverage ?? 145,
        sortable: true,
        defaultSortDirection: 'desc',
        visible: columnVisibility.coverage === true,
        className: 'text-right',
        headerTooltip:
          "Share of the study's BGCs placed in a gene-cluster family. The rest are mostly too short to cluster, not novel.",
        renderCell: (s) =>
          s.gcf_coverage == null ? (
            <span className="text-xs text-muted-foreground">—</span>
          ) : (
            <span className="font-mono tabular-nums">{(s.gcf_coverage * 100).toFixed(1)}%</span>
          ),
      },
      {
        id: 'exclusive',
        label: 'Exclusive GCFs',
        width: columnWidths.exclusive ?? 160,
        sortable: true,
        defaultSortDirection: 'desc',
        visible: columnVisibility.exclusive !== false,
        className: 'text-right',
        headerTitle:
          'Gene-cluster families found only in this study. Bounded by how much of the study clustered at all: see % clustered, under Columns or in the row expander.',
        renderCell: (s) => (
          <span className="font-mono font-medium tabular-nums text-brand">{num(s.exclusive_gcfs)}</span>
        ),
      },
      {
        id: 'datasetType',
        label: 'BGCs by assembly type',
        headerTitle:
          "Share of the study's BGCs by the kind of assembly they were found in. Each BGC is in one assembly, so the shares sum to 100%.",
        width: columnWidths.datasetType ?? 190,
        sortable: false,
        visible: columnVisibility.datasetType !== false,
        renderCell: (s) => {
          const shares = toShares(s.source_type_dist);
          if (!shares) return <span className="text-xs text-muted-foreground">—</span>;
          return (
            <div className="w-full px-1">
              <BiomeDistributionChart
                distribution={shares}
                height={24}
                getColor={getSourceTypeColor}
                formatLabel={sourceTypeLabel}
                ariaLabel="BGCs by assembly type"
              />
            </div>
          );
        },
      },
      {
        id: 'products',
        label: 'Composition',
        width: columnWidths.products ?? 150,
        sortable: false,
        visible: columnVisibility.products === true,
        renderCell: (s) => {
          const shares = toShares(s.product_category_dist);
          if (!shares) return <span className="text-xs text-muted-foreground">—</span>;
          return (
            <div className="w-full px-1">
              <ProductCategoryChart distribution={shares} height={24} />
            </div>
          );
        },
      },
      {
        id: 'environment',
        label: 'GOLD Ecosystem',
        headerTooltip: "Share of the study's samples per GOLD ecosystem. L1 is broadest, L3 most specific.",
        width: columnWidths.environment ?? 225,
        // Not a column on study_bgc_summary, so there is nothing to ORDER BY.
        sortable: false,
        visible: columnVisibility.environment !== false,
        // headerControl, not renderHeader, which replaces the sort button too.
        headerControl: () => (
          <Select value={String(ecosystemLevel)} onValueChange={(v) => setEcosystemLevel(Number(v))}>
            <SelectTrigger className="h-6 w-16 px-2 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="1">L1</SelectItem>
              <SelectItem value="2">L2</SelectItem>
              <SelectItem value="3">L3</SelectItem>
            </SelectContent>
          </Select>
        ),
        renderCell: (s) => {
          const dist = s.ecosystem_dist_by_level?.[ecosystemLevel];
          // Blank, not "Unclassified": a GOLD path ending early is missing annotation.
          if (!dist || Object.keys(dist).length === 0) {
            return <span className="text-xs text-muted-foreground">—</span>;
          }
          return (
            <div className="w-full px-1">
              <BiomeDistributionChart distribution={dist} height={24} />
            </div>
          );
        },
      },
      {
        id: 'source',
        label: 'Source',
        headerTitle: "The data collections the study's samples were loaded from.",
        width: columnWidths.source ?? 205,
        sortable: false,
        visible: columnVisibility.source !== false,
        renderCell: (s) => (
          <SampleDataSourceLinks names={s.data_sources} studyAccession={s.accession} />
        ),
      },
    ],
    [columnVisibility, columnWidths, expandedStudies, ecosystemLevel]
  );

  // Rendered above the table as well as below it, as on /gcfs, so a reader can
  // page without scrolling to the end.
  const pagination = (
    <Pagination
      currentPage={page}
      totalPages={totalPages}
      totalItems={total}
      offset={page * pageSize}
      pageSize={pageSize}
      onPageChange={setPage}
      onPageSizeChange={(size) => {
        setPageSize(size);
        setPage(0);
      }}
    />
  );

  return (
    <MainLayout>
      <div className="w-full py-8">
        <header className="mb-5">
          <h1 className="atlas-rule mb-3 text-2xl font-semibold tracking-tight md:text-3xl">Studies</h1>
          <p className="text-sm text-muted-foreground">
            Every sample in the Atlas that belongs to a published study or project.
          </p>
        </header>

        <div className="mb-4 flex flex-wrap items-center gap-3">
          <div className="relative min-w-[280px] flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Search title, center, accession, BioProject…"
              className="pl-9"
            />
          </div>
          <Button
            variant={hasAdvancedFiltersApplied ? 'default' : 'outline'}
            size="sm"
            onClick={() => setAdvancedFiltersOpen(true)}
          >
            <Filter className="size-3.5" />
            {hasAdvancedFiltersApplied
              ? `Advanced (${advancedFilterSummaries.length})`
              : 'Advanced filters'}
          </Button>
          <ExportMenu
            pageRows={studies.length}
            onPageExport={handleExport}
            total={total}
            exportPath={studyExportPath(listParams)}
            align="start"
          />
          <span className="ml-auto text-sm text-muted-foreground">
            {error ? '—' : hasLoaded ? `${total.toLocaleString()} studies` : 'Loading…'}
          </span>
        </div>

        <AdvancedFilterDrawer
          open={advancedFiltersOpen}
          onOpenChange={setAdvancedFiltersOpen}
          fields={studyFilterFields}
          recipes={studyFilterRecipes}
          storageKey="study-advanced-filters"
          draft={advancedFiltersDraft}
          onDraftChange={setAdvancedFiltersDraft}
          onApply={applyAdvancedFilters}
          onClear={clearAdvancedFilters}
          hasDraft={hasDraftAdvancedFilters}
          hasApplied={hasAdvancedFiltersApplied}
          appliedCount={advancedFilterSummaries.length}
        />

        <FilterChips
          className="mb-4"
          filters={[
            ...(search
              ? [{
                  key: 'search',
                  label: 'Search',
                  value: search,
                  onRemove: () => {
                    setSearchInput('');
                    setSearch('');
                    setPage(0);
                  },
                }]
              : []),
            ...advancedFilterSummaries.map((summary, index) => ({
              key: `advanced-${index}`,
              label: 'Advanced',
              value: summary,
              // Rules are edited in the drawer, so a chip clears the whole set.
              onRemove: clearAdvancedFilters,
            })),
          ]}
          onClearAll={hasActiveFilters ? clearFilters : undefined}
        />

        {error ? (
          <div className="py-12 text-center">
            <AlertCircle className="mx-auto mb-4 size-8 text-destructive" />
            <h3 className="mb-1 text-base font-semibold">Failed to load studies</h3>
            <p className="mb-4 text-sm text-muted-foreground">{error.message}</p>
            <Button variant="outline" size="sm" onClick={() => window.location.reload()}>
              Retry
            </Button>
          </div>
        ) : showSkeleton ? (
          <div className="space-y-6">
            <ColdLoadHint loading label="Loading studies" />
            <TableSkeleton rows={Math.min(pageSize, 10)} columns={10} />
          </div>
        ) : studies.length === 0 ? (
          <EmptyState
            title="No studies found"
            description={
              hasActiveFilters
                ? 'No studies match your search criteria. Try adjusting your filters or search terms.'
                : 'No studies are available yet.'
            }
            action={hasActiveFilters ? { label: 'Clear filters', onClick: clearFilters } : undefined}
          />
        ) : (
          <RefetchFrame refetching={isFetching} label="Updating studies">
            {/* On the desktop table a legend shows only while its column does. The
                narrow-screen rows carry the composition strip and an ecosystem dot,
                so those two legends always show there. */}
            <div className="mb-4 space-y-3 border-b border-border pb-4">
              <div className={showDatasetLegend ? 'hidden lg:block' : 'hidden'}>
                <SourceTypeLegend />
              </div>
              <div className={showCategoryLegend ? '' : 'lg:hidden'}>
                <ProductCategoryLegend />
              </div>
              <div className={showEcosystemLegend ? '' : 'lg:hidden'}>
                <EcosystemLegend level={ecosystemLevel} />
              </div>
            </div>
            <div className="mb-4">{pagination}</div>
            <ul className="border-t lg:hidden">
              {studies.map((s) => (
                <StudyRow key={s.study_key} study={s} />
              ))}
            </ul>
            {/* ResizableTable has its own scroll container; do not wrap it in another. */}
            <div className="hidden lg:block">
              <ResizableTable
                columns={columns}
                data={studies}
                onSort={handleSort}
                onColumnReorder={handleColumnReorder}
                onColumnResize={handleColumnResize}
                onColumnVisibilityChange={handleColumnVisibilityChange}
                sortColumn={sortField}
                sortDirection={sortOrder}
                renderExpandedRow={(s: Study) =>
                  expandedStudies.has(s.study_id) ? <StudyDetailsPanel study={s} /> : null
                }
                className="min-w-full"
                emptyState={
                  <div className="py-12 text-center text-muted-foreground">No studies match your filters.</div>
                }
              />
            </div>
          </RefetchFrame>
        )}

        {!error && hasLoaded && total > 0 && <div className="mt-4">{pagination}</div>}
      </div>
    </MainLayout>
  );
}
