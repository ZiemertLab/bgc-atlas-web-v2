"use client";

import { withBase } from "@/lib/basePath";
import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { MainLayout } from '@/components/layout/main-layout';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ResizableTable } from '@/components/ui/resizable-table';
import { KnownClusterCell } from '@/components/ui/known-cluster-cell';
import { Search, Filter, Loader2, ArrowUpRight } from 'lucide-react';
import { Pagination } from '@/components/ui/pagination';
import { BgcSourceCell } from '@/components/tables/bgc-table/bgc-source-cell';
import { handleDownload as downloadBgcRows } from '@/components/tables/bgc-table/bgc-table-utils';
import { ExportMenu } from '@/components/ui/export-menu';
import type { ExportFormat } from '@/lib/export/format';
import { useDataSourceOptions } from '@/lib/hooks/use-data-source-options';
import { TableSkeleton } from '@/components/ui/loading-skeleton';
import { ColdLoadHint } from '@/components/ui/cold-load-hint';
import { CopyLinkButton } from '@/components/ui/copy-link-button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { FilterChips } from '@/components/ui/filter-chips';
import { BgcCard } from '@/components/ui/bgc-card';
import { bgcExportPath, useBgcs, type BgcListItem } from '@/lib/hooks/use-bgcs';
import type { TableColumn } from '@/components/ui/resizable-table';
import { useStatistics } from '@/lib/hooks/use-statistics';
import { BgcCharts } from '@/components/statistics/BgcCharts';
import { useSearchParams, usePathname, useRouter } from 'next/navigation';
import { formatGOLDBreadcrumb, getGOLDBadgeClass } from '@/lib/utils/gold-parser';
import { getProductCategoryBadgeStyle, getTaxonomyBadgeStyle } from '@/lib/utils/chart-utils';
import { getTaxonDisplayName, formatTaxonomyBreadcrumb } from '@/lib/utils/taxonomy-utils';
import { sampleBrowseHref, sampleBrowseLabel } from '@/lib/utils/sample-link';
import { GCF_NAME_TOOLTIP } from '@/lib/gcf-naming';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { GOLD_BUCKET_LABEL } from '@/lib/utils/gold-buckets';
import { BiomeLegend } from '@/components/ui/biome-legend';
import { AdvancedFilterDrawer } from '@/components/filters/advanced-filter-drawer';
import { bgcFilterFields } from '@/lib/filters/field-definitions';
import { bgcFilterRecipes } from '@/lib/filters/recipes';
import { hasAnyActiveFilter } from '@/lib/bgc-sort';
import { RefetchFrame } from '@/components/ui/refetch-frame';
import { FilterGroup, createDefaultFilterGroup, deserializeFilterGroup, hasFilterRules, serializeFilterGroup, summarizeFilterGroup } from '@/lib/filters/types';
import {
  advancedFilterRequestParam,
  unreadableAdvancedFilterParam,
} from '@/lib/filters/advanced-filter-param';

export default function BGCsPage() {
  return (
    <Suspense fallback={null}>
      <BGCsPageInner />
    </Suspense>
  );
}

function BGCsPageInner() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // URL filters are seeded on the first render, not by an effect: an effect would
  // first fire an unfiltered /api/bgcs that keeps running server-side after the abort.
  // The effects below still track later URL changes.
  const urlSeed = {
    bgcId: searchParams.get('bgcId') ?? '',
    assembly: searchParams.get('assembly') ?? '',
    gcf: searchParams.get('gcf') ?? '',
    sampleId: searchParams.get('sampleId') ?? '',
    advanced: searchParams.get('advancedFilters') ?? '',
    bbox: (['latMin', 'latMax', 'lonMin', 'lonMax', 'goldBucket'] as const).reduce<{
      latMin?: string; latMax?: string; lonMin?: string; lonMax?: string; goldBucket?: string;
    }>((acc, k) => {
      const v = searchParams.get(k);
      if (v) acc[k] = v;
      return acc;
    }, {}),
  };

  const [currentPage, setCurrentPage] = useState(0);
  const [pageSize, setPageSize] = useState(50);
  const [searchTerm, setSearchTerm] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [sortField, setSortField] = useState<'id' | 'length' | 'genes' | 'contig' | 'sample' | 'gcf' | 'distance' | 'assembly' | 'class' | 'type' | 'completeness' | 'biome'>('length');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [isDefaultSort, setIsDefaultSort] = useState(true);
  const [mounted, setMounted] = useState(false);

  const [filterId, setFilterId] = useState(urlSeed.bgcId);
  const [filterName, setFilterName] = useState('');
  const [filterBiome, setFilterBiome] = useState('');
  const [filterTypeText, setFilterTypeText] = useState('');
  const [filterCompleteness, setFilterCompleteness] = useState('');
  const [filterAssembly, setFilterAssembly] = useState(urlSeed.assembly);
  const [filterGcf, setFilterGcf] = useState(urlSeed.gcf);
  const [filterSampleText, setFilterSampleText] = useState('');
  const [filterSampleId, setFilterSampleId] = useState(urlSeed.sampleId);
  const [filterDataSource, setFilterDataSource] = useState('');
  const [bboxParams, setBboxParams] = useState<{
    latMin?: string; latMax?: string; lonMin?: string; lonMax?: string; goldBucket?: string;
  }>(urlSeed.bbox);
  const [filterTaxonomy, setFilterTaxonomy] = useState('');
  const [filterGoldEcosystem, setFilterGoldEcosystem] = useState('');
  const [lenMin, setLenMin] = useState<string>('');
  const [lenMax, setLenMax] = useState<string>('');
  const [genesMin, setGenesMin] = useState<string>('');
  const [genesMax, setGenesMax] = useState<string>('');
  const [simMin, setSimMin] = useState<string>('');
  const [simMax, setSimMax] = useState<string>('');

  const [taxonomyRank, setTaxonomyRank] = useState<'auto' | 'domain' | 'phylum' | 'class' | 'order' | 'family' | 'genus' | 'species'>('auto');
  const dataSourceOptions = useDataSourceOptions();

  const [, setColumnOrder] = useState(['id', 'assembly', 'source', 'samples', 'class', 'type', 'completeness', 'goldEcosystem', 'taxonomy', 'length', 'genes', 'gcf', 'distance']);
  const [columnVisibility, setColumnVisibility] = useState<Record<string, boolean>>({
    id: true,
    assembly: false,
    source: true,
    samples: true,
    name: false,
    class: true,
    type: true,
    completeness: true,
    goldEcosystem: true,
    taxonomy: true,
    length: true,
    genes: true,
    gcf: true,
    distance: true,
    knownCluster: true,
  });
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>({
    id: 160,
    assembly: 180,
    source: 160,
    samples: 220,
    name: 240,
    class: 160,
    type: 220,
    completeness: 220,
    goldEcosystem: 260,
    taxonomy: 280,
    length: 200,
    genes: 160,
    gcf: 160,
    distance: 200,
    knownCluster: 250,
  });
  const [openingBgcId, setOpeningBgcId] = useState<string | null>(null);

  const [advancedFiltersOpen, setAdvancedFiltersOpen] = useState(false);
  // Seeded on first render like urlSeed; a stray unfiltered fetch here would fall back to PostgreSQL.
  const [advancedFilters, setAdvancedFilters] = useState<FilterGroup | null>(
    () => (urlSeed.advanced ? deserializeFilterGroup(urlSeed.advanced) ?? null : null)
  );
  const [advancedFiltersDraft, setAdvancedFiltersDraft] = useState<FilterGroup>(
    () => (urlSeed.advanced ? deserializeFilterGroup(urlSeed.advanced) ?? createDefaultFilterGroup()
                            : createDefaultFilterGroup())
  );
  const [unreadableAdvancedParam, setUnreadableAdvancedParam] = useState<string | null>(
    () => unreadableAdvancedFilterParam(urlSeed.advanced)
  );

  const hasAdvancedFiltersApplied = hasFilterRules(advancedFilters);
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
    () => (hasAdvancedFiltersApplied && advancedFilters ? summarizeFilterGroup(advancedFilters, bgcFilterFields) : []),
    [advancedFilters, hasAdvancedFiltersApplied]
  );
  const hasDraftAdvancedFilters = hasFilterRules(advancedFiltersDraft);

  useEffect(() => {
    setMounted(true);
  }, []);

  const assemblyFromUrl = searchParams.get('assembly');
  const sampleIdFromUrl = searchParams.get('sampleId');
  const gcfFromUrl = searchParams.get('gcf');
  const bgcIdFromUrl = searchParams.get('bgcId');
  const latMinFromUrl = searchParams.get('latMin');
  const latMaxFromUrl = searchParams.get('latMax');
  const lonMinFromUrl = searchParams.get('lonMin');
  const lonMaxFromUrl = searchParams.get('lonMax');
  const goldBucketFromUrl = searchParams.get('goldBucket');
  // The SQL path ignores 'unknown'.
  const completenessFromUrl = searchParams.get('completeness');
  const advancedFiltersParam = searchParams.get('advancedFilters');
  useEffect(() => {
    if (assemblyFromUrl) {
      setFilterAssembly(assemblyFromUrl);
      setCurrentPage(0);
    }
    if (sampleIdFromUrl) {
      setFilterSampleId(sampleIdFromUrl);
      setCurrentPage(0);
    }
    if (gcfFromUrl) {
      setFilterGcf(gcfFromUrl);
      setCurrentPage(0);
    }
    if (bgcIdFromUrl) {
      setFilterId(bgcIdFromUrl);
      setCurrentPage(0);
    }
    if (completenessFromUrl && ['complete', 'partial', 'unknown'].includes(completenessFromUrl)) {
      setFilterCompleteness(completenessFromUrl);
      setCurrentPage(0);
    }
    const next: { latMin?: string; latMax?: string; lonMin?: string; lonMax?: string; goldBucket?: string } = {};
    if (latMinFromUrl) next.latMin = latMinFromUrl;
    if (latMaxFromUrl) next.latMax = latMaxFromUrl;
    if (lonMinFromUrl) next.lonMin = lonMinFromUrl;
    if (lonMaxFromUrl) next.lonMax = lonMaxFromUrl;
    if (goldBucketFromUrl) next.goldBucket = goldBucketFromUrl;
    setBboxParams(next);
  }, [assemblyFromUrl, sampleIdFromUrl, gcfFromUrl, bgcIdFromUrl, completenessFromUrl, latMinFromUrl, latMaxFromUrl, lonMinFromUrl, lonMaxFromUrl, goldBucketFromUrl]);

  useEffect(() => {
    if (!advancedFiltersParam) {
      setAdvancedFilters(null);
      setUnreadableAdvancedParam(null);
      return;
    }
    const parsed = deserializeFilterGroup(advancedFiltersParam);
    if (parsed) {
      setAdvancedFilters(parsed);
      setAdvancedFiltersDraft(parsed);
      setUnreadableAdvancedParam(null);
    } else {
      setAdvancedFilters(null);
      // Forwarded so the server refuses it; dropping it would answer the whole corpus.
      setUnreadableAdvancedParam(unreadableAdvancedFilterParam(advancedFiltersParam));
    }
  }, [advancedFiltersParam]);

  const updateAdvancedFiltersInUrl = (encoded: string) => {
    if (!pathname) return;
    const params = new URLSearchParams(searchParams.toString());
    if (encoded) {
      params.set('advancedFilters', encoded);
    } else {
      params.delete('advancedFilters');
    }
    const query = params.toString();
    router.replace(`${pathname}${query ? `?${query}` : ''}`, { scroll: false });
  };

  const clearBboxFilters = () => {
    setBboxParams({});
    setCurrentPage(0);
    if (!pathname) return;
    const params = new URLSearchParams(searchParams.toString());
    params.delete('latMin');
    params.delete('latMax');
    params.delete('lonMin');
    params.delete('lonMax');
    params.delete('goldBucket');
    const query = params.toString();
    router.replace(`${pathname}${query ? `?${query}` : ''}`, { scroll: false });
  };

  const applyAdvancedFilters = () => {
    const hasDraftRules = hasFilterRules(advancedFiltersDraft);
    const nextFilters = hasDraftRules ? advancedFiltersDraft : null;
    setAdvancedFilters(nextFilters);
    setUnreadableAdvancedParam(null);
    setAdvancedFiltersOpen(false);
    setCurrentPage(0);
    updateAdvancedFiltersInUrl(serializeFilterGroup(nextFilters));
  };

  const clearAdvancedFilters = () => {
    setAdvancedFilters(null);
    setUnreadableAdvancedParam(null);
    setAdvancedFiltersDraft(createDefaultFilterGroup());
    setAdvancedFiltersOpen(false);
    setCurrentPage(0);
    updateAdvancedFiltersInUrl('');
  };

  function useDebouncedValue<T>(value: T, delay = 500) {
    const [debounced, setDebounced] = useState(value);
    useEffect(() => {
      const t = setTimeout(() => setDebounced(value), delay);
      return () => clearTimeout(t);
    }, [value, delay]);
    return debounced;
  }

  const dSearch = useDebouncedValue(searchTerm);
  const dFilterId = useDebouncedValue(filterId);
  const dFilterName = useDebouncedValue(filterName);
  const dFilterBiome = useDebouncedValue(filterBiome);
  const dFilterTypeText = useDebouncedValue(filterTypeText);
  const dFilterGcf = useDebouncedValue(filterGcf);
  const dFilterAssembly = useDebouncedValue(filterAssembly);
  const dFilterSampleText = useDebouncedValue(filterSampleText);
  const dFilterDataSource = useDebouncedValue(filterDataSource);
  const dFilterTaxonomy = useDebouncedValue(filterTaxonomy);
  const dFilterGoldEcosystem = useDebouncedValue(filterGoldEcosystem);
  const dLenMin = useDebouncedValue(lenMin);
  const dLenMax = useDebouncedValue(lenMax);
  const dGenesMin = useDebouncedValue(genesMin);
  const dGenesMax = useDebouncedValue(genesMax);
  const dSimMin = useDebouncedValue(simMin);
  const dSimMax = useDebouncedValue(simMax);

  const sortParams = isDefaultSort
    ? {
        sortFields: ['length', 'completeness'],
        sortOrders: ['desc', 'desc'] as ('asc' | 'desc')[],
      }
    : {
        sortField,
        sortOrder,
      };

  const narrowingParams = {
    search: dSearch || undefined,
    category: typeFilter || undefined,
    id: dFilterId || undefined,
    name: dFilterName || undefined,
    biome: dFilterBiome || undefined,
    product: dFilterTypeText || undefined,
    completeness: filterCompleteness || undefined,
    assembly: dFilterAssembly || undefined,
    sample: dFilterSampleText || undefined,
    dataSource: dFilterDataSource || undefined,
    sampleId: filterSampleId || undefined,
    latMin: bboxParams.latMin,
    latMax: bboxParams.latMax,
    lonMin: bboxParams.lonMin,
    lonMax: bboxParams.lonMax,
    goldBucket: bboxParams.goldBucket,
    gcf: dFilterGcf || undefined,
    taxonomy: dFilterTaxonomy || undefined,
    goldEcosystem: dFilterGoldEcosystem || undefined,
    lengthMin: dLenMin ? Number(dLenMin) : undefined,
    lengthMax: dLenMax ? Number(dLenMax) : undefined,
    genesMin: dGenesMin ? Number(dGenesMin) : undefined,
    genesMax: dGenesMax ? Number(dGenesMax) : undefined,
    distanceMin: dSimMin ? Number(dSimMin) : undefined,
    distanceMax: dSimMax ? Number(dSimMax) : undefined,
    advancedFilters: advancedFiltersRequestParam,
  };

  // Taxonomy sorting scans the whole corpus unless something narrows it first.
  const taxonomySortable = hasAnyActiveFilter(narrowingParams);

  // Reset to page 1 when the sent parameters change. Done during render, not in an
  // effect, so no request goes out at the old deep offset.
  const filterSignature = JSON.stringify(narrowingParams);
  const [pagedUnder, setPagedUnder] = useState(filterSignature);
  if (pagedUnder !== filterSignature) {
    setPagedUnder(filterSignature);
    setCurrentPage(0);
  }
  const offset = (pagedUnder === filterSignature ? currentPage : 0) * pageSize;

  const listParams = {
    ...sortParams,
    ...narrowingParams,
  };
  const { data, isLoading, isFetching, error } = useBgcs({
    limit: pageSize,
    offset,
    ...listParams,
  });

  const { data: statisticsData, isLoading: statsLoading } = useStatistics();

  const bgcs = data?.data?.data || [];
  const total = data?.data?.total || 0;
  const totalPages = Math.ceil(total / pageSize);
  const statistics = statisticsData?.data || null;

  // The unfiltered total can start as an overshooting planner estimate; clamp once it is corrected.
  useEffect(() => {
    if (!isLoading && !isFetching && totalPages > 0 && currentPage > totalPages - 1) {
      setCurrentPage(totalPages - 1);
    }
  }, [totalPages, currentPage, isLoading, isFetching]);

  const [showFilters, setShowFilters] = useState<Record<string, boolean>>({});

  const ensureAntismashLink = useCallback((bgc: BgcListItem): string | null => {
    if (!bgc?.antismashRunId) {
      return null;
    }
    const anchorParam = bgc.anchor ? `?anchor=${encodeURIComponent(bgc.anchor)}` : '';
    return withBase(`/antismash/${bgc.antismashRunId}${anchorParam}`);
  }, []);

  const handleBgcClick = useCallback(async (bgc: BgcListItem) => {
    if (!bgc?.antismashRunId) {
      return;
    }

    setOpeningBgcId(bgc.id);
    const href = ensureAntismashLink(bgc);
    setOpeningBgcId(prev => (prev === bgc.id ? null : prev));

    if (href) {
      window.open(href, '_blank', 'noopener,noreferrer');
    }
  }, [ensureAntismashLink]);

  const columns: TableColumn<BgcListItem>[] = useMemo(() => [
    {
      id: 'id',
      label: 'BGC ID',
      width: columnWidths.id,
      minWidth: 100,
      sortable: true,
      filterable: true,
      filterType: 'text' as const,
      visible: columnVisibility.id,
      renderCell: (bgc: BgcListItem) => {
        return (
          <div className="flex items-center gap-2">
            <a
              href={withBase(`/bgcs/${bgc.id}`)}
              className="inline-flex items-center gap-0.5 font-mono text-xs text-foreground underline underline-offset-2 decoration-foreground/50 hover:decoration-foreground"
              title={bgc.id}
            >
              {bgc.id.slice(0, 8)}...
              <ArrowUpRight className="h-3 w-3" aria-hidden="true" />
            </a>
          </div>
        );
      }
    },
    {
      id: 'assembly',
      label: 'Assembly',
      width: columnWidths.assembly,
      minWidth: 100,
      sortable: true,
      filterable: true,
      filterType: 'text' as const,
      visible: columnVisibility.assembly,
      renderCell: (bgc: BgcListItem) => {
        if (!bgc?.antismashRunId) {
          return (
            <span className="font-mono text-sm" title={bgc.assemblyDisplay || ''}>
              {bgc.assemblyDisplay || '—'}
            </span>
          );
        }

        const isLoading = openingBgcId === bgc.id;

        return (
          <button
            type="button"
            onClick={() => handleBgcClick(bgc)}
            className="inline-flex items-center gap-2 font-mono text-sm text-foreground underline underline-offset-2 decoration-foreground/50 hover:decoration-foreground disabled:pointer-events-none cursor-pointer"
            title={bgc.assemblyDisplay || ''}
            disabled={isLoading}
          >
            {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            <span>{bgc.assemblyDisplay || bgc.assembly}</span>
          </button>
        );
      }
    },
    {
      id: 'source',
      label: 'Source',
      width: columnWidths.source ?? 160,
      minWidth: 100,
      sortable: false,
      filterable: true,
      filterType: 'select' as const,
      filterOptions: dataSourceOptions,
      visible: columnVisibility.source ?? true,
      renderCell: (bgc: BgcListItem) => (
        <BgcSourceCell
          dataSourceNames={bgc.dataSourceNames}
          sampleExternalId={Array.isArray(bgc.sampleLabels) ? bgc.sampleLabels[0] ?? null : null}
        />
      )
    },
    {
      id: 'samples',
      label: 'Sample',
      width: columnWidths.samples,
      minWidth: 140,
      sortable: false,
      filterable: true,
      filterType: 'text' as const,
      visible: columnVisibility.samples,
      renderCell: (bgc: BgcListItem) => {
        const ids: string[] = Array.isArray(bgc.sampleIds) ? bgc.sampleIds : [];
        const labels: string[] = Array.isArray(bgc.sampleLabels) ? bgc.sampleLabels : [];
        if (ids.length === 0) return <span className="text-muted-foreground">—</span>;

        const items = ids.slice(0, 3).map((id, i) => ({
          id,
          label: labels[i] || id,
        }));

        // A MAG/SAG/isolate sample lives on Genome Collections, not the Metagenomes page.
        const pageLabel = sampleBrowseLabel(bgc.assemblySourceType);

        return (
          <div className="flex flex-wrap gap-1">
            {items.map(({ id, label }) => (
              <a
                key={id}
                href={withBase(sampleBrowseHref(id, bgc.assemblySourceType))}
                className="inline-flex items-center rounded bg-muted px-1.5 py-0.5 text-xs text-foreground underline underline-offset-2 decoration-foreground/50 hover:decoration-foreground"
                target="_blank" rel="noopener noreferrer"
                title={`Open ${pageLabel} filtered to ${label}`}
              >
                {label}
              </a>
            ))}
            {ids.length > 3 ? (
              <span className="text-xs text-muted-foreground">+{ids.length - 3} more</span>
            ) : null}
          </div>
        );
      }
    },
    {
      id: 'class',
      label: 'Category',
      width: columnWidths.class,
      minWidth: 100,
      sortable: true,
      filterable: true,
      filterType: 'select' as const,
      filterOptions: [
        { label: 'NRPS', value: 'NRPS' },
        { label: 'PKS', value: 'PKS' },
        { label: 'RiPP', value: 'RiPP' },
        { label: 'terpene', value: 'terpene' },
        { label: 'saccharide', value: 'saccharide' },
        { label: 'other', value: 'other' },
        { label: 'Hybrid', value: 'Hybrid' }
      ],
      visible: columnVisibility.class,
      renderCell: (bgc: BgcListItem) => {
        if (!bgc.category) return <span className="text-muted-foreground">—</span>;

        if (bgc.category === 'Hybrid' && Array.isArray(bgc.categories) && bgc.categories.length > 0) {
          return (
            <div className="flex flex-wrap gap-1">
              {bgc.categories.map((t: string, i: number) => (
                <Badge 
                  key={`${bgc.id}-t-${i}`} 
                  variant="secondary" 
                  style={getProductCategoryBadgeStyle(t)}
                >
                  {t}
                </Badge>
              ))}
            </div>
          );
        }

        return (
          <Badge 
            variant="secondary" 
            style={getProductCategoryBadgeStyle(bgc.category)}
          >
            {bgc.category}
          </Badge>
        );
      }
    },
    {
      id: 'type',
      label: 'Product',
      width: columnWidths.type,
      minWidth: 120,
      sortable: true,
      filterable: true,
      filterType: 'text' as const,
      visible: columnVisibility.type,
      renderCell: (bgc: BgcListItem) => {
        if (!Array.isArray(bgc.products) || bgc.products.length === 0) {
          return <span className="text-muted-foreground">—</span>;
        }

        return (
          <div className="flex flex-wrap gap-1">
            {bgc.products.map((pt: string, i: number) => (
              <Badge key={`${bgc.id}-pt-${i}`} variant="secondary">{pt}</Badge>
            ))}
          </div>
        );
      }
    },
    {
      id: 'completeness',
      label: 'Completeness',
      headerTooltip: 'antiSMASH completeness prediction',
      width: columnWidths.completeness,
      minWidth: 120,
      sortable: true,
      filterable: true,
      filterType: 'select' as const,
      filterOptions: [
        { label: 'complete', value: 'complete' },
        { label: 'partial', value: 'partial' },
        { label: 'unknown', value: 'unknown' }
      ],
      visible: columnVisibility.completeness,
      renderCell: (bgc: BgcListItem) => (
        <span className="text-sm">{bgc.completeness || '—'}</span>
      )
    },
    {
      id: 'goldEcosystem',
      label: 'GOLD Ecosystem',
      width: columnWidths.goldEcosystem || 240,
      minWidth: 200,
      sortable: false,
      filterable: true,
      filterType: 'text' as const,
      visible: columnVisibility.goldEcosystem ?? true,
      renderCell: (bgc: BgcListItem) => {
        const path = bgc.goldEcosystemPath;
        if (!path) {
          return <span className="text-sm text-muted-foreground">-</span>;
        }

        const breadcrumb = formatGOLDBreadcrumb(path);
        const colorClass = getGOLDBadgeClass(path);

        return (
          <div className="max-w-full">
            <Badge
              variant="secondary"
              className={`text-xs ${colorClass} max-w-full whitespace-normal h-auto`}
              title={path}
            >
              {breadcrumb}
            </Badge>
          </div>
        );
      }
    },
    {
      id: 'taxonomy',
      label: 'Taxonomy',
      headerControl: () => (
        <Select
          value={taxonomyRank}
          onValueChange={(value) => setTaxonomyRank(value as 'auto' | 'domain' | 'phylum' | 'class' | 'order' | 'family' | 'genus' | 'species')}
        >
          <SelectTrigger className="h-6 w-auto min-w-20 text-xs px-2">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="auto">Auto</SelectItem>
            <SelectItem value="domain">Domain</SelectItem>
            <SelectItem value="phylum">Phylum</SelectItem>
            <SelectItem value="class">Class</SelectItem>
            <SelectItem value="order">Order</SelectItem>
            <SelectItem value="family">Family</SelectItem>
            <SelectItem value="genus">Genus</SelectItem>
            <SelectItem value="species">Species</SelectItem>
          </SelectContent>
        </Select>
      ),
      headerTooltip: taxonomySortable
        ? "Taxonomic classification from GTDB. 'Auto' shows the most specific rank available."
        : "Taxonomic classification from GTDB. 'Auto' shows the most specific rank available.",
      width: columnWidths.taxonomy || 280,
      minWidth: 240,
      // Scan-heavy: no index supplies this order (see lib/bgc-sort.ts).
      sortable: taxonomySortable,
      filterable: true,
      filterType: 'text' as const,
      visible: columnVisibility.taxonomy ?? true,
      renderCell: (bgc: BgcListItem) => {
        let taxon: string | null = null;

        if (taxonomyRank === 'auto') {
          taxon = bgc.taxonomySpecies || bgc.taxonomyGenus || bgc.taxonomyFamily ||
                  bgc.taxonomyOrder || bgc.taxonomyClass || bgc.taxonomyPhylum ||
                  bgc.taxonomyDomain;
        } else {
          const rankMap = {
            domain: bgc.taxonomyDomain,
            phylum: bgc.taxonomyPhylum,
            class: bgc.taxonomyClass,
            order: bgc.taxonomyOrder,
            family: bgc.taxonomyFamily,
            genus: bgc.taxonomyGenus,
            species: bgc.taxonomySpecies,
          };
          taxon = rankMap[taxonomyRank];
        }

        if (!taxon) {
          return <span className="text-sm text-muted-foreground">-</span>;
        }

        const displayName = getTaxonDisplayName(taxon);

        const lineageParts = bgc.gtdbLineage
          ? formatTaxonomyBreadcrumb(bgc.gtdbLineage)
          : [bgc.taxonomyDomain, bgc.taxonomyPhylum, bgc.taxonomyClass, bgc.taxonomyOrder,
             bgc.taxonomyFamily, bgc.taxonomyGenus, bgc.taxonomySpecies]
              .filter((t): t is string => Boolean(t))
              .map((t) => getTaxonDisplayName(t));
        const fullPath = lineageParts.join(' › ') || displayName;

        const badgeStyle = getTaxonomyBadgeStyle(taxonomyRank, bgc.taxonomyPhylum, bgc.taxonomyDomain);

        return (
          <div className="max-w-full">
            <Tooltip>
              <TooltipTrigger asChild>
                <Badge
                  variant={badgeStyle ? 'secondary' : 'outline'}
                  className="text-xs max-w-full whitespace-normal h-auto"
                  style={badgeStyle}
                >
                  {displayName}
                </Badge>
              </TooltipTrigger>
              <TooltipContent className="max-w-[440px]">
                <p className="text-xs leading-relaxed">{fullPath}</p>
              </TooltipContent>
            </Tooltip>
          </div>
        );
      }
    },
    {
      id: 'length',
      label: 'Length (bp)',
      width: columnWidths.length,
      minWidth: 100,
      sortable: true,
      defaultSortDirection: 'desc',
      filterable: true,
      filterType: 'range' as const,
      visible: columnVisibility.length,
      className: 'text-right',
      renderCell: (bgc: BgcListItem) => (
        <span className="font-mono text-sm">{(bgc.length || 0).toLocaleString()}</span>
      )
    },
    {
      id: 'genes',
      label: 'Genes',
      width: columnWidths.genes,
      minWidth: 80,
      sortable: true,
      defaultSortDirection: 'desc',
      filterable: true,
      filterType: 'range' as const,
      visible: columnVisibility.genes,
      className: 'text-center',
      renderCell: (bgc: BgcListItem) => (
        <span>{bgc.genes || 0}</span>
      )
    },
    {
      id: 'gcf',
      label: 'GCF',
      headerTooltip: GCF_NAME_TOOLTIP,
      width: columnWidths.gcf,
      minWidth: 80,
      sortable: true,
      filterable: true,
      filterType: 'text' as const,
      visible: columnVisibility.gcf,
      renderCell: (bgc: BgcListItem) => (
        bgc.gcf ? (
          <a
            href={withBase(`/gcfs/${encodeURIComponent(String(bgc.gcf))}`)}
            className="text-sm text-foreground underline underline-offset-2 decoration-foreground/50 hover:decoration-foreground"
            target="_blank"
            rel="noopener noreferrer"
            title={`View GCF ${bgc.gcfName || bgc.gcf}`}
          >
            {bgc.gcfName || bgc.gcf}
          </a>
        ) : (
          <span className="text-sm text-muted-foreground">Unclustered</span>
        )
      )
    },
    {
      id: 'knownCluster',
      label: 'KnownClusterBLAST',
      headerTooltip:
        'Closest characterized MIBiG cluster by antiSMASH KnownClusterBLAST, with its '
        + 'similarity. Only hits at 50% or above are shown — below that the field is '
        + 'mostly a couple of genes matching by chance. This is homology for THIS '
        + 'region, not the family-level MIBiG relative on /gcfs.',
      width: columnWidths.knownCluster,
      minWidth: 120,
      // Fetched per page from bgc_facets; bgc_browse, which answers the query, lacks the field.
      sortable: false,
      visible: columnVisibility.knownCluster,
      renderCell: (bgc: BgcListItem) =>
        bgc.knownCluster ? (
          <KnownClusterCell
            compound={bgc.knownCluster.compound}
            accession={bgc.knownCluster.accession}
            similarity={bgc.knownCluster.similarity}
          />
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        ),
    },
    {
      id: 'distance',
      label: 'GCF Distance',
      headerTooltip: 'BiG-SLiCE distance of this BGC to its gene cluster family (lower = more similar / closer).',
      width: columnWidths.distance,
      minWidth: 100,
      sortable: true,
      filterable: true,
      filterType: 'range' as const,
      visible: columnVisibility.distance,
      className: 'text-right',
      renderCell: (bgc: BgcListItem) => (
        <span className={`font-mono tabular-nums ${typeof bgc.distance === 'number' ? 'text-foreground' : 'text-muted-foreground'}`}>
          {typeof bgc.distance === 'number' ? bgc.distance.toFixed(3) : '—'}
        </span>
      )
    }
  ], [taxonomyRank, columnWidths, columnVisibility, dataSourceOptions, taxonomySortable, handleBgcClick, openingBgcId]);

  const handleDownload = (format: ExportFormat) => {
    downloadBgcRows(format, bgcs, currentPage);
  };

  const handleSort = (columnId: string, direction: 'asc' | 'desc') => {
    setSortField(columnId as typeof sortField);
    setSortOrder(direction);
    setIsDefaultSort(columnId === 'length' && direction === 'desc');
    setCurrentPage(0);
  };

  const handleColumnReorder = (newOrder: string[]) => {
    setColumnOrder(newOrder);
  };

  const handleColumnResize = (columnId: string, width: number) => {
    setColumnWidths(prev => ({ ...prev, [columnId]: width }));
  };

  const handleColumnVisibilityChange = (columnId: string, visible: boolean) => {
    setColumnVisibility(prev => ({ ...prev, [columnId]: visible }));
  };

  const handleFilterToggle = (columnId: string, show: boolean) => {
    setShowFilters(prev => ({ ...prev, [columnId]: show }));
  };

  const handleFilterChange = (columnId: string, value: unknown) => {
    const str = typeof value === 'string' ? value : '';
    const range = (value && typeof value === 'object' ? value : {}) as { min?: string; max?: string };
    switch (columnId) {
      case 'id':
        setFilterId(str);
        break;
      case 'assembly':
        setFilterAssembly(str);
        break;
      case 'name':
        setFilterName(str);
        break;
      case 'class':
        setTypeFilter(str);
        setCurrentPage(0);
        break;
      case 'type':
        setFilterTypeText(str);
        break;
      case 'completeness':
        setFilterCompleteness(str);
        setCurrentPage(0);
        break;
      case 'biome':
        setFilterBiome(str);
        break;
      case 'taxonomy':
        setFilterTaxonomy(str);
        break;
      case 'goldEcosystem':
        setFilterGoldEcosystem(str);
        break;
      case 'length':
        setLenMin(range.min ?? '');
        setLenMax(range.max ?? '');
        break;
      case 'genes':
        setGenesMin(range.min ?? '');
        setGenesMax(range.max ?? '');
        break;
      case 'gcf':
        setFilterGcf(str);
        break;
      case 'samples':
        setFilterSampleText(str);
        break;
      case 'source':
        setFilterDataSource(str);
        break;
      case 'distance':
        setSimMin(range.min ?? '');
        setSimMax(range.max ?? '');
        break;
    }
  };

  const filters = {
    id: filterId,
    assembly: filterAssembly,
    name: filterName,
    class: typeFilter,
    type: filterTypeText,
    completeness: filterCompleteness,
    biome: filterBiome,
    taxonomy: filterTaxonomy,
    goldEcosystem: filterGoldEcosystem,
    length: { min: lenMin, max: lenMax },
    genes: { min: genesMin, max: genesMax },
    gcf: filterGcf,
    samples: filterSampleText,
    source: filterDataSource,
    distance: { min: simMin, max: simMax }
  };

  const resetFilters = () => {
    setSearchTerm('');
    setTypeFilter('');
    setFilterId('');
    setFilterName('');
    setFilterBiome('');
    setFilterTypeText('');
    setFilterCompleteness('');
    setFilterAssembly('');
    setFilterGcf('');
    setFilterSampleText('');
    setFilterDataSource('');
    setFilterTaxonomy('');
    setFilterGoldEcosystem('');
    setLenMin('');
    setLenMax('');
    setGenesMin('');
    setGenesMax('');
    setSimMin('');
    setSimMax('');
    setShowFilters({});
    setSortField('length');
    setSortOrder('desc');
    setIsDefaultSort(true);
    clearAdvancedFilters();
    clearBboxFilters();
    setCurrentPage(0);
  };

  if (!mounted) {
    return (
      <MainLayout>
        <div className="w-full py-8">
          <div className="space-y-4">
            <TableSkeleton rows={10} />
          </div>
        </div>
      </MainLayout>
    );
  }

  const emptyState = (
    <div className="py-10 text-center text-muted-foreground">
      No BGCs found. Adjust or
      <Button variant="link" className="px-1" onClick={resetFilters}>reset filters</Button>.
    </div>
  );

  const fmt = (value?: number | null): string =>
    statsLoading ? '—' : (value ?? 0).toLocaleString();

  const filterChipsList = [
    ...(searchTerm
      ? [
          {
            key: 'search',
            label: 'Search',
            value: searchTerm,
            onRemove: () => {
              setSearchTerm('');
              setCurrentPage(0);
            },
          },
        ]
      : []),
    ...(typeFilter
      ? [
          {
            key: 'class',
            label: 'Category',
            value: typeFilter,
            onRemove: () => {
              setTypeFilter('');
              setCurrentPage(0);
            },
          },
        ]
      : []),
    ...((bboxParams.latMin || bboxParams.latMax || bboxParams.lonMin || bboxParams.lonMax || bboxParams.goldBucket)
      ? [
          {
            key: 'area',
            label: bboxParams.goldBucket && !(bboxParams.latMin || bboxParams.latMax || bboxParams.lonMin || bboxParams.lonMax)
              ? 'Ecosystem'
              : 'Area',
            value: (() => {
              const parts: string[] = [];
              if (bboxParams.latMin || bboxParams.latMax) {
                parts.push(`lat ${bboxParams.latMin ?? '−∞'}…${bboxParams.latMax ?? '∞'}`);
              }
              if (bboxParams.lonMin || bboxParams.lonMax) {
                parts.push(`lon ${bboxParams.lonMin ?? '−∞'}…${bboxParams.lonMax ?? '∞'}`);
              }
              if (bboxParams.goldBucket) {
                parts.push(
                  GOLD_BUCKET_LABEL[bboxParams.goldBucket as keyof typeof GOLD_BUCKET_LABEL] ?? bboxParams.goldBucket
                );
              }
              return parts.join(', ');
            })(),
            onRemove: clearBboxFilters,
          },
        ]
      : []),
    ...(hasAdvancedFiltersApplied
      ? advancedFilterSummaries.map((summary, index) => ({
          key: `advanced-${index}`,
          label: 'Advanced',
          value: summary,
          onRemove: clearAdvancedFilters,
        }))
      : []),
  ];

  return (
    <MainLayout>
      <div className="w-full py-6">
        <header className="mb-6 border-b border-border pb-4">
          <h1 className="atlas-rule mb-3 text-2xl font-semibold tracking-tight md:text-3xl">
            Biosynthetic gene clusters
          </h1>
          <p className="mt-3 max-w-3xl text-[14px] leading-relaxed text-muted-foreground">
            Predicted BGCs from metagenomic assemblies and genome collections.
          </p>
        </header>

        <section className="mb-6 border-b border-border pb-4">
          {/* One column on phones: two leader rows with 7-digit values clip. */}
          <dl className="grid grid-cols-1 gap-x-8 gap-y-2 text-sm sm:grid-cols-3 lg:grid-cols-5">
            <div className="leader-row">
              <dt className="whitespace-nowrap text-muted-foreground">Total BGCs</dt>
              <span className="leader-dots" aria-hidden />
              <dd className="font-mono font-medium tabular-nums text-foreground">
                {fmt(statistics?.totalBgcs)}
              </dd>
            </div>
            <div className="leader-row">
              <dt className="whitespace-nowrap text-muted-foreground">Complete BGCs</dt>
              <span className="leader-dots" aria-hidden />
              <dd className="font-mono font-medium tabular-nums text-foreground">
                {fmt(statistics?.totalCompleteBgcs)}
              </dd>
            </div>
            <div className="leader-row">
              <dt className="whitespace-nowrap text-muted-foreground">GCFs</dt>
              <span className="leader-dots" aria-hidden />
              <dd className="font-mono font-medium tabular-nums text-foreground">
                {fmt(statistics?.totalGcfs)}
              </dd>
            </div>
            <div className="leader-row">
              <dt className="whitespace-nowrap text-muted-foreground">Samples</dt>
              <span className="leader-dots" aria-hidden />
              <dd className="font-mono font-medium tabular-nums text-foreground">
                {fmt(statistics?.totalSamples)}
              </dd>
            </div>
            <div className="leader-row">
              <dt className="whitespace-nowrap text-muted-foreground">Assemblies</dt>
              <span className="leader-dots" aria-hidden />
              <dd className="font-mono font-medium tabular-nums text-foreground">
                {fmt(statistics?.totalAssemblies)}
              </dd>
            </div>
          </dl>
        </section>

        <section className="mb-8 space-y-8">
          {/* No taxonomy heatmap here: shares of BGCs per taxon mostly reflect which
              organisms the corpus holds, not biosynthesis. As the grid's only child,
              BgcCharts lays its two cards side by side. */}
          <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
            <BgcCharts
              staticManifestUrl="/data/bgc-charts.manifest.json"
              params={narrowingParams}
              filtered={hasAnyActiveFilter(narrowingParams)}
            />
          </div>
        </section>

        <section className="mb-3">
          <div className="section-label mb-2.5">Filter</div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-[260px] flex-1 sm:max-w-xl">
              <Search
                aria-hidden
                className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
              />
              <Input
                placeholder="Search BGCs by contig, sample, category or product…"
                className="h-8 pl-7 text-[13px]"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                aria-label="Search BGCs"
              />
            </div>

            <Select
              value={typeFilter || 'all'}
              onValueChange={(val) => {
                setTypeFilter(val === 'all' ? '' : val);
                setCurrentPage(0);
              }}
            >
              <SelectTrigger
                id="classFilter"
                aria-label="Category filter"
                className="h-8 w-[160px] text-[13px]"
              >
                <SelectValue placeholder="All categories" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All categories</SelectItem>
                <SelectItem value="NRPS">NRPS</SelectItem>
                <SelectItem value="PKS">PKS</SelectItem>
                <SelectItem value="RiPP">RiPP</SelectItem>
                <SelectItem value="terpene">Terpene</SelectItem>
                <SelectItem value="saccharide">Saccharide</SelectItem>
                <SelectItem value="other">Other</SelectItem>
                <SelectItem value="Hybrid">Hybrid</SelectItem>
              </SelectContent>
            </Select>

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

            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setSearchTerm('');
                setTypeFilter('');
                setCurrentPage(0);
                clearAdvancedFilters();
              }}
            >
              Clear
            </Button>

            <CopyLinkButton className="ml-auto" />

            <ExportMenu
              pageRows={bgcs.length}
              onPageExport={handleDownload}
              total={data?.data?.total ?? 0}
              exportPath={bgcExportPath(listParams)}
            />
          </div>
        </section>

        <FilterChips
          className="mb-4"
          filters={filterChipsList}
          onClearAll={() => {
            setSearchTerm('');
            setTypeFilter('');
            clearAdvancedFilters();
            clearBboxFilters();
            setCurrentPage(0);
          }}
        />

        <AdvancedFilterDrawer
          open={advancedFiltersOpen}
          onOpenChange={setAdvancedFiltersOpen}
          fields={bgcFilterFields}
          recipes={bgcFilterRecipes}
          storageKey="bgc-advanced-filters"
          draft={advancedFiltersDraft}
          onDraftChange={setAdvancedFiltersDraft}
          onApply={applyAdvancedFilters}
          onClear={clearAdvancedFilters}
          hasDraft={hasDraftAdvancedFilters}
          hasApplied={hasAdvancedFiltersApplied}
          appliedCount={advancedFilterSummaries.length}
        />

        <section className="w-[min(100vw,2400px)] ml-[calc(50%_-_min(50vw,1200px))] mr-[calc(50%_-_min(50vw,1200px))] px-4 lg:px-8 xl:px-12 2xl:px-16">
          <div className="mb-3 flex items-end justify-between gap-4 border-b border-border pb-2">
            <div>
              <h2 className="mt-0.5 text-sm font-medium">
                Biosynthetic gene clusters
                {!isLoading && total > 0 && (
                  <span className="ml-2 font-mono text-xs font-normal tabular-nums text-muted-foreground">
                    {total.toLocaleString()}
                  </span>
                )}
              </h2>
            </div>
            <BiomeLegend />
          </div>

          {!error && !isLoading && total > 0 && (
            <div className="mb-4">
              <Pagination
                currentPage={currentPage}
                totalPages={totalPages}
                totalItems={total}
                pageSize={pageSize}
                offset={offset}
                onPageChange={(p) => setCurrentPage(p)}
                onPageSizeChange={(s) => {
                  setPageSize(s);
                  setCurrentPage(0);
                }}
                pageSizeOptions={[5, 10, 25, 50, 100]}
              />
            </div>
          )}

          {error ? (
            <div className="py-12 text-center text-sm">
              <p className="font-semibold text-destructive">Failed to load BGCs</p>
              {/* The server's message names the refused filter field and operator. */}
              <p className="mx-auto mt-2 max-w-prose text-muted-foreground">{error.message}</p>
            </div>
          ) : isLoading ? (
            <div className="space-y-6">
              <ColdLoadHint loading label="Loading BGCs" />
              <TableSkeleton rows={Math.min(pageSize, 10)} />
            </div>
          ) : (
            <RefetchFrame refetching={isFetching} label="Updating BGCs">
              <div className="space-y-3 lg:hidden">
                {bgcs.length === 0
                  ? emptyState
                  : bgcs.map((bgc) => <BgcCard key={bgc.id} bgc={bgc} />)}
              </div>
              <div className="hidden lg:block">
                <ResizableTable
                  columns={columns}
                  data={bgcs}
                  onColumnReorder={handleColumnReorder}
                  onColumnResize={handleColumnResize}
                  onColumnVisibilityChange={handleColumnVisibilityChange}
                  onSort={handleSort}
                  sortColumn={sortField}
                  sortDirection={sortOrder}
                  filters={filters}
                  onFilterChange={handleFilterChange}
                  onFilterToggle={handleFilterToggle}
                  showFilters={showFilters}
                  emptyState={emptyState}
                />
              </div>
            </RefetchFrame>
          )}
        </section>

        <div className="mt-6 flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
          <Button variant="outline" size="sm" className="shrink-0" onClick={resetFilters}>
            Reset filters
          </Button>
          {/* Gated on !error, or a failed query reads "Showing 1–0 of 0". */}
          {!error && <Pagination
            currentPage={currentPage}
            totalPages={totalPages}
            totalItems={total}
            pageSize={pageSize}
            offset={offset}
            onPageChange={(p) => setCurrentPage(p)}
            onPageSizeChange={(s) => {
              setPageSize(s);
              setCurrentPage(0);
            }}
            pageSizeOptions={[5, 10, 25, 50, 100]}
          />}
        </div>
      </div>
    </MainLayout>
  );
}
