'use client';

import { apiFetch, withBase } from "@/lib/basePath";
import Link from 'next/link';
import Image from 'next/image';
import { useSearchParams } from 'next/navigation';
import { Suspense, useState, useEffect, Fragment, useMemo, useRef, useCallback } from 'react';
import { MainLayout } from '@/components/layout/main-layout';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ResizableTable } from '@/components/ui/resizable-table';
import { Search, Loader2, ChevronDown, ChevronRight, List, Map, Filter } from 'lucide-react';
import { sampleExportPath, useSamples, useAssemblies } from '@/lib/hooks/use-samples';
import type { Sample } from '@/lib/types';
import type { TableColumn } from '@/components/ui/resizable-table';
import { useStatistics } from '@/lib/hooks/use-statistics';
import { TableSkeleton } from '@/components/ui/loading-skeleton';
import { ColdLoadHint } from '@/components/ui/cold-load-hint';
import { CopyLinkButton } from '@/components/ui/copy-link-button';
import { Pagination } from '@/components/ui/pagination';
import { SampleCharts } from '@/components/statistics/SampleCharts';
import { getEnvironmentColor, formatBiomeLabel } from '@/lib/utils/metadata-parser';
import { formatGOLDBreadcrumb, getGOLDBadgeClass } from '@/lib/utils/gold-parser';
import { GOLD_BUCKET_LABEL, GOLD_BUCKET_ORDER, goldBucketLabel } from '@/lib/utils/gold-buckets';
import { formatDataSourceName } from '@/lib/utils/data-source-name';
import { ExportMenu } from '@/components/ui/export-menu';
import { ListErrorState } from '@/components/ui/list-error-state';
import { downloadText, exportFilename, serializeExport, type ExportFormat } from '@/lib/export/format';
import { METAGENOME_EXPORT_COLUMNS } from '@/lib/export/sample-columns';
import { ASSEMBLY_VIEW_EXPORT_REFUSAL, SAMPLE_TEXT_FILTER_EXPORT_REFUSAL } from '@/lib/export/refusal-messages';
import { MetadataDetails } from '@/components/ui/metadata-details';
import { AssemblyDetails } from '@/components/ui/assembly-details';
import { SampleMapDots } from '@/components/ui/sample-map-dots';
import type { AreaLinks } from '@/components/ui/sample-map-dots.client';
import { METAGENOME_AREA_LINKS } from '@/lib/utils/map-area-links';
import { SampleEnvironmentalPanel } from '@/components/ui/sample-environmental-panel';
import { SampleStudiesPanel } from '@/components/ui/sample-studies-panel';
import { BiomeLegend } from '@/components/ui/biome-legend';
import { FilterChips, type FilterChip } from '@/components/ui/filter-chips';
import { appliedFilterValue, formatAreaLabel, formatRangeLabel, optionLabel } from '@/lib/filter-chip-labels';
import { AdvancedFilterDrawer } from '@/components/filters/advanced-filter-drawer';
import { SampleGcfCount, SAMPLE_GCF_HEADER_TOOLTIP } from '@/components/ui/sample-gcf-count';
import { SampleDataSourceLinks } from '@/components/ui/sample-data-source-links';
import { RefetchFrame } from '@/components/ui/refetch-frame';
import { isDeepPageRefusal, isFilterRefusal } from '@/lib/api-client';
import { useLastKnown } from '@/lib/hooks/use-last-known';
import { StudyScopeChip } from '@/components/ui/study-scope-chip';
import { sampleFilterFields } from '@/lib/filters/field-definitions';
import { sampleFilterRecipes } from '@/lib/filters/recipes';
import { buildMetagenomeStatsFilters } from './samples-page-filters';
import {
  FilterGroup,
  createDefaultFilterGroup,
  deserializeFilterGroup,
  hasFilterRules,
  serializeFilterGroup,
  summarizeFilterGroup,
} from '@/lib/filters/types';
import {
  advancedFilterRequestParam,
  unreadableAdvancedFilterParam,
} from '@/lib/filters/advanced-filter-param';
import { readNumber, readOneOf, readPage, readPageSize, type UrlEntry } from '@/lib/url-state';
import { useExternalNavigationKey, useMirrorToUrl } from '@/lib/hooks/use-mirror-to-url';

export default function SamplesPage() {
  return (
    <Suspense fallback={null}>
      <SamplesPageKeyed />
    </Suspense>
  );
}

/** Remounts the page on a same-route navigation it did not write, so it re-seeds
 *  from the URL like a fresh visit (see useMirrorToUrl). */
function SamplesPageKeyed() {
  const navKey = useExternalNavigationKey();
  return <SamplesPageInner key={navKey} />;
}

/** The page sizes both Pagination controls offer; a `size` outside them reads as the default. */
const PAGE_SIZE_OPTIONS = [5, 10, 25, 50, 100];
const DEFAULT_PAGE_SIZE = 50;
/** The environment Select's "no filter" item; never a ?goldBucket= value. */
const ALL_ENVIRONMENTS = '__all__';

/** Every column the samples table can sort by (the API's sortFieldMap). */
const SAMPLE_SORT_FIELDS = [
  'id', 'dataSource', 'assemblies', 'bgcs', 'gcfs', 'location', 'biome', 'environment',
  'material', 'feature', 'host', 'study',
] as const;
/** The subset the assemblies view can sort by; /api/assemblies falls back to bgcs for the rest. */
const ASSEMBLY_SORT_FIELDS = ['bgcs', 'location', 'biome', 'environment', 'material', 'feature', 'host'] as const;
const DEFAULT_SORT_FIELD = 'bgcs';
const DEFAULT_SORT_ORDER = 'desc' as const;
const sortFieldsFor = (entity: 'samples' | 'assemblies'): readonly string[] =>
  entity === 'assemblies' ? ASSEMBLY_SORT_FIELDS : SAMPLE_SORT_FIELDS;

const BBOX_URL_KEYS = ['latMin', 'latMax', 'lonMin', 'lonMax'] as const;

/** `?view=assemblies` (the home page's assemblies stat) opens the assemblies rows. */
const readEntity = (raw: string): 'samples' | 'assemblies' =>
  raw === 'assemblies' ? 'assemblies' : 'samples';

function SamplesPageInner() {
  const searchParams = useSearchParams();
  const paramOr = (key: string, fallback = '') => searchParams.get(key) ?? fallback;

  // Every filter, the sort, the paging and the two view toggles are seeded from
  // the URL in useState initializers, so the first request already carries
  // them. useMirrorToUrl below writes them back and is the page's only URL
  // writer. A same-route navigation it did not write (the nav item's bare
  // /samples, Back to another filtered entry) remounts this component through
  // SamplesPageKeyed, so it seeds again from the new URL.
  //
  // Names other pages link with are kept: id (a BGC's sample link), view=assemblies
  // (the home page's assemblies stat), studyKey (a study's Samples panel), and the
  // map's area keys latMin..lonMax + goldBucket. Table vs map is `display`, so it
  // cannot collide with `view`.
  const [entityMode, setEntityMode] = useState(() => readEntity(paramOr('view')));
  const [viewMode, setViewMode] = useState<'table' | 'map'>(
    () => (paramOr('display') === 'map' ? 'map' : 'table'),
  );
  const [currentPage, setCurrentPage] = useState(() => readPage(paramOr('page')));
  const [pageSize, setPageSize] = useState(() =>
    readPageSize(paramOr('size'), PAGE_SIZE_OPTIONS, DEFAULT_PAGE_SIZE),
  );
  const [searchTerm, setSearchTerm] = useState(() => paramOr('search'));
  // RAW, not checked against GOLD_BUCKET_ORDER: the API refuses an unknown
  // bucket with a 400 that names it (parseGoldBucket), so a stale homepage deep
  // link says so instead of answering the whole corpus. Dropping it here would
  // undo that, and the mirror would erase the evidence from the URL. Filters the
  // server refuses are forwarded as they arrived, like advancedFilters; only
  // sort, order, page, size and the view toggles are validated here, since a
  // junk value of those cannot widen the result.
  const [goldBucketFilter, setGoldBucketFilter] = useState(() => paramOr('goldBucket'));
  // Exact key from ?studyKey=; the `study` column filter matches titles, and 710 titles are shared by several studies.
  // Trimmed, as /genome-collections does: a key is an identifier, so stray
  // whitespace from a pasted link is never part of it.
  const [studyKeyFilter, setStudyKeyFilter] = useState(() => paramOr('studyKey').trim());
  const [mounted, setMounted] = useState(false);
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const [expandedAssemblies, setExpandedAssemblies] = useState<Set<string>>(new Set());
  const prefetchedSamplesRef = useRef<Set<string>>(new Set());
  const prefetchSampleAssemblies = useCallback((sampleId: string) => {
    if (!sampleId) return;
    if (prefetchedSamplesRef.current.has(sampleId)) return;
    prefetchedSamplesRef.current.add(sampleId);
    // Warm the server cache; limit/offset match AssemblyDetails' first request.
    apiFetch(`/api/samples/${sampleId}/assemblies?limit=50&offset=0`).catch(() => {
      prefetchedSamplesRef.current.delete(sampleId);
    });
  }, []);
  const [activeTab, setActiveTab] = useState<Record<string, string>>({});
  // Validated against the entity the link opens in: the assemblies view sorts
  // by fewer columns, and the URL must not claim an order the server drops.
  const [sortField, setSortField] = useState<string>(() =>
    readOneOf(
      paramOr('sort'),
      sortFieldsFor(readEntity(paramOr('view'))),
      DEFAULT_SORT_FIELD,
    ),
  );
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>(
    () => readOneOf(paramOr('order'), ['asc', 'desc'] as const, DEFAULT_SORT_ORDER),
  );

  const [filterId, setFilterId] = useState(() => paramOr('id'));
  const [filterBiome, setFilterBiome] = useState(() => paramOr('biome'));
  const [filterGoldEcosystem, setFilterGoldEcosystem] = useState(() => paramOr('goldEcosystem'));
  const [filterEnvText, setFilterEnvText] = useState(() => paramOr('environment'));
  const [filterMaterial, setFilterMaterial] = useState(() => paramOr('material'));
  const [filterFeature, setFilterFeature] = useState(() => paramOr('feature'));
  const [filterHost, setFilterHost] = useState(() => paramOr('host'));
  const [filterDataSource, setFilterDataSource] = useState(() => paramOr('dataSource'));
  const [filterStudy, setFilterStudy] = useState(() => paramOr('study'));
  const [latMin, setLatMin] = useState<string>(() => readNumber(paramOr('latMin')));
  const [latMax, setLatMax] = useState<string>(() => readNumber(paramOr('latMax')));
  const [lonMin, setLonMin] = useState<string>(() => readNumber(paramOr('lonMin')));
  const [lonMax, setLonMax] = useState<string>(() => readNumber(paramOr('lonMax')));
  const [assembliesMin, setAssembliesMin] = useState<string>(() => readNumber(paramOr('assembliesMin')));
  const [assembliesMax, setAssembliesMax] = useState<string>(() => readNumber(paramOr('assembliesMax')));
  const [bgcsMin, setBgcsMin] = useState<string>(() => readNumber(paramOr('bgcsMin')));
  const [bgcsMax, setBgcsMax] = useState<string>(() => readNumber(paramOr('bgcsMax')));
  const [gcfsMin, setGcfsMin] = useState<string>(() => readNumber(paramOr('gcfsMin')));
  const [gcfsMax, setGcfsMax] = useState<string>(() => readNumber(paramOr('gcfsMax')));
  // A map area link opens with the location filter showing, as before.
  const [showFilters, setShowFilters] = useState<Record<string, boolean>>(() => ({
    location: BBOX_URL_KEYS.some((k) => readNumber(paramOr(k)) !== ''),
  }));
  const [advancedFiltersOpen, setAdvancedFiltersOpen] = useState(false);
  // Seeded, not synced in by an effect: the FIRST request has to carry it (or
  // its unreadable raw value, forwarded so the server refuses it), or the page
  // answers corpus-wide once before the filter arrives.
  const [advancedFilters, setAdvancedFilters] = useState<FilterGroup | null>(
    () => deserializeFilterGroup(paramOr('advancedFilters')) ?? null,
  );
  const [advancedFiltersDraft, setAdvancedFiltersDraft] = useState<FilterGroup>(
    () => deserializeFilterGroup(paramOr('advancedFilters')) ?? createDefaultFilterGroup(),
  );
  const [unreadableAdvancedParam, setUnreadableAdvancedParam] = useState<string | null>(
    () => unreadableAdvancedFilterParam(paramOr('advancedFilters')),
  );
  const hasAdvancedFiltersApplied = hasFilterRules(advancedFilters);
  const hasDraftAdvancedFilters = hasFilterRules(advancedFiltersDraft);
  const advancedFiltersEncoded = useMemo(
    () => serializeFilterGroup(hasAdvancedFiltersApplied ? advancedFilters : null),
    [advancedFilters, hasAdvancedFiltersApplied]
  );
  // Falls back to the unparseable raw URL value so the server refuses it, keeping the rule in one place.
  const advancedFiltersRequestParam = advancedFilterRequestParam(
    advancedFiltersEncoded,
    unreadableAdvancedParam,
  );
  const advancedFilterSummaries = useMemo(
    () => (hasAdvancedFiltersApplied && advancedFilters ? summarizeFilterGroup(advancedFilters, sampleFilterFields) : []),
    [advancedFilters, hasAdvancedFiltersApplied]
  );

  const [dataSourceOptions, setDataSourceOptions] = useState<{ label: string; value: string }[]>([]);
  useEffect(() => {
    let cancelled = false;
    apiFetch('/api/data-sources')
      .then(res => res.json())
      .then(payload => {
        if (cancelled) return;
        if (Array.isArray(payload?.data)) {
          const environmentalSources = payload.data.filter(
            (d: { name: string; source_type?: string }) =>
              ['metalog', 'SPIRE', 'MGnify'].includes(d.name) || d.source_type === 'custom'
          );
          const options = environmentalSources.map((d: { id: string; name: string }) => ({ label: formatDataSourceName(d.name), value: d.id }));
          setDataSourceOptions(options);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setDataSourceOptions([]);
        }
      });
    return () => { cancelled = true; };
  }, []);

  // Dropping the study scope drops it from the URL too (through the mirror), so a
  // copied link or a reload doesn't silently re-apply the filter just cleared.
  const clearStudyKey = () => {
    setStudyKeyFilter('');
    setCurrentPage(0);
  };

  const clearIdFilter = () => {
    setFilterId('');
    setCurrentPage(0);
  };

  const clearAreaFilter = () => {
    setLatMin('');
    setLatMax('');
    setLonMin('');
    setLonMax('');
    setCurrentPage(0);
  };

  const applyAdvancedFilters = () => {
    const hasDraft = hasFilterRules(advancedFiltersDraft);
    const nextFilters = hasDraft ? advancedFiltersDraft : null;
    setAdvancedFilters(nextFilters);
    setUnreadableAdvancedParam(null);
    setAdvancedFiltersOpen(false);
    setCurrentPage(0);
  };

  const clearAdvancedFilters = () => {
    setAdvancedFilters(null);
    setUnreadableAdvancedParam(null);
    setAdvancedFiltersDraft(createDefaultFilterGroup());
    setAdvancedFiltersOpen(false);
    setCurrentPage(0);
  };

  const clearAllFilters = () => {
    setSearchTerm('');
    setGoldBucketFilter('');
    setStudyKeyFilter('');
    setFilterId('');
    setFilterBiome('');
    setFilterGoldEcosystem('');
    setFilterEnvText('');
    setFilterMaterial('');
    setFilterFeature('');
    setFilterHost('');
    setFilterDataSource('');
    setFilterStudy('');
    setLatMin('');
    setLatMax('');
    setLonMin('');
    setLonMax('');
    setAssembliesMin('');
    setAssembliesMax('');
    setBgcsMin('');
    setBgcsMax('');
    setGcfsMin('');
    setGcfsMax('');
    clearAdvancedFilters();
    setCurrentPage(0);
  };

  const hasAnyColumnFilter =
    Boolean(filterId || filterBiome || filterGoldEcosystem || filterEnvText || filterMaterial ||
      filterFeature || filterHost || filterDataSource || filterStudy ||
      latMin || latMax || lonMin || lonMax || assembliesMin || assembliesMax || bgcsMin || bgcsMax || gcfsMin || gcfsMax);

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
  const dBiome = useDebouncedValue(filterBiome);
  const dGoldEcosystem = useDebouncedValue(filterGoldEcosystem);
  const dEnvText = useDebouncedValue(filterEnvText);
  const dMaterial = useDebouncedValue(filterMaterial);
  const dFeature = useDebouncedValue(filterFeature);
  const dHost = useDebouncedValue(filterHost);
  const dDataSource = useDebouncedValue(filterDataSource);
  const dStudy = useDebouncedValue(filterStudy);
  const dLatMin = useDebouncedValue(latMin);
  const dLatMax = useDebouncedValue(latMax);
  const dLonMin = useDebouncedValue(lonMin);
  const dLonMax = useDebouncedValue(lonMax);
  const dAsmMin = useDebouncedValue(assembliesMin);
  const dAsmMax = useDebouncedValue(assembliesMax);
  const dBgcMin = useDebouncedValue(bgcsMin);
  const dBgcMax = useDebouncedValue(bgcsMax);
  const dGcfMin = useDebouncedValue(gcfsMin);
  const dGcfMax = useDebouncedValue(gcfsMax);


  const filters = {
    id: filterId,
    assemblies: { min: assembliesMin, max: assembliesMax },
    bgcs: { min: bgcsMin, max: bgcsMax },
    gcfs: { min: gcfsMin, max: gcfsMax },
    biome: filterBiome,
    goldEcosystem: filterGoldEcosystem,
    environment: filterEnvText,
    material: filterMaterial,
    feature: filterFeature,
    host: filterHost,
    dataSource: filterDataSource,
    study: filterStudy,
    location: { latMin, latMax, lonMin, lonMax },
  };

  const handleFilterToggle = (columnId: string, show: boolean) => {
    setShowFilters(prev => ({ ...prev, [columnId]: show }));
  };

  const handleFilterChange = (columnId: string, value: unknown) => {
    const str = typeof value === 'string' ? value : '';
    const range = (value && typeof value === 'object' ? value : {}) as {
      min?: string;
      max?: string;
      latMin?: string;
      latMax?: string;
      lonMin?: string;
      lonMax?: string;
    };
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
      case 'gcfs':
        setGcfsMin(range.min ?? '');
        setGcfsMax(range.max ?? '');
        break;
      case 'biome':
        setFilterBiome(str);
        break;
      case 'goldEcosystem':
        setFilterGoldEcosystem(str);
        break;
      case 'environment':
        setFilterEnvText(str);
        break;
      case 'material':
        setFilterMaterial(str);
        break;
      case 'feature':
        setFilterFeature(str);
        break;
      case 'host':
        setFilterHost(str);
        break;
      case 'dataSource':
        setFilterDataSource(str);
        break;
      case 'study':
        setFilterStudy(str);
        break;
      case 'location':
        setLatMin(range.latMin ?? '');
        setLatMax(range.latMax ?? '');
        setLonMin(range.lonMin ?? '');
        setLonMax(range.lonMax ?? '');
        break;
    }
  };

  const statsFilters = buildMetagenomeStatsFilters({
    search: dSearch,
    id: dId,
    biome: dBiome,
    environmentText: dEnvText,
    material: dMaterial,
    feature: dFeature,
    host: dHost,
    dataSource: dDataSource,
    study: dStudy,
    studyKey: studyKeyFilter || undefined,
    latMin: dLatMin ? Number(dLatMin) : undefined,
    latMax: dLatMax ? Number(dLatMax) : undefined,
    lonMin: dLonMin ? Number(dLonMin) : undefined,
    lonMax: dLonMax ? Number(dLonMax) : undefined,
    assembliesMin: dAsmMin ? Number(dAsmMin) : undefined,
    assembliesMax: dAsmMax ? Number(dAsmMax) : undefined,
    bgcsMin: dBgcMin ? Number(dBgcMin) : undefined,
    bgcsMax: dBgcMax ? Number(dBgcMax) : undefined,
    gcfsMin: dGcfMin ? Number(dGcfMin) : undefined,
    gcfsMax: dGcfMax ? Number(dGcfMax) : undefined,
    goldBucket: goldBucketFilter || undefined,
    advancedFilters: advancedFiltersRequestParam,
  });

  const [columnVisibility, setColumnVisibility] = useState<Record<string, boolean>>({
    id: true,
    dataSource: true,
    assemblies: true,
    bgcs: true,
    gcfs: true,
    location: true,
    biome: false,
    goldEcosystem: true,
    environment: false,
    material: false,
    feature: false,
    host: false,
    study: false,
  });
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>({
    id: 180,
    dataSource: 220,
    assemblies: 200,
    bgcs: 180,
    gcfs: 140,
    location: 260,
    biome: 180,
    goldEcosystem: 260,
    environment: 220,
    material: 180,
    feature: 180,
    host: 200,
    study: 260,
  });


  // Prevent hydration mismatch
  useEffect(() => {
    setMounted(true);
  }, []);

  const sampleFilterParams = {
    goldBucket: goldBucketFilter || undefined,
    biome: dBiome || undefined,
    goldEcosystem: dGoldEcosystem || undefined,
    search: dSearch || undefined,
    sortField,
    sortOrder,
    id: dId || undefined,
    environmentText: dEnvText || undefined,
    material: dMaterial || undefined,
    feature: dFeature || undefined,
    host: dHost || undefined,
    dataSource: dDataSource || undefined,
    study: dStudy || undefined,
    studyKey: studyKeyFilter || undefined,
    latMin: dLatMin ? Number(dLatMin) : undefined,
    latMax: dLatMax ? Number(dLatMax) : undefined,
    lonMin: dLonMin ? Number(dLonMin) : undefined,
    lonMax: dLonMax ? Number(dLonMax) : undefined,
    assembliesMin: dAsmMin ? Number(dAsmMin) : undefined,
    assembliesMax: dAsmMax ? Number(dAsmMax) : undefined,
    bgcsMin: dBgcMin ? Number(dBgcMin) : undefined,
    bgcsMax: dBgcMax ? Number(dBgcMax) : undefined,
    gcfsMin: dGcfMin ? Number(dGcfMin) : undefined,
    gcfsMax: dGcfMax ? Number(dGcfMax) : undefined,
    sourceType: 'metagenome' as const,
    advancedFilters: advancedFiltersRequestParam,
  };
  // Any change to the sent parameters resets to page 1, during render so no request leaves at the old offset.
  const filterSignature = JSON.stringify(sampleFilterParams);
  const [pagedUnder, setPagedUnder] = useState(filterSignature);
  if (pagedUnder !== filterSignature) {
    setPagedUnder(filterSignature);
    setCurrentPage(0);
  }
  const offset = (pagedUnder === filterSignature ? currentPage : 0) * pageSize;

  // The page's ONE URL writer (see useMirrorToUrl). Text and range filters are
  // mirrored DEBOUNCED, as they are sent, so the URL names the rows on screen
  // rather than a half-typed word. The advanced filter is the value forwarded,
  // so an unreadable link keeps its evidence in the URL and the server goes on
  // refusing it. Column widths and visibility, expanded rows and their tabs
  // stay out: they describe the display, not the result set.
  useMirrorToUrl(
    [
      ['search', dSearch],
      ['goldBucket', goldBucketFilter],
      ['studyKey', studyKeyFilter],
      ['id', dId],
      ['biome', dBiome],
      ['goldEcosystem', dGoldEcosystem],
      ['environment', dEnvText],
      ['material', dMaterial],
      ['feature', dFeature],
      ['host', dHost],
      ['dataSource', dDataSource],
      ['study', dStudy],
      ['latMin', dLatMin],
      ['latMax', dLatMax],
      ['lonMin', dLonMin],
      ['lonMax', dLonMax],
      ['assembliesMin', dAsmMin],
      ['assembliesMax', dAsmMax],
      ['bgcsMin', dBgcMin],
      ['bgcsMax', dBgcMax],
      ['gcfsMin', dGcfMin],
      ['gcfsMax', dGcfMax],
      ['advancedFilters', advancedFiltersRequestParam ?? ''],
      ['sort', sortField, DEFAULT_SORT_FIELD],
      ['order', sortOrder, DEFAULT_SORT_ORDER],
      ['page', currentPage + 1, 1],
      ['size', pageSize, DEFAULT_PAGE_SIZE],
      ['view', entityMode === 'assemblies' ? 'assemblies' : ''],
      ['display', viewMode === 'map' ? 'map' : ''],
    ] satisfies UrlEntry[],
    mounted,
  );

  const sampleQueryParams = { limit: pageSize, offset, ...sampleFilterParams };

  const mapFilterParams = {
    goldBucket: goldBucketFilter || undefined,
    biome: dBiome || undefined,
    goldEcosystem: dGoldEcosystem || undefined,
    search: dSearch || undefined,
    id: dId || undefined,
    environmentText: dEnvText || undefined,
    material: dMaterial || undefined,
    feature: dFeature || undefined,
    host: dHost || undefined,
    dataSource: dDataSource || undefined,
    study: dStudy || undefined,
    studyKey: studyKeyFilter || undefined,
    latMin: dLatMin ? Number(dLatMin) : undefined,
    latMax: dLatMax ? Number(dLatMax) : undefined,
    lonMin: dLonMin ? Number(dLonMin) : undefined,
    lonMax: dLonMax ? Number(dLonMax) : undefined,
    assembliesMin: dAsmMin ? Number(dAsmMin) : undefined,
    assembliesMax: dAsmMax ? Number(dAsmMax) : undefined,
    bgcsMin: dBgcMin ? Number(dBgcMin) : undefined,
    bgcsMax: dBgcMax ? Number(dBgcMax) : undefined,
    gcfsMin: dGcfMin ? Number(dGcfMin) : undefined,
    gcfsMax: dGcfMax ? Number(dGcfMax) : undefined,
    sourceType: 'metagenome' as const,
    advancedFilters: advancedFiltersRequestParam,
  };

  // Unfiltered, the map serves the static snapshot; any filter uses the live query so the dots match the table.
  // Every key but the fixed source type is a filter, so this is derived rather than
  // listed: a hand-kept list left out gcfsMin/gcfsMax, and a "# GCFs" range alone
  // showed the unfiltered snapshot beside a filtered table.
  const mapHasActiveFilters = Object.entries(mapFilterParams).some(
    ([key, value]) => key !== 'sourceType' && value !== undefined && value !== null && value !== '',
  );

  // Both hooks always run (rules of hooks); the inactive one is disabled so it sends no request.
  const samplesQuery = useSamples({ ...sampleQueryParams, enabled: entityMode === 'samples' });
  const assembliesQuery = useAssemblies({ ...sampleQueryParams, enabled: entityMode === 'assemblies' });
  const { data, isLoading, isFetching, error, hasLoaded: samplesLoaded, refetch } =
    entityMode === 'assemblies' ? assembliesQuery : samplesQuery;
  // The pager's total under a deep-page refusal (see pagerShown below). Called
  // here, above the !mounted early return, as a hook must be.
  const pagerItems = useLastKnown(
    error ? 0 : (data?.data?.total || 0),
    !error,
    JSON.stringify({ entityMode, ...sampleFilterParams }),
  );

  const { data: statisticsData, isLoading: statsLoading } = useStatistics('metagenome');

  const handlePageSizeChange = (newPageSize: number) => {
    setPageSize(newPageSize);
    setCurrentPage(0);
  };

  const handlePageChange = (newPage: number) => {
    setCurrentPage(newPage);
  };

  const toggleRowExpansion = (sampleId: string | number) => {
    const key = String(sampleId);
    let willExpand = false;
    setExpandedRows(prev => {
      const next = new Set(prev);
      willExpand = !next.has(key);
      if (willExpand) {
        next.add(key);
      } else {
        next.delete(key);
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

  const handleViewModeChange = (mode: 'table' | 'map') => {
    setViewMode(mode);
    setCurrentPage(0);
  };

  const handleEntityModeChange = (mode: 'samples' | 'assemblies') => {
    setEntityMode(mode);
    setCurrentPage(0);
    // A sort the assemblies view cannot honour goes back to the default, so the
    // URL never claims an order /api/assemblies drops.
    if (!sortFieldsFor(mode).includes(sortField)) {
      setSortField(DEFAULT_SORT_FIELD);
      setSortOrder(DEFAULT_SORT_ORDER);
    }
  };

  // "View samples" on this page's own map narrows this list to the box (and the
  // legend's bucket, when one is picked) and shows the table, keeping the other
  // filters the dots were drawn under. A link to /samples?box from /samples
  // would remount the page as a fresh visit and drop them.
  const applyMapArea = useCallback((box: URLSearchParams) => {
    setLatMin(box.get('latMin') ?? '');
    setLatMax(box.get('latMax') ?? '');
    setLonMin(box.get('lonMin') ?? '');
    setLonMax(box.get('lonMax') ?? '');
    const bucket = readOneOf(box.get('goldBucket') ?? '', GOLD_BUCKET_ORDER);
    if (bucket) setGoldBucketFilter(bucket);
    setShowFilters((prev) => ({ ...prev, location: true }));
    setViewMode('table');
    setCurrentPage(0);
  }, []);
  const mapAreaLinks = useMemo<AreaLinks>(
    () => ({ ...METAGENOME_AREA_LINKS, onViewSamples: applyMapArea }),
    [applyMapArea],
  );

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

  // Nothing from a failed request reaches the table, the counts or the export:
  // the error state below stands in for all of them.
  const samples = error ? [] : (data?.data?.data || []);
  const total = error ? 0 : (data?.data?.total || 0);

  // Under a deep-page refusal the pager stays, at the last total the list
  // reported, so the reader can step back; any other error hides it, where
  // "Showing 1–0 of 0" would read as an empty result.
  const pagerShown = !error || isDeepPageRefusal(error);
  const pagerPages = Math.ceil(pagerItems / pageSize);
  const statistics = statisticsData?.data || null;

  const hasAnyFilter = Boolean(searchTerm || goldBucketFilter || studyKeyFilter || hasAnyColumnFilter || hasAdvancedFiltersApplied);

  const emptyState = (
    <div className="py-12 text-center text-muted-foreground">
      <p className="text-lg">No metagenomes found</p>
      {(searchTerm || goldBucketFilter) ? (
        <div className="text-sm space-y-1">
          <p>No matches for your search criteria:</p>
          {searchTerm && <p className="font-mono bg-muted px-2 py-1 rounded inline-block">&quot;{searchTerm}&quot;</p>}
          {goldBucketFilter && <p className="font-mono bg-muted px-2 py-1 rounded inline-block">{goldBucketLabel(goldBucketFilter)}</p>}
          <p>Try different keywords or clear filters</p>
        </div>
      ) : (
        <p className="text-sm">Try adjusting your search or filter criteria</p>
      )}
      {hasAnyFilter && (
        <div className="mt-4">
          <Button variant="outline" size="sm" onClick={clearAllFilters}>
            Clear all filters
          </Button>
        </div>
      )}
    </div>
  );


  // First load only: a refetch keeps the table mounted (see RefetchFrame).
  const tableLoading = !samplesLoaded || isLoading;
  const tableEmptyState = samplesLoaded ? emptyState : null;

  const columns: TableColumn<Sample>[] = [
    {
      id: 'id',
      label: entityMode === 'assemblies' ? 'Assembly' : 'Sample ID',
      width: columnWidths.id,
      minWidth: 120,
      sortable: entityMode === 'samples',
      filterable: true,
      filterType: 'text' as const,
      visible: columnVisibility.id,
      renderCell: (sample: Sample) => {
        if (entityMode === 'assemblies') {
          const label = sample.assemblyName || sample.assemblyId || sample.id;
          return <span className="font-medium font-mono text-xs truncate block" title={String(label)}>{label}</span>;
        }
        const isExpanded = expandedRows.has(String(sample.id));
        const label = sample.externalId || sample.id;
        return (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => toggleRowExpansion(sample.id)}
            onMouseEnter={() => prefetchSampleAssemblies(sample.id)}
            onFocus={() => prefetchSampleAssemblies(sample.id)}
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
      sortable: entityMode === 'samples',
      defaultSortDirection: 'desc',
      filterable: entityMode === 'samples',
      filterType: 'range' as const,
      visible: columnVisibility.assemblies,
      className: 'text-center',
      renderCell: (sample: Sample) => {
        if (entityMode === 'assemblies') {
          if (!sample.antismashRunId) {
            return <span className="text-muted-foreground">—</span>;
          }
          return (
            <Button variant="outline" size="sm" className="h-7 px-2 gap-1.5" asChild>
              <Link href={`/antismash/${sample.antismashRunId}`} target="_blank" rel="noopener noreferrer" className="cursor-pointer inline-flex items-center gap-1.5" title="View antiSMASH">
                <Image src={withBase('/images/antismash_logo.svg')} alt="antiSMASH" width={14} height={14} className="h-3.5 w-auto" />
                <span className="text-xs">antiSMASH</span>
              </Link>
            </Button>
          );
        }
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
            onMouseEnter={() => !disabled && prefetchSampleAssemblies(sample.id)}
            onFocus={() => !disabled && prefetchSampleAssemblies(sample.id)}
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
      minWidth: 120,
      sortable: true,
      defaultSortDirection: 'desc',
      filterable: true,
      filterType: 'range' as const,
      visible: columnVisibility.bgcs,
      className: 'text-center',
      renderCell: (sample: Sample) => {
        const href = entityMode === 'assemblies'
          ? `/bgcs?assembly=${encodeURIComponent(sample.assemblyId ?? sample.id)}`
          : `/bgcs?sampleId=${sample.id}`;
        if ((sample.bgcCount ?? 0) > 0) {
          return (
            <Link
              href={href}
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
      id: 'gcfs',
      label: '# GCFs',
      headerTooltip: SAMPLE_GCF_HEADER_TOOLTIP,
      width: columnWidths.gcfs,
      minWidth: 110,
      // The map endpoint joins the same counts MV, so a range here narrows the map identically.
      sortable: entityMode === 'samples',
      defaultSortDirection: 'desc',
      filterable: entityMode === 'samples',
      filterType: 'range' as const,
      visible: columnVisibility.gcfs,
      className: 'text-center',
      // Shared with the /studies/[id] Samples panel so the two cannot drift.
      renderCell: (sample: Sample) => <SampleGcfCount sample={sample} />,
    },
    {
      id: 'location',
      label: 'Location',
      width: columnWidths.location,
      minWidth: 200,
      sortable: true,
      filterable: true,
      filterType: 'text' as const,
      visible: columnVisibility.location,
      renderCell: (sample: Sample) => (
        <span
          className="truncate text-sm"
          title={sample.location}
        >
          {sample.location || '-'}
        </span>
      ),
      renderFilter: (filterState: unknown, onChange: (value: unknown) => void) => {
        const locState = (filterState && typeof filterState === 'object' ? filterState : {}) as {
          latMin?: string; latMax?: string; lonMin?: string; lonMax?: string;
        };
        return (
          <div className="grid grid-cols-2 gap-1">
            <Input
              type="number"
              step="any"
              placeholder="lat min"
              value={locState.latMin ?? ''}
              onChange={(e) => onChange({ ...locState, latMin: e.target.value })}
              className="h-8 text-xs"
            />
            <Input
              type="number"
              step="any"
              placeholder="lat max"
              value={locState.latMax ?? ''}
              onChange={(e) => onChange({ ...locState, latMax: e.target.value })}
              className="h-8 text-xs"
            />
            <Input
              type="number"
              step="any"
              placeholder="lon min"
              value={locState.lonMin ?? ''}
              onChange={(e) => onChange({ ...locState, lonMin: e.target.value })}
              className="h-8 text-xs"
            />
            <Input
              type="number"
              step="any"
              placeholder="lon max"
              value={locState.lonMax ?? ''}
              onChange={(e) => onChange({ ...locState, lonMax: e.target.value })}
              className="h-8 text-xs"
            />
          </div>
        );
      }
    },
    {
      id: 'biome',
      label: 'Biome',
      width: columnWidths.biome,
      minWidth: 160,
      sortable: true,
      filterable: true,
      filterType: 'text' as const,
      visible: columnVisibility.biome,
      renderCell: (sample: Sample) => {
        const rawBiomeCandidate = typeof sample.primaryBiome === 'string' ? sample.primaryBiome.trim() : '';
        const rawBiomeFallback = typeof sample.environmentBiome === 'string' ? sample.environmentBiome.trim() : '';
        const rawBiome = rawBiomeCandidate || rawBiomeFallback;

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
      id: 'goldEcosystem',
      label: 'GOLD Ecosystem',
      width: columnWidths.goldEcosystem || 240,
      minWidth: 200,
      sortable: false,
      filterable: true,
      filterType: 'text' as const,
      visible: columnVisibility.goldEcosystem ?? true,
      renderCell: (sample: Sample) => {
        const path = sample.goldEcosystemPath;
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
      id: 'environment',
      label: 'Environment',
      width: columnWidths.environment,
      minWidth: 200,
      sortable: true,
      filterable: true,
      filterType: 'text' as const,
      visible: columnVisibility.environment,
      renderCell: (sample: Sample) => {
        const environmentRaw = typeof sample.environment === 'string' ? sample.environment.trim() : '';

        if (!environmentRaw) {
          return <span className="text-sm text-muted-foreground">-</span>;
        }

        return (
          <span className="text-sm truncate block" title={environmentRaw}>
            {environmentRaw}
          </span>
        );
      }
    },
    {
      id: 'material',
      label: 'Material',
      width: columnWidths.material,
      minWidth: 140,
      sortable: true,
      filterable: true,
      filterType: 'text' as const,
      visible: columnVisibility.material,
      renderCell: (sample: Sample) => (
        <span
          className="text-sm truncate block"
          title={sample.environmentMaterial}
        >
          {sample.environmentMaterial || '-'}
        </span>
      )
    },
    {
      id: 'feature',
      label: 'Feature',
      width: columnWidths.feature,
      minWidth: 140,
      sortable: true,
      filterable: true,
      filterType: 'text' as const,
      visible: columnVisibility.feature,
      renderCell: (sample: Sample) => (
        <span
          className="text-sm truncate block"
          title={sample.environmentFeature}
        >
          {sample.environmentFeature || '-'}
        </span>
      )
    },
    {
      id: 'host',
      label: 'Host',
      width: columnWidths.host,
      minWidth: 150,
      sortable: true,
      filterable: true,
      filterType: 'text' as const,
      visible: columnVisibility.host,
      renderCell: (sample: Sample) => {
        const display = sample.hostSpecies || (sample.hostTaxid != null ? String(sample.hostTaxid) : '');
        return (
          <span
            className="text-sm truncate block"
            title={display || undefined}
          >
            {display || '-'}
          </span>
        );
      }
    },
    {
      id: 'study',
      label: 'Study',
      width: columnWidths.study,
      minWidth: 200,
      // Not in the assembly-mode sort map (sb array column) — avoid a misleading sort arrow.
      sortable: entityMode === 'samples',
      filterable: true,
      filterType: 'text' as const,
      visible: columnVisibility.study,
      renderCell: (sample: Sample) => {
        const studyTitles = Array.isArray(sample.studyTitles) ? sample.studyTitles : [];
        const primaryStudy = studyTitles[0];
        const tooltip = studyTitles.length > 1 ? studyTitles.join(', ') : primaryStudy;
        return (
          <span
            className="text-sm truncate block"
            title={tooltip || undefined}
          >
            {primaryStudy || '-'}
          </span>
        );
      }
    },
    {
      id: 'dataSource',
      label: 'Data Source',
      width: columnWidths.dataSource,
      minWidth: 180,
      // Not in the assembly-mode sort map (sb array column) — avoid a misleading sort arrow.
      sortable: entityMode === 'samples',
      filterable: true,
      filterType: 'select' as const,
      filterOptions: dataSourceOptions,
      visible: columnVisibility.dataSource,
      renderCell: (sample: Sample) => (
        <SampleDataSourceLinks names={sample.dataSourceNames} externalId={sample.externalId} />
      )
    }
  ];

  // Same serializer as the streamed "All matching" export, so a page is a slice of that file.
  const handleDownload = (format: ExportFormat) => {
    const stem = entityMode === 'assemblies' ? 'assemblies' : 'metagenomes';
    downloadText(
      serializeExport(samples, METAGENOME_EXPORT_COLUMNS, format),
      exportFilename(`${stem}_page${currentPage + 1}`, samples.length, samples.length, format),
      format,
    );
  };
  // The full result is read from the search index; these are answered by
  // PostgreSQL, so "All matching" is offered with the reason instead.
  const allExportRefusal = entityMode === 'assemblies'
    ? ASSEMBLY_VIEW_EXPORT_REFUSAL
    : (sampleFilterParams.environmentText || sampleFilterParams.host)
      ? SAMPLE_TEXT_FILTER_EXPORT_REFUSAL
      : null;

  const fmt = (value?: number | null): string =>
    statsLoading ? '—' : (value ?? 0).toLocaleString();

  // Every active filter gets a chip, column filters included: a copied link can
  // carry ?host= or ?bgcsMin= while that filter row is closed, its column is
  // hidden or the page is in map view, and nothing else on screen would say the
  // table is narrowed. Values are the APPLIED ones (what the request sends), see
  // appliedFilterValue.
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
    {
      key: 'id',
      label: entityMode === 'assemblies' ? 'Assembly' : 'Sample ID',
      value: ap(filterId, dId),
      onRemove: clearIdFilter,
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
      key: 'gcfs',
      label: 'GCFs',
      value: formatRangeLabel(ap(gcfsMin, dGcfMin), ap(gcfsMax, dGcfMax)),
      onRemove: () => { setGcfsMin(''); setGcfsMax(''); },
    },
    {
      key: 'area',
      label: 'Area',
      value: formatAreaLabel({
        latMin: ap(latMin, dLatMin),
        latMax: ap(latMax, dLatMax),
        lonMin: ap(lonMin, dLonMin),
        lonMax: ap(lonMax, dLonMax),
      }),
      onRemove: clearAreaFilter,
    },
    { key: 'biome', label: 'Biome', value: ap(filterBiome, dBiome), onRemove: () => setFilterBiome('') },
    {
      key: 'goldEcosystem',
      label: 'GOLD Ecosystem',
      value: ap(filterGoldEcosystem, dGoldEcosystem),
      onRemove: () => setFilterGoldEcosystem(''),
    },
    {
      // Not "Environment": that is the bucket chip above. This is the
      // Environment column's free-text match.
      key: 'environment',
      label: 'Environment (text)',
      value: ap(filterEnvText, dEnvText),
      onRemove: () => setFilterEnvText(''),
    },
    { key: 'material', label: 'Material', value: ap(filterMaterial, dMaterial), onRemove: () => setFilterMaterial('') },
    { key: 'feature', label: 'Feature', value: ap(filterFeature, dFeature), onRemove: () => setFilterFeature('') },
    { key: 'host', label: 'Host', value: ap(filterHost, dHost), onRemove: () => setFilterHost('') },
    { key: 'study', label: 'Study', value: ap(filterStudy, dStudy), onRemove: () => setFilterStudy('') },
    ...(hasAdvancedFiltersApplied
      ? advancedFilterSummaries.map((summary, index) => ({
          key: `advanced-${index}`,
          label: 'Advanced',
          value: summary,
          onRemove: clearAdvancedFilters,
        }))
      : []),
  ].filter((chip) => chip.value);

  return (
    <MainLayout>
      <div className="w-full py-6">
        <header className="mb-6 border-b border-border pb-4">
          <h1 className="atlas-rule mb-3 text-2xl font-semibold tracking-tight md:text-3xl">
            Metagenomes
          </h1>
          <p className="mt-3 max-w-3xl text-[14px] leading-relaxed text-muted-foreground">
            Metagenomic samples from diverse sources
          </p>
        </header>

        <section className="mb-6 border-b border-border pb-4">
          {/* One column on phones: a nowrap .leader-row in a half-column overflowed a 390px viewport. */}
          <dl className="grid grid-cols-1 gap-x-8 gap-y-2 text-sm sm:grid-cols-3 lg:grid-cols-5">
            <div className="leader-row">
              <dt className="whitespace-nowrap text-muted-foreground">Total samples</dt>
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

        {/* A refused filter suppresses the section (the charts return null for
            their own refusal; this drops the empty section's margin too). */}
        {!isFilterRefusal(error) && (
          <section className="mb-8">
            <SampleCharts
              {...statsFilters}
              staticManifestUrl="/data/sample-charts.manifest.json"
            />
          </section>
        )}

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
                placeholder="Search by name, study, environment, location, host species…"
                className="h-8 pl-7 text-[13px]"
                value={searchTerm}
                onChange={(e) => handleSearch(e.target.value)}
                aria-label="Search metagenomes"
              />
            </div>

            {/* ALL_ENVIRONMENTS stands in for no filter: Radix refuses '' as
                an item value. It is not 'all' (as /bgcs uses), because
                ?goldBucket=all is a plausible stale link and must show as
                itself. A value outside GOLD_BUCKET_ORDER (a refused link)
                gets its own item, so the control shows what the server
                refused instead of claiming "All environments". */}
            <Select
              value={goldBucketFilter || ALL_ENVIRONMENTS}
              onValueChange={(val) => setGoldBucketFilter(val === ALL_ENVIRONMENTS ? '' : val)}
            >
              <SelectTrigger
                size="sm"
                aria-label="Environment filter"
                className="w-[180px] text-[13px]"
              >
                <SelectValue placeholder="All environments" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_ENVIRONMENTS}>All environments</SelectItem>
                {goldBucketFilter &&
                  goldBucketFilter !== ALL_ENVIRONMENTS &&
                  !(GOLD_BUCKET_ORDER as string[]).includes(goldBucketFilter) && (
                    <SelectItem value={goldBucketFilter}>
                      {goldBucketLabel(goldBucketFilter)}
                    </SelectItem>
                  )}
                {GOLD_BUCKET_ORDER.map((bucket) => (
                  <SelectItem key={bucket} value={bucket}>
                    {GOLD_BUCKET_LABEL[bucket]}
                  </SelectItem>
                ))}
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
              onClick={clearAllFilters}
            >
              Clear
            </Button>

            <CopyLinkButton className="ml-auto" />

            {viewMode === 'table' && (
              <div className="inline-flex rounded-md border bg-background p-0.5" role="group" aria-label="Row type">
                <Button type="button" variant={entityMode === 'samples' ? 'secondary' : 'ghost'} size="sm" className="h-7 px-3" aria-pressed={entityMode === 'samples'} onClick={() => handleEntityModeChange('samples')}>Samples</Button>
                <Button type="button" variant={entityMode === 'assemblies' ? 'secondary' : 'ghost'} size="sm" className="h-7 px-3" aria-pressed={entityMode === 'assemblies'} onClick={() => handleEntityModeChange('assemblies')}>Assemblies</Button>
              </div>
            )}

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
          </div>
        </section>

        <AdvancedFilterDrawer
          open={advancedFiltersOpen}
          onOpenChange={setAdvancedFiltersOpen}
          fields={sampleFilterFields}
          recipes={sampleFilterRecipes}
          storageKey="sample-advanced-filters"
          draft={advancedFiltersDraft}
          onDraftChange={setAdvancedFiltersDraft}
          onApply={applyAdvancedFilters}
          onClear={clearAdvancedFilters}
          hasDraft={hasDraftAdvancedFilters}
          hasApplied={hasAdvancedFiltersApplied}
          appliedCount={advancedFilterSummaries.length}
        />

        <FilterChips
          className="mb-6"
          filters={filterChipsList}
          onClearAll={clearAllFilters}
        />

        <section>
          <div className="mb-3 flex items-end justify-between gap-4 border-b border-border pb-2">
            <div>
              <h2 className="mt-0.5 text-sm font-medium">
                {viewMode === 'table' ? 'Metagenome collection' : 'Metagenome locations'}
              </h2>
              {viewMode === 'table' && (
                <div className="mt-2">
                  <BiomeLegend />
                </div>
              )}
            </div>
            {viewMode === 'table' && (
              <ExportMenu
                pageRows={samples.length}
                onPageExport={handleDownload}
                total={total}
                exportPath={allExportRefusal ? null : sampleExportPath(sampleFilterParams, 'metagenomes')}
                allDisabledReason={allExportRefusal}
              />
            )}
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
              <ListErrorState error={error} noun="metagenomes" onRetry={refetch} retrying={isFetching} />
            ) : viewMode === 'map' ? (
              mapHasActiveFilters ? (
                <SampleMapDots
                  params={{
                    ...mapFilterParams,
                    enabled: viewMode === 'map',
                  }}
                  areaLinks={mapAreaLinks}
                />
              ) : (
                <SampleMapDots staticManifestUrl="/data/map-samples.manifest.json" areaLinks={mapAreaLinks} />
              )
            ) : error ? (
              <ListErrorState
                error={error}
                noun="metagenomes"
                onRetry={refetch}
                retrying={isFetching}
                onFirstPage={() => setCurrentPage(0)}
              />
            ) : tableLoading ? (
              <div className="space-y-6">
                <ColdLoadHint loading={tableLoading} label="Loading metagenomes" />
                <TableSkeleton rows={Math.min(pageSize, 10)} />
              </div>
            ) : (
              <RefetchFrame refetching={isFetching} label="Updating metagenomes">
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
                  if (entityMode === 'assemblies') return null;
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

                  const tabs = [
                    { id: 'assemblies', label: 'Assemblies' },
                    { id: 'metadata', label: 'Metadata' },
                    { id: 'environment', label: 'Environment' },
                    { id: 'studies', label: 'Studies' }
                  ];

                  return (
                    <div id={`expanded-${idKey}`} className="border-t bg-muted/30">

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
                            {currentTab === 'metadata' && (
                              <MetadataDetails sample={sample} />
                            )}
                          </>
                        )}
                        {(showMeta || showAssemblies) && currentTab === 'assemblies' && (
                          <AssemblyDetails sampleId={sample.id} />
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
