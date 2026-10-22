'use client';

import { apiFetch, withBase } from "@/lib/basePath";
import Link from 'next/link';
import Image from 'next/image';
import { useSearchParams } from 'next/navigation';
import { Suspense, useState, useEffect, Fragment } from 'react';
import { MainLayout } from '@/components/layout/main-layout';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ResizableTable } from '@/components/ui/resizable-table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { InfoTooltip } from '@/components/ui/info-tooltip';
import { getTaxonDisplayName, formatTaxonomyBreadcrumb } from '@/lib/utils/taxonomy-utils';
import { TaxonomyBadge } from '@/components/ui/taxonomy-badge';
import { Search, Loader2, ChevronDown, ChevronRight, ExternalLink, List, Map } from 'lucide-react';
import { sampleExportPath, useSamples } from '@/lib/hooks/use-samples';
import { ExportMenu } from '@/components/ui/export-menu';
import { ListErrorState } from '@/components/ui/list-error-state';
import { downloadText, exportFilename, serializeExport, type ExportFormat } from '@/lib/export/format';
import { GENOME_EXPORT_COLUMNS } from '@/lib/export/sample-columns';
import { StudyScopeChip } from '@/components/ui/study-scope-chip';
import type { Sample } from '@/lib/types';
import type { TableColumn } from '@/components/ui/resizable-table';
import { useStatistics } from '@/lib/hooks/use-statistics';
import { GenomeCharts } from '@/components/statistics/GenomeCharts';
import { SampleCharts } from '@/components/statistics/SampleCharts';
import { TableSkeleton } from '@/components/ui/loading-skeleton';
import { Pagination } from '@/components/ui/pagination';
import { getEnvironmentColor, formatBiomeLabel } from '@/lib/utils/metadata-parser';
import { formatGOLDBreadcrumb, getGOLDBadgeClass } from '@/lib/utils/gold-parser';
import { formatDataSourceName, getDataSourceUrl } from '@/lib/utils/data-source-name';
import { MetadataDetails } from '@/components/ui/metadata-details';
import { AssemblyDetails } from '@/components/ui/assembly-details';
import { SampleEnvironmentalPanel } from '@/components/ui/sample-environmental-panel';
import { SampleStudiesPanel } from '@/components/ui/sample-studies-panel';
import { SampleGenomeQualityPanel } from '@/components/ui/sample-genome-quality-panel';
import {
  completenessBand, contaminationBand, COMPLETENESS_NOTE, CONTAMINATION_NOTE,
  MIMAG_BADGE_CLASS, MIMAG_TEXT_CLASS,
} from '@/lib/utils/mimag';
import { EcosystemLegend } from '@/components/ui/ecosystem-legend';
import { CopyLinkButton } from '@/components/ui/copy-link-button';
import { ColdLoadHint } from '@/components/ui/cold-load-hint';
import { SampleMapDots } from '@/components/ui/sample-map-dots';
import { RefetchFrame } from '@/components/ui/refetch-frame';
import { isDeepPageRefusal, isFilterRefusal } from '@/lib/api-client';
import { useLastKnown } from '@/lib/hooks/use-last-known';
import {
  buildGenomeCollectionDataSourceHref,
  getGenomeCollectionsDefaultColumnVisibility,
} from './genome-collections-table';
import { readNumber, readOneOf, readPage, readPageSize, type UrlEntry } from '@/lib/url-state';
import { useExternalNavigationKey, useMirrorToUrl } from '@/lib/hooks/use-mirror-to-url';
import { FilterChips, type FilterChip } from '@/components/ui/filter-chips';
import { appliedFilterValue, formatAreaLabel, formatRangeLabel, optionLabel } from '@/lib/filter-chip-labels';
import { goldBucketLabel } from '@/lib/utils/gold-buckets';

const formatPercent = (value: number) =>
  value.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 });

export default function GenomeCollectionsPage() {
  return (
    <Suspense fallback={null}>
      <GenomeCollectionsPageKeyed />
    </Suspense>
  );
}

/** Remounts the page on a same-route navigation it did not write, so it re-seeds
 *  from the URL like a fresh visit (see useMirrorToUrl). */
function GenomeCollectionsPageKeyed() {
  const navKey = useExternalNavigationKey();
  return <GenomeCollectionsPageInner key={navKey} />;
}

/** The page sizes both Pagination controls offer; a `size` outside them reads as the default. */
const PAGE_SIZE_OPTIONS = [5, 10, 25, 50, 100];
const DEFAULT_PAGE_SIZE = 50;

/**
 * Every column this table sorts by that /api/samples honours (its sortFieldMap,
 * and the index's sampleSort). A `sort` outside it reads as the default, so the
 * URL never claims an order the server drops.
 */
const GENOME_SORT_FIELDS = [
  'id', 'assemblies', 'bgcs', 'completeness', 'contamination', 'genomeQuality',
  'biome', 'study', 'dataSource',
] as const;
const DEFAULT_SORT_FIELD = 'bgcs';
const DEFAULT_SORT_ORDER = 'desc' as const;

function GenomeCollectionsPageInner() {
  const searchParams = useSearchParams();
  const paramOr = (key: string, fallback = '') => searchParams.get(key) ?? fallback;

  // Every filter, the sort, the paging and the table/map toggle are seeded from
  // the URL in useState initializers, so the first request already carries
  // them. useMirrorToUrl below writes them back and is the page's only URL
  // writer. A same-route navigation it did not write (the nav item's bare
  // /genome-collections, Back to another filtered entry) remounts this component
  // through GenomeCollectionsPageKeyed, so it seeds again from the new URL.
  //
  // Names other pages link with are kept: id (sampleBrowseHref), studyKey (a
  // study's Samples panel and its map), latMin..lonMax (the property-search map,
  // a study map's area). Table vs map is `display`, as on /samples.
  const [currentPage, setCurrentPage] = useState(() => readPage(paramOr('page')));
  const [pageSize, setPageSize] = useState(() =>
    readPageSize(paramOr('size'), PAGE_SIZE_OPTIONS, DEFAULT_PAGE_SIZE),
  );
  const [searchTerm, setSearchTerm] = useState(() => paramOr('search'));
  const [mounted, setMounted] = useState(false);
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const [expandedAssemblies, setExpandedAssemblies] = useState<Set<string>>(new Set());
  const [activeTab, setActiveTab] = useState<Record<string, string>>({});
  const [sortField, setSortField] = useState<string>(
    () => readOneOf(paramOr('sort'), GENOME_SORT_FIELDS, DEFAULT_SORT_FIELD),
  );
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>(
    () => readOneOf(paramOr('order'), ['asc', 'desc'] as const, DEFAULT_SORT_ORDER),
  );
  const [viewMode, setViewMode] = useState<'table' | 'map'>(
    () => (paramOr('display') === 'map' ? 'map' : 'table'),
  );

  const [, setDataSourceInitialized] = useState(false);
  const [dataSourceOptions, setDataSourceOptions] = useState<{ label: string; value: string }[]>([]);
  const [dataSourceUrls, setDataSourceUrls] = useState<Record<string, string>>({});

  const [showFilters, setShowFilters] = useState<Record<string, boolean>>({});
  const [filterId, setFilterId] = useState(() => paramOr('id'));
  const [filterGoldEcosystem, setFilterGoldEcosystem] = useState(() => paramOr('goldEcosystem'));
  const [filterBiome, setFilterBiome] = useState(() => paramOr('biome'));
  const [filterStudy, setFilterStudy] = useState(() => paramOr('study'));
  // Taken as given: the options load after the first render, so an unknown id
  // cannot be told from one not loaded yet. The server narrows by it either way.
  const [filterDataSource, setFilterDataSource] = useState(() => paramOr('dataSource'));
  // Raw, like every filter: /api/samples refuses an unknown sourceType, and that
  // refusal (not a silent corpus-wide answer) is what a bad link should get.
  const [filterGenomeType, setFilterGenomeType] = useState(() => paramOr('genomeType'));
  const [assembliesMin, setAssembliesMin] = useState<string>(() => readNumber(paramOr('assembliesMin')));
  const [assembliesMax, setAssembliesMax] = useState<string>(() => readNumber(paramOr('assembliesMax')));
  const [bgcsMin, setBgcsMin] = useState<string>(() => readNumber(paramOr('bgcsMin')));
  const [bgcsMax, setBgcsMax] = useState<string>(() => readNumber(paramOr('bgcsMax')));
  const [completenessMin, setCompletenessMin] = useState<string>(() => readNumber(paramOr('completenessMin')));
  const [completenessMax, setCompletenessMax] = useState<string>(() => readNumber(paramOr('completenessMax')));
  const [contaminationMin, setContaminationMin] = useState<string>(() => readNumber(paramOr('contaminationMin')));
  const [contaminationMax, setContaminationMax] = useState<string>(() => readNumber(paramOr('contaminationMax')));
  const [filterGenomeQuality, setFilterGenomeQuality] = useState(() => paramOr('genomeQuality'));
  // Geographic bounds — the property-search map and a study map's area select
  // deep-link an area here. There is no lat/lon column to filter on, so the
  // bounds surface as a clearable chip instead.
  const [bbox, setBbox] = useState<{ latMin?: string; latMax?: string; lonMin?: string; lonMax?: string }>(() => ({
    latMin: readNumber(paramOr('latMin')) || undefined,
    latMax: readNumber(paramOr('latMax')) || undefined,
    lonMin: readNumber(paramOr('lonMin')) || undefined,
    lonMax: readNumber(paramOr('lonMax')) || undefined,
  }));
  const hasBbox = Boolean(bbox.latMin || bbox.latMax || bbox.lonMin || bbox.lonMax);
  // ?studyKey= is the exact key; the `study` column filter matches titles, which
  // are shared by several studies.
  const [studyKeyFilter, setStudyKeyFilter] = useState(() => paramOr('studyKey').trim());
  // The environment bucket a study map's area link carries (sample-map-dots
  // buildQuery). RAW, as on /samples: the API refuses an unknown bucket with a
  // 400 that names it (goldBucketRefusal), so the client does not validate it.
  const [goldBucketFilter, setGoldBucketFilter] = useState(() => paramOr('goldBucket'));

  useEffect(() => {
    let cancelled = false;
    apiFetch('/api/data-sources?sourceType=isolate&sourceType=MAG&sourceType=SAG')
      .then(res => res.json())
      .then(payload => {
        if (cancelled) return;
        if (Array.isArray(payload?.data)) {
          const sourceOptions = payload.data
            .filter((d: { id?: string; name?: string }) => typeof d?.id === 'string' && typeof d?.name === 'string');
          const sourceUrlMap = sourceOptions.reduce((acc: Record<string, string>, d: { id: string; name: string; source_url?: string | null }) => {
            const url = typeof d.source_url === 'string' ? d.source_url.trim() : '';
            if (url) {
              acc[d.id] = url;
              acc[d.name] = url;
            }
            return acc;
          }, {});
          setDataSourceUrls(sourceUrlMap);
          setDataSourceOptions(sourceOptions
            .map((d: { id: string; name: string }) => ({ label: formatDataSourceName(d.name), value: d.id }))
            .sort((a: { label: string }, b: { label: string }) => a.label.localeCompare(b.label))
          );
        }
      })
      .catch(() => {
        // the Data Source dropdown stays empty
      })
      .finally(() => {
        if (!cancelled) {
          setDataSourceInitialized(true);
        }
      });
    return () => { cancelled = true; };
  }, []);

  function useDebouncedValue<T>(value: T, delay = 500) {
    const [debounced, setDebounced] = useState(value);
    useEffect(() => {
      const t = setTimeout(() => setDebounced(value), delay);
      return () => clearTimeout(t);
    }, [value, delay]);
    return debounced;
  }

  const dSearch = useDebouncedValue(searchTerm);
  const dId = useDebouncedValue(filterId);
  const dGoldEcosystem = useDebouncedValue(filterGoldEcosystem);
  const dBiome = useDebouncedValue(filterBiome);
  const dStudy = useDebouncedValue(filterStudy);
  const dDataSource = useDebouncedValue(filterDataSource);
  const dGenomeType = useDebouncedValue(filterGenomeType);
  const dAsmMin = useDebouncedValue(assembliesMin);
  const dAsmMax = useDebouncedValue(assembliesMax);
  const dBgcMin = useDebouncedValue(bgcsMin);
  const dBgcMax = useDebouncedValue(bgcsMax);
  const dComplMin = useDebouncedValue(completenessMin);
  const dComplMax = useDebouncedValue(completenessMax);
  const dContamMin = useDebouncedValue(contaminationMin);
  const dContamMax = useDebouncedValue(contaminationMax);
  const dGenomeQuality = useDebouncedValue(filterGenomeQuality);


  const filters = {
    id: filterId,
    assemblies: { min: assembliesMin, max: assembliesMax },
    bgcs: { min: bgcsMin, max: bgcsMax },
    completeness: { min: completenessMin, max: completenessMax },
    contamination: { min: contaminationMin, max: contaminationMax },
    genomeQuality: filterGenomeQuality,
    goldEcosystem: filterGoldEcosystem,
    biome: filterBiome,
    study: filterStudy,
    dataSource: filterDataSource,
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
      case 'assemblies':
        setAssembliesMin(range.min ?? '');
        setAssembliesMax(range.max ?? '');
        break;
      case 'bgcs':
        setBgcsMin(range.min ?? '');
        setBgcsMax(range.max ?? '');
        break;
      case 'completeness':
        setCompletenessMin(range.min ?? '');
        setCompletenessMax(range.max ?? '');
        break;
      case 'contamination':
        setContaminationMin(range.min ?? '');
        setContaminationMax(range.max ?? '');
        break;
      case 'genomeQuality':
        setFilterGenomeQuality(str);
        break;
      case 'goldEcosystem':
        setFilterGoldEcosystem(str);
        break;
      case 'biome':
        setFilterBiome(str);
        break;
      case 'study':
        setFilterStudy(str);
        break;
      case 'dataSource':
        setFilterDataSource(str);
        break;
      case 'genomeType':
        setFilterGenomeType(str);
        break;
    }
  };

  const [taxonomyRank, setTaxonomyRank] = useState<'auto' | 'domain' | 'phylum' | 'class' | 'order' | 'family' | 'genus' | 'species'>('auto');
  const [columnVisibility, setColumnVisibility] = useState<Record<string, boolean>>(getGenomeCollectionsDefaultColumnVisibility);
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>({
    // The default set (no Assemblies, Biome, Study, MIMAG) sums to 1,341px, the content
    // width, with every header's grip, sort arrow and filter inside its cell; widen one and
    // another has to give.
    id: 164,
    assemblies: 200,
    bgcs: 145,
    completeness: 160,
    contamination: 162,
    genomeQuality: 130,
    taxonomy: 226,
    goldEcosystem: 200,
    biome: 220,
    study: 280,
    genomeType: 110,
    dataSource: 174,
  });


  useEffect(() => {
    setMounted(true);
  }, []);

  // Clearing a filter drops it from the URL too (through the mirror), so a copied
  // link or a reload doesn't silently re-apply what the user just cleared. The
  // page goes back to 1 through the filterSignature guard below.
  const clearStudyKey = () => setStudyKeyFilter('');

  /** "Clear all" on the chips row: every filter, the study scope included (as on
   *  /samples). Sort, view and paging stay; the page goes back to 1 anyway. */
  const clearAllFilters = () => {
    setSearchTerm('');
    setStudyKeyFilter('');
    setGoldBucketFilter('');
    setFilterId('');
    setFilterGoldEcosystem('');
    setFilterBiome('');
    setFilterStudy('');
    setFilterDataSource('');
    setFilterGenomeType('');
    setAssembliesMin('');
    setAssembliesMax('');
    setBgcsMin('');
    setBgcsMax('');
    setCompletenessMin('');
    setCompletenessMax('');
    setContaminationMin('');
    setContaminationMax('');
    setFilterGenomeQuality('');
    setBbox({});
  };

  const activeDataSourceFilter = dDataSource || undefined;

  const bboxParams = {
    latMin: bbox.latMin ? Number(bbox.latMin) : undefined,
    latMax: bbox.latMax ? Number(bbox.latMax) : undefined,
    lonMin: bbox.lonMin ? Number(bbox.lonMin) : undefined,
    lonMax: bbox.lonMax ? Number(bbox.lonMax) : undefined,
  };

  const mapFilterParams = {
    goldBucket: goldBucketFilter || undefined,
    search: dSearch || undefined,
    id: dId || undefined,
    goldEcosystem: dGoldEcosystem || undefined,
    biome: dBiome || undefined,
    study: dStudy || undefined,
    studyKey: studyKeyFilter || undefined,
    dataSource: activeDataSourceFilter,
    ...bboxParams,
    assembliesMin: dAsmMin ? Number(dAsmMin) : undefined,
    assembliesMax: dAsmMax ? Number(dAsmMax) : undefined,
    bgcsMin: dBgcMin ? Number(dBgcMin) : undefined,
    bgcsMax: dBgcMax ? Number(dBgcMax) : undefined,
    completenessMin: dComplMin ? Number(dComplMin) : undefined,
    completenessMax: dComplMax ? Number(dComplMax) : undefined,
    contaminationMin: dContamMin ? Number(dContamMin) : undefined,
    contaminationMax: dContamMax ? Number(dContamMax) : undefined,
    genomeQuality: dGenomeQuality || undefined,
    sourceType: dGenomeType ? [dGenomeType] : ['isolate', 'MAG', 'SAG'],
  };

  // Unfiltered, the map uses the static snapshot; any active filter switches to
  // the live query so the dots match the table.
  const mapHasActiveFilters = Boolean(
    mapFilterParams.goldBucket ||
    mapFilterParams.search || mapFilterParams.id || mapFilterParams.biome ||
    mapFilterParams.goldEcosystem || mapFilterParams.study || mapFilterParams.studyKey ||
    mapFilterParams.dataSource || dGenomeType ||
    mapFilterParams.assembliesMin !== undefined || mapFilterParams.assembliesMax !== undefined ||
    mapFilterParams.bgcsMin !== undefined || mapFilterParams.bgcsMax !== undefined ||
    mapFilterParams.completenessMin !== undefined || mapFilterParams.completenessMax !== undefined ||
    mapFilterParams.contaminationMin !== undefined || mapFilterParams.contaminationMax !== undefined ||
    mapFilterParams.genomeQuality || hasBbox
  );

  const genomeFilterParams = {
    goldBucket: goldBucketFilter || undefined,
    goldEcosystem: dGoldEcosystem || undefined,
    biome: dBiome || undefined,
    search: dSearch || undefined,
    sortField,
    sortOrder,
    id: dId || undefined,
    study: dStudy || undefined,
    studyKey: studyKeyFilter || undefined,
    dataSource: activeDataSourceFilter,
    ...bboxParams,
    assembliesMin: dAsmMin ? Number(dAsmMin) : undefined,
    assembliesMax: dAsmMax ? Number(dAsmMax) : undefined,
    bgcsMin: dBgcMin ? Number(dBgcMin) : undefined,
    bgcsMax: dBgcMax ? Number(dBgcMax) : undefined,
    completenessMin: dComplMin ? Number(dComplMin) : undefined,
    completenessMax: dComplMax ? Number(dComplMax) : undefined,
    contaminationMin: dContamMin ? Number(dContamMin) : undefined,
    contaminationMax: dContamMax ? Number(dContamMax) : undefined,
    genomeQuality: dGenomeQuality || undefined,
    sourceType: dGenomeType ? [dGenomeType] : ['isolate', 'MAG', 'SAG'],
    // Inline, because a fetch per row froze the page on load.
    includeGtdbAccession: 1,
    includeTaxonomy: 1,
    includeStudyLinks: 1,
  };
  // Any change to the request parameters actually sent returns to page 1, done
  // during render so no request leaves at the old offset first.
  const filterSignature = JSON.stringify(genomeFilterParams);
  const [pagedUnder, setPagedUnder] = useState(filterSignature);
  if (pagedUnder !== filterSignature) {
    setPagedUnder(filterSignature);
    setCurrentPage(0);
  }
  const offset = (pagedUnder === filterSignature ? currentPage : 0) * pageSize;

  // The page's ONE URL writer (see useMirrorToUrl). Text, select and range
  // filters are mirrored DEBOUNCED, as they are sent, so the URL names the rows
  // on screen rather than a half-typed word. Column widths and visibility,
  // expanded rows and their tabs, open filter rows and the taxonomy rank stay
  // out: they describe the display, not the result set.
  useMirrorToUrl(
    [
      ['search', dSearch],
      ['studyKey', studyKeyFilter],
      ['goldBucket', goldBucketFilter],
      ['id', dId],
      ['goldEcosystem', dGoldEcosystem],
      ['biome', dBiome],
      ['study', dStudy],
      ['dataSource', dDataSource],
      ['genomeType', dGenomeType],
      ['assembliesMin', dAsmMin],
      ['assembliesMax', dAsmMax],
      ['bgcsMin', dBgcMin],
      ['bgcsMax', dBgcMax],
      ['completenessMin', dComplMin],
      ['completenessMax', dComplMax],
      ['contaminationMin', dContamMin],
      ['contaminationMax', dContamMax],
      ['genomeQuality', dGenomeQuality],
      ['latMin', bbox.latMin ?? ''],
      ['latMax', bbox.latMax ?? ''],
      ['lonMin', bbox.lonMin ?? ''],
      ['lonMax', bbox.lonMax ?? ''],
      ['sort', sortField, DEFAULT_SORT_FIELD],
      ['order', sortOrder, DEFAULT_SORT_ORDER],
      ['page', currentPage + 1, 1],
      ['size', pageSize, DEFAULT_PAGE_SIZE],
      ['display', viewMode === 'map' ? 'map' : ''],
    ] satisfies UrlEntry[],
    mounted,
  );

  const { data, isLoading, isFetching, error, hasLoaded: samplesLoaded, refetch } = useSamples({
    limit: pageSize, offset, ...genomeFilterParams,
  });

  const { data: statisticsData, isLoading: statsLoading } = useStatistics(['isolate', 'MAG', 'SAG']);

  const handlePageSizeChange = (newPageSize: number) => {
    setPageSize(newPageSize);
    setCurrentPage(0);
  };

  const handlePageChange = (newPage: number) => {
    setCurrentPage(newPage);
  };

  const handleViewModeChange = (mode: 'table' | 'map') => {
    setViewMode(mode);
    setCurrentPage(0);
  };

  const toggleRowExpansion = (sampleId: string | number) => {
    const key = String(sampleId);
    setExpandedRows(prev => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const toggleAssemblyExpansion = (sampleId: string | number) => {
    const key = String(sampleId);
    let willExpand = false;
    setExpandedAssemblies(prev => {
      const next = new Set(prev);
      willExpand = !next.has(key);
      if (willExpand) {
        next.add(key);
      } else {
        next.delete(key);
      }
      return next;
    });
    if (willExpand) {
      setActiveTab(prev => ({ ...prev, [key]: 'environment' }));
    }
  };

  const handleSearch = (value: string) => {
    setSearchTerm(value);
    setCurrentPage(0);
  };

  const handleSort = (columnId: string, direction: 'asc' | 'desc') => {
    setSortField(columnId);
    setSortOrder(direction);
    setCurrentPage(0);
  };

  const handleColumnReorder = (_newOrder: string[]) => {
    // Handle column reordering if needed
  };

  const handleColumnResize = (columnId: string, width: number) => {
    setColumnWidths(prev => ({ ...prev, [columnId]: width }));
  };

  const handleColumnVisibilityChange = (columnId: string, visible: boolean) => {
    setColumnVisibility(prev => ({ ...prev, [columnId]: visible }));
  };

  // Nothing from a failed request reaches the table, the counts or the export:
  // the error state below stands in for all of them.
  const samples = error ? [] : (data?.data?.data || []);
  const total = error ? 0 : (data?.data?.total || 0);

  // Under a deep-page refusal the pager stays, at the last total the list
  // reported, so the reader can step back; any other error hides it, where
  // "Showing 1–0 of 0" would read as an empty result.
  const pagerShown = !error || isDeepPageRefusal(error);
  const pagerItems = useLastKnown(total, !error, JSON.stringify(genomeFilterParams));
  const pagerPages = Math.ceil(pagerItems / pageSize);
  const statistics = statisticsData?.data || null;

  const getSampleSourceNames = (sample: Sample): string[] => {
    const rawSources = Array.isArray(sample.dataSourceNames)
      ? sample.dataSourceNames
      : typeof sample.dataSourceNames === 'string'
        ? [sample.dataSourceNames]
        : [];
    return rawSources
      .filter((name: unknown): name is string => typeof name === 'string' && name.trim().length > 0)
      .map((name: string) => name.trim());
  };

  if (!mounted) {
    return (
      <MainLayout>
        <div className="w-full py-8">
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <span className="ml-2 text-muted-foreground">Loading...</span>
          </div>
        </div>
      </MainLayout>
    );
  }

  const emptyState = (
    <div className="py-12 text-center text-muted-foreground">
      <p className="text-lg">No genomes were found</p>
      {searchTerm ? (
        <div className="text-sm space-y-1">
          <p>No matches for your search criteria:</p>
          <p className="font-mono bg-muted px-2 py-1 rounded inline-block">&quot;{searchTerm}&quot;</p>
          <p>Try different keywords or clear filters</p>
        </div>
      ) : (
        <p className="text-sm">Try adjusting your search or filter criteria</p>
      )}
    </div>
  );

  const tableLoading = !samplesLoaded || isLoading;
  const tableEmptyState = samplesLoaded ? emptyState : null;

  const columns: TableColumn<Sample>[] = [
    {
      id: 'id',
      label: 'Genome ID',
      width: columnWidths.id,
      minWidth: 160,
      sortable: true,
      filterable: true,
      filterType: 'text' as const,
      visible: columnVisibility.id,
      renderCell: (sample: Sample) => {
        const isExpanded = expandedRows.has(String(sample.id));
        const label = sample.externalId || sample.id;
        return (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => toggleRowExpansion(sample.id)}
            className="h-7 px-2 py-0 flex items-center gap-1 min-w-0 max-w-full"
            aria-expanded={isExpanded}
            title={isExpanded ? 'Hide details' : 'Show details'}
          >
            {isExpanded ? (
              <ChevronDown className="h-4 w-4 shrink-0" />
            ) : (
              <ChevronRight className="h-4 w-4 shrink-0" />
            )}
            <span className="font-medium font-mono text-xs truncate min-w-0" title={String(label)}>{label}</span>
          </Button>
        );
      }
    },
    {
      id: 'assemblies',
      label: 'Assemblies',
      width: columnWidths.assemblies,
      minWidth: 120,
      sortable: true,
      defaultSortDirection: 'desc',
      filterable: true,
      filterType: 'range' as const,
      visible: columnVisibility.assemblies,
      className: 'text-center',
      renderCell: (sample: Sample) => {
        const idKey = String(sample.id);
        const count = typeof sample.assemblyCount === 'number' ? sample.assemblyCount : 0;
        const isOpen = expandedAssemblies.has(idKey);
        const disabled = count === 0;
        const title = disabled
          ? 'No assemblies'
          : isOpen
            ? `Hide assemblies (${count})`
            : `Show assemblies (${count})`;
        return (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 px-2 py-0 w-full justify-center"
            onClick={() => !disabled && toggleAssemblyExpansion(sample.id)}
            aria-expanded={isOpen}
            aria-controls={`expanded-${idKey}`}
            disabled={disabled}
            title={title}
          >
            <span className={`inline-flex items-center gap-2 ${disabled ? 'opacity-60' : ''}`}>
              <span className={`shrink-0 transition-transform duration-200 ${isOpen ? 'rotate-90' : ''}`}>
                <ChevronRight className="h-4 w-4" />
              </span>
              <span className="text-sm font-medium">{count}</span>
              <span className="text-[11px] text-muted-foreground">{disabled ? '—' : (isOpen ? 'Hide' : 'Show')}</span>
            </span>
          </Button>
        );
      }
    },
    {
      id: 'bgcs',
      label: '# BGCs',
      width: columnWidths.bgcs,
      minWidth: 100,
      sortable: true,
      defaultSortDirection: 'desc',
      filterable: true,
      filterType: 'range' as const,
      visible: columnVisibility.bgcs,
      className: 'text-center',
      renderCell: (sample: Sample) => {
        if ((sample.bgcCount ?? 0) > 0) {
          return (
            <Link
              href={`/bgcs?sampleId=${sample.id}`}
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium tabular-nums text-foreground underline underline-offset-2 decoration-foreground/50 hover:decoration-foreground"
            >
              {sample.bgcCount?.toLocaleString()}
            </Link>
          );
        }
        return <span className="font-medium tabular-nums text-muted-foreground">{sample.bgcCount?.toLocaleString()}</span>;
      }
    },
    {
      id: 'completeness',
      label: 'Compl. %',
      headerTitle: 'CheckM2 completeness (%), coloured by MIMAG band: ≥ 90 high, ≥ 50 medium',
      width: columnWidths.completeness,
      minWidth: 130,
      sortable: true,
      defaultSortDirection: 'desc',
      filterable: true,
      filterType: 'range' as const,
      visible: columnVisibility.completeness ?? true,
      className: 'text-center',
      renderCell: (sample: Sample) => {
        const value = sample.checkmCompleteness;
        if (value == null) return <span className="text-sm text-muted-foreground">-</span>;
        const band = completenessBand(value);
        return (
          <span className={`font-mono text-sm tabular-nums ${MIMAG_TEXT_CLASS[band]}`} title={COMPLETENESS_NOTE[band]}>
            {formatPercent(value)}
          </span>
        );
      }
    },
    {
      id: 'contamination',
      label: 'Contam. %',
      headerTitle: 'CheckM2 contamination (%), coloured by MIMAG band: ≤ 5 high, < 10 medium',
      width: columnWidths.contamination,
      minWidth: 140,
      sortable: true,
      defaultSortDirection: 'asc',
      filterable: true,
      filterType: 'range' as const,
      visible: columnVisibility.contamination ?? true,
      className: 'text-center',
      renderCell: (sample: Sample) => {
        const value = sample.checkmContamination;
        if (value == null) return <span className="text-sm text-muted-foreground">-</span>;
        const band = contaminationBand(value);
        return (
          <span className={`font-mono text-sm tabular-nums ${MIMAG_TEXT_CLASS[band]}`} title={CONTAMINATION_NOTE[band]}>
            {formatPercent(value)}
          </span>
        );
      }
    },
    {
      id: 'genomeQuality',
      label: 'MIMAG',
      headerTitle: 'MIMAG quality from the CheckM2 values: high = ≥ 90 % complete and ≤ 5 % contaminated; medium = ≥ 50 % and < 10 %.',
      width: columnWidths.genomeQuality,
      minWidth: 110,
      sortable: true,
      filterable: true,
      filterType: 'select' as const,
      // Only the labels the corpus holds: it has no genomes below medium quality.
      filterOptions: [
        { label: 'high', value: 'high' },
        { label: 'medium', value: 'medium' },
      ],
      visible: columnVisibility.genomeQuality ?? false,
      renderCell: (sample: Sample) => {
        const q = sample.genomeQuality;
        if (q !== 'high' && q !== 'medium' && q !== 'low') {
          return <span className="text-sm text-muted-foreground">-</span>;
        }
        return (
          <Badge variant="outline" className={`text-xs ${MIMAG_BADGE_CLASS[q]}`}>
            {q}
          </Badge>
        );
      }
    },
    {
      id: 'taxonomy',
      label: 'Taxonomy',
      renderHeader: () => (
        <div className="flex items-center gap-1">
          <span>Taxonomy</span>
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
          <InfoTooltip content="Taxonomic classification from GTDB. 'Auto' shows the most specific rank available." />
        </div>
      ),
      width: columnWidths.taxonomy || 280,
      minWidth: 226,
      sortable: false,
      filterable: false,
      visible: columnVisibility.taxonomy ?? true,
      renderCell: (sample: Sample) => {
        const tax = sample.genomeTaxonomy;
        let taxon: string | null | undefined = null;

        if (taxonomyRank === 'auto') {
          taxon = tax?.species || tax?.genus || tax?.family || tax?.order
            || tax?.class || tax?.phylum || tax?.domain;
        } else {
          taxon = tax?.[taxonomyRank];
        }

        if (!taxon) {
          return <span className="text-sm text-muted-foreground">-</span>;
        }

        const displayName = getTaxonDisplayName(taxon);

        const lineageParts = tax?.gtdbLineage
          ? formatTaxonomyBreadcrumb(tax.gtdbLineage)
          : [tax?.domain, tax?.phylum, tax?.class, tax?.order,
             tax?.family, tax?.genus, tax?.species]
              .filter((t): t is string => Boolean(t))
              .map((t) => getTaxonDisplayName(t));
        const fullPath = lineageParts.join(' › ') || displayName;

        return (
          <div className="max-w-full">
            <TaxonomyBadge name={displayName} lineage={fullPath} className="text-xs" />
          </div>
        );
      }
    },
    {
      id: 'goldEcosystem',
      label: 'GOLD Ecosystem',
      width: columnWidths.goldEcosystem,
      minWidth: 200,
      // Neither backend sorts by it (both fall back to # BGCs), so no arrow.
      sortable: false,
      filterable: true,
      filterType: 'text' as const,
      visible: columnVisibility.goldEcosystem,
      renderCell: (sample: Sample) => {
        const goldPath = typeof sample.goldEcosystemPath === 'string' ? sample.goldEcosystemPath.trim() : '';
        if (!goldPath) {
          return <span className="text-sm text-muted-foreground">-</span>;
        }

        const label = formatGOLDBreadcrumb(goldPath, ' › ');
        const colorClass = getGOLDBadgeClass(goldPath);

        return (
          <div className="max-w-full">
            <Badge
              variant="secondary"
              className={`text-xs ${colorClass} max-w-full whitespace-normal h-auto`}
              title={goldPath}
            >
              {label}
            </Badge>
          </div>
        );
      }
    },
    {
      id: 'biome',
      label: 'Biome',
      width: columnWidths.biome,
      minWidth: 180,
      sortable: true,
      filterable: true,
      filterType: 'text' as const,
      visible: columnVisibility.biome,
      renderCell: (sample: Sample) => {
        const rawBiomeCandidate = typeof sample.primaryBiome === 'string' ? sample.primaryBiome.trim() : '';
        const rawBiomeFallback = typeof sample.environmentBiome === 'string' ? sample.environmentBiome.trim() : '';
        // GTDB genomes carry their biome in `environment`, not primary_biome.
        const rawBiomeEnv = typeof sample.environment === 'string' ? sample.environment.trim() : '';
        const rawBiome = rawBiomeCandidate || rawBiomeFallback || rawBiomeEnv;

        if (!rawBiome || /^root$/i.test(rawBiome)) {
          return <span className="text-sm text-muted-foreground">-</span>;
        }

        const badgeLabel = formatBiomeLabel(rawBiome);
        const colorClass = getEnvironmentColor(rawBiome);

        return (
          <div className="max-w-full">
            <Badge
              variant="secondary"
              className={`text-xs ${colorClass} max-w-full whitespace-normal h-auto`}
              title={rawBiome}
            >
              {badgeLabel}
            </Badge>
          </div>
        );
      }
    },
    {
      id: 'study',
      label: 'Study',
      width: columnWidths.study,
      minWidth: 220,
      sortable: true,
      filterable: true,
      filterType: 'text' as const,
      visible: columnVisibility.study,
      renderCell: (sample: Sample) => {
        const links = Array.isArray(sample.studyLinks)
          ? sample.studyLinks.filter((l): l is NonNullable<typeof l> => Boolean(l))
          : [];
        const studyTitles = Array.isArray(sample.studyTitles) ? sample.studyTitles : [];
        const primary = links[0];
        const label = primary?.title || primary?.accession || studyTitles[0];
        if (!label) return <span className="text-sm text-muted-foreground">-</span>;
        const tooltipParts = links.length
          ? links.map((l) => l.title || l.accession).filter(Boolean)
          : studyTitles;
        const tooltip = tooltipParts.length > 1 ? tooltipParts.join(', ') : label;
        const prj = (primary?.bioproject || primary?.accession || '').trim();
        if (/^PRJ[A-Z]+[0-9]+$/i.test(prj)) {
          return (
            <a
              href={`https://www.ncbi.nlm.nih.gov/bioproject/${encodeURIComponent(prj)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-foreground underline underline-offset-2 decoration-foreground/50 hover:decoration-foreground truncate inline-flex items-center gap-1 max-w-full"
              title={tooltip || undefined}
              onClick={(e) => e.stopPropagation()}
            >
              <span className="truncate">{label}</span>
              <ExternalLink className="h-3 w-3 shrink-0" />
            </a>
          );
        }
        return (
          <span className="text-sm truncate block" title={tooltip || undefined}>
            {label}
          </span>
        );
      }
    },
    {
      id: 'genomeType',
      label: 'Type',
      width: columnWidths.genomeType || 140,
      minWidth: 90,
      sortable: false,
      filterable: true,
      filterType: 'select' as const,
      filterOptions: [
        { label: 'isolate', value: 'isolate' },
        { label: 'MAG', value: 'MAG' },
        { label: 'SAG', value: 'SAG' },
      ],
      visible: columnVisibility.genomeType ?? true,
      renderCell: (sample: Sample) => {
        const types = Array.isArray(sample.sourceTypes)
          ? sample.sourceTypes.filter((t): t is string => typeof t === 'string' && t.trim().length > 0)
          : [];
        if (types.length === 0) {
          return <span className="text-sm text-muted-foreground">-</span>;
        }
        return (
          <div className="flex flex-wrap gap-1">
            {types.map((t) => (
              <Badge key={t} variant="secondary" className="text-xs font-medium">
                {t}
              </Badge>
            ))}
          </div>
        );
      }
    },
    {
      id: 'dataSource',
      label: 'Data Source',
      width: columnWidths.dataSource,
      minWidth: 150,
      sortable: true,
      filterable: true,
      filterType: 'select' as const,
      filterOptions: dataSourceOptions,
      visible: columnVisibility.dataSource,
      renderCell: (sample: Sample) => {
        const sourceNames = getSampleSourceNames(sample);
        const sourceIds = Array.isArray(sample.dataSourceIds) ? sample.dataSourceIds : [];
        if (sourceNames.length === 0) {
          return <span className="text-sm text-muted-foreground">-</span>;
        }

        return (
          <div className="flex flex-wrap items-center gap-2">
            {sourceNames.map((name, index) => {
              const label = formatDataSourceName(name);
              const sourceId = sourceIds[index];
              const href = buildGenomeCollectionDataSourceHref({
                sourceName: name,
                sampleExternalId: sample.externalId,
                gtdbAccession: sample.gtdbAccession,
                sourceUrl: dataSourceUrls[sourceId] ?? dataSourceUrls[name] ?? getDataSourceUrl(name) ?? undefined,
              });
              const badge = (
                <Badge
                  variant={href ? 'outline' : 'secondary'}
                  className={`inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium max-w-full whitespace-normal h-auto text-left ${href ? 'hover:border-primary hover:text-primary transition-colors' : ''}`}
                  title={href ? `Open ${sample.externalId ?? label} on ${label}` : label}
                >
                  <span>{label}</span>
                  {href && <ExternalLink className="h-3 w-3" />}
                </Badge>
              );

              if (!href) {
                return <Fragment key={name}>{badge}</Fragment>;
              }

              return (
                <a
                  key={name}
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1"
                  title={`Open ${sample.externalId ?? label} on ${label}`}
                  onClick={(e) => e.stopPropagation()}
                >
                  {badge}
                </a>
              );
            })}
          </div>
        );
      }
    }
  ];

  // Shares the serializer of the streamed "All matching" export.
  const handleDownload = (format: ExportFormat) => {
    downloadText(
      serializeExport(samples, GENOME_EXPORT_COLUMNS, format),
      exportFilename(`genomes_page${currentPage + 1}`, samples.length, samples.length, format),
      format,
    );
  };

  const fmt = (value?: number | null): string =>
    statsLoading ? '—' : (value ?? 0).toLocaleString();

  // Every active filter gets a chip, column filters included: a copied link can
  // carry ?biome= or ?bgcsMin= while that filter row is closed, its column is
  // hidden or the page is in map view, and nothing else on screen would say the
  // table is narrowed. Values are the APPLIED ones (what the request sends), see
  // appliedFilterValue. The study scope keeps its own StudyScopeChip above.
  const ap = appliedFilterValue;
  const filterChipsList: FilterChip[] = [
    { key: 'search', label: 'Search', value: ap(searchTerm, dSearch), onRemove: () => setSearchTerm('') },
    {
      key: 'goldBucket',
      label: 'Environment',
      value: goldBucketFilter
        ? goldBucketLabel(goldBucketFilter)
        : '',
      onRemove: () => setGoldBucketFilter(''),
    },
    { key: 'area', label: 'Area', value: hasBbox ? formatAreaLabel(bbox) : '', onRemove: () => setBbox({}) },
    { key: 'id', label: 'Genome ID', value: ap(filterId, dId), onRemove: () => setFilterId('') },
    {
      key: 'genomeType',
      label: 'Genome type',
      value: ap(filterGenomeType, dGenomeType),
      onRemove: () => setFilterGenomeType(''),
    },
    {
      key: 'dataSource',
      label: 'Data source',
      value: ap(filterDataSource, dDataSource) && optionLabel(dataSourceOptions, dDataSource),
      onRemove: () => setFilterDataSource(''),
    },
    {
      key: 'assemblies',
      label: 'Assemblies',
      value: formatRangeLabel(ap(assembliesMin, dAsmMin), ap(assembliesMax, dAsmMax)),
      onRemove: () => { setAssembliesMin(''); setAssembliesMax(''); },
    },
    {
      key: 'bgcs',
      label: 'BGCs',
      value: formatRangeLabel(ap(bgcsMin, dBgcMin), ap(bgcsMax, dBgcMax)),
      onRemove: () => { setBgcsMin(''); setBgcsMax(''); },
    },
    {
      key: 'completeness',
      label: 'Completeness',
      value: formatRangeLabel(ap(completenessMin, dComplMin), ap(completenessMax, dComplMax), '%'),
      onRemove: () => { setCompletenessMin(''); setCompletenessMax(''); },
    },
    {
      key: 'contamination',
      label: 'Contamination',
      value: formatRangeLabel(ap(contaminationMin, dContamMin), ap(contaminationMax, dContamMax), '%'),
      onRemove: () => { setContaminationMin(''); setContaminationMax(''); },
    },
    {
      key: 'genomeQuality',
      label: 'MIMAG',
      value: ap(filterGenomeQuality, dGenomeQuality),
      onRemove: () => setFilterGenomeQuality(''),
    },
    {
      key: 'goldEcosystem',
      label: 'GOLD Ecosystem',
      value: ap(filterGoldEcosystem, dGoldEcosystem),
      onRemove: () => setFilterGoldEcosystem(''),
    },
    { key: 'biome', label: 'Biome', value: ap(filterBiome, dBiome), onRemove: () => setFilterBiome('') },
    { key: 'study', label: 'Study', value: ap(filterStudy, dStudy), onRemove: () => setFilterStudy('') },
  ].filter((chip) => chip.value);

  return (
    <MainLayout>
      <div className="w-full py-6">
        <header className="mb-6 border-b border-border pb-4">
          <h1 className="atlas-rule mb-3 text-2xl font-semibold tracking-tight md:text-3xl">
            Genome collections
          </h1>
          <p className="mt-3 max-w-3xl text-[14px] leading-relaxed text-muted-foreground">
            MAGs and isolate genomes from select genome collections.
          </p>
        </header>

        <section className="mb-6 border-b border-border pb-4">
          <dl className="grid grid-cols-1 gap-x-8 gap-y-2 text-sm sm:grid-cols-4">
            <div className="leader-row">
              {/* Corpus-wide on purpose, not the filtered total. */}
              <dt className="whitespace-nowrap text-muted-foreground">Total genomes</dt>
              <span className="leader-dots" aria-hidden />
              <dd className="font-mono font-medium tabular-nums text-foreground">
                {fmt(statistics?.totalGenomes)}
              </dd>
            </div>
            <div className="leader-row">
              <dt className="whitespace-nowrap text-muted-foreground">BGCs</dt>
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
          </dl>
        </section>

        <section className="mb-8">
          <div className="section-label mb-3">Taxonomy</div>
          <GenomeCharts />
        </section>

        <section className="mb-8">
          <div className="section-label mb-3">GOLD Ecosystem</div>
          <SampleCharts
            sourceType={['isolate', 'MAG', 'SAG']}
            distributionTitle="Genome distribution"
            metricLabel="Genomes"
            unitLabel="genomes"
          />
        </section>

        <section className="mb-3">
          <div className="section-label mb-2.5">Filter</div>
          {studyKeyFilter && <StudyScopeChip studyKey={studyKeyFilter} onClear={clearStudyKey} />}
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-[260px] flex-1 sm:max-w-xl">
              <Search
                aria-hidden
                className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
              />
              <Input
                placeholder="Search genomes by ID, study, biome…"
                className="h-8 pl-7 text-[13px]"
                value={searchTerm}
                onChange={(e) => handleSearch(e.target.value)}
                aria-label="Search genomes"
              />
            </div>

            <CopyLinkButton className="ml-auto" />

            <div className="inline-flex rounded-sm border border-input">
              <Button
                variant={viewMode === 'table' ? 'default' : 'ghost'}
                size="sm"
                className="rounded-none border-r border-border"
                onClick={() => handleViewModeChange('table')}
              >
                <List className="size-3.5" />
                Table
              </Button>
              <Button
                variant={viewMode === 'map' ? 'default' : 'ghost'}
                size="sm"
                className="rounded-none"
                onClick={() => handleViewModeChange('map')}
              >
                <Map className="size-3.5" />
                Map
              </Button>
            </div>

            <ExportMenu
              pageRows={samples.length}
              onPageExport={handleDownload}
              total={total}
              exportPath={sampleExportPath(genomeFilterParams, 'genomes')}
            />
          </div>
        </section>

        <FilterChips className="mb-6" filters={filterChipsList} onClearAll={clearAllFilters} />

        <section>
          <div className="mb-3 flex items-end justify-between gap-4 border-b border-border pb-2">
            <div>
              <h2 className="mt-0.5 text-sm font-medium">
                {viewMode === 'map' ? 'Genome locations' : 'Genome collection'}
                {viewMode === 'table' && !tableLoading && total > 0 && (
                  <span className="ml-2 font-mono text-xs font-normal tabular-nums text-muted-foreground">
                    {samples.length.toLocaleString()} of {total.toLocaleString()}
                  </span>
                )}
              </h2>
              <div className="mt-2">
                <EcosystemLegend />
              </div>
            </div>
          </div>

          {viewMode === 'table' && pagerShown && !tableLoading && pagerItems > 0 && (
            <div className="mb-4">
              <Pagination
                currentPage={currentPage}
                totalPages={pagerPages}
                totalItems={pagerItems}
                pageSize={pageSize}
                offset={offset}
                onPageChange={handlePageChange}
                onPageSizeChange={handlePageSizeChange}
                pageSizeOptions={PAGE_SIZE_OPTIONS}
              />
            </div>
          )}

          <div>
            {viewMode === 'map' && error && isFilterRefusal(error) ? (
              // The map reads the same filters. Shown in place of it, so a
              // refused filter never leaves the static snapshot's unfiltered
              // dots on screen as if they matched.
              <ListErrorState error={error} noun="genome collections" onRetry={refetch} retrying={isFetching} />
            ) : viewMode === 'map' ? (
              mapHasActiveFilters ? (
                <SampleMapDots
                  showAreaSelect={false}
                  params={{
                    ...mapFilterParams,
                    enabled: viewMode === 'map',
                  }}
                />
              ) : (
                <SampleMapDots
                  showAreaSelect={false}
                  staticManifestUrl="/data/map-genomes.manifest.json"
                />
              )
            ) : error ? (
              <ListErrorState
                error={error}
                noun="genome collections"
                onRetry={refetch}
                retrying={isFetching}
                onFirstPage={() => setCurrentPage(0)}
              />
            ) : tableLoading ? (
              <div className="space-y-6">
                <ColdLoadHint loading={tableLoading} label="Loading genomes" />
                <TableSkeleton rows={Math.min(pageSize, 10)} />
              </div>
            ) : (
              <RefetchFrame refetching={isFetching} label="Updating genomes">
                <ResizableTable
                  stickyFirstColumn
                  columns={columns}
                  data={samples}
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
                  emptyState={tableEmptyState}
                  renderExpandedRow={(sample: Sample, _rowIndex: number, _visibleColumnCount: number) => {
                  const idKey = String(sample.id);
                  const showMeta = expandedRows.has(idKey);
                  const showAssemblies = expandedAssemblies.has(idKey);
                  if (!showMeta && !showAssemblies) return null;

                  const assembliesOnly = showAssemblies && !showMeta;
                  if (assembliesOnly) {
                    return (
                      <div id={`expanded-${idKey}`} className="border-t bg-muted/30">
                        <div className="px-4 py-3">
                          <AssemblyDetails sampleId={sample.id} />
                        </div>
                      </div>
                    );
                  }

                  const currentTab = activeTab[idKey] || 'environment';

                  // No Assemblies tab: every genome is exactly one assembly, so its
                  // one useful item -- the antiSMASH run -- sits in the line above.
                  const tabs = [
                    { id: 'metadata', label: 'Metadata' },
                    { id: 'quality', label: 'Genome Quality' },
                    { id: 'environment', label: 'Environment' },
                    { id: 'studies', label: 'Studies' }
                  ];

                  return (
                    <div id={`expanded-${idKey}`} className="border-t bg-muted/30">
                      {(sample.bgcCount ?? 0) > 0 && (
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-6 pt-3">
                          <span className="font-mono text-xs text-muted-foreground">{sample.externalId || sample.name}</span>
                          <Button variant="outline" size="sm" className="h-6 px-2 text-[11px] gap-1.5" asChild>
                            <Link
                              href={`/antismash/sample/${sample.id}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="cursor-pointer"
                            >
                              <Image
                                src={withBase("/images/antismash_logo.svg")}
                                alt="antiSMASH"
                                width={12}
                                height={12}
                                className="h-3 w-auto"
                              />
                              View antiSMASH
                            </Link>
                          </Button>
                        </div>
                      )}
                      <div className="flex items-center gap-1 border-b bg-background/50 overflow-x-auto px-4 py-3">
                        {tabs.map(({ id, label }) => (
                          <Button
                            key={id}
                            variant={currentTab === id ? "default" : "ghost"}
                            size="sm"
                            onClick={() => setActiveTab(prev => ({ ...prev, [idKey]: id }))}
                            className="text-xs whitespace-nowrap"
                          >
                            {label}
                          </Button>
                        ))}
                      </div>

                      <div className="px-8 py-6">
                        {showMeta && (
                          <>
                            {currentTab === 'environment' && (
                              <SampleEnvironmentalPanel sample={sample} />
                            )}
                            {currentTab === 'studies' && (
                              <SampleStudiesPanel sampleId={sample.id} />
                            )}
                            {currentTab === 'quality' && (
                              <SampleGenomeQualityPanel sample={sample} />
                            )}
                            {currentTab === 'metadata' && (
                              <MetadataDetails sample={sample} />
                            )}
                          </>
                        )}
                      </div>
                    </div>
                  );
                }}
              />
              </RefetchFrame>
            )}
          </div>
        </section>

        {viewMode === 'table' && pagerShown && (!error || pagerItems > 0) && (
          <div className="mt-6">
            <Pagination
              currentPage={currentPage}
              totalPages={pagerPages}
              totalItems={pagerItems}
              pageSize={pageSize}
              offset={offset}
              onPageChange={handlePageChange}
              onPageSizeChange={handlePageSizeChange}
              pageSizeOptions={PAGE_SIZE_OPTIONS}
            />
          </div>
        )}
      </div>
    </MainLayout>
  );
}
