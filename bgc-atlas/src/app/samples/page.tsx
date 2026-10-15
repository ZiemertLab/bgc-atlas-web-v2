'use client';

import { apiFetch, withBase } from "@/lib/basePath";
import Link from 'next/link';
import Image from 'next/image';
import { useSearchParams, usePathname, useRouter } from 'next/navigation';
import { Suspense, useState, useEffect, Fragment, useMemo, useRef, useCallback } from 'react';
import { MainLayout } from '@/components/layout/main-layout';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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
import { GOLD_BUCKET_LABEL, GOLD_BUCKET_ORDER } from '@/lib/utils/gold-buckets';
import { formatDataSourceName } from '@/lib/utils/data-source-name';
import { ExportMenu } from '@/components/ui/export-menu';
import { downloadText, exportFilename, serializeExport, type ExportFormat } from '@/lib/export/format';
import { METAGENOME_EXPORT_COLUMNS } from '@/lib/export/sample-columns';
import { ASSEMBLY_VIEW_EXPORT_REFUSAL, SAMPLE_TEXT_FILTER_EXPORT_REFUSAL } from '@/lib/export/refusal-messages';
import { MetadataDetails } from '@/components/ui/metadata-details';
import { AssemblyDetails } from '@/components/ui/assembly-details';
import { SampleMapDots } from '@/components/ui/sample-map-dots';
import { SampleEnvironmentalPanel } from '@/components/ui/sample-environmental-panel';
import { SampleStudiesPanel } from '@/components/ui/sample-studies-panel';
import { BiomeLegend } from '@/components/ui/biome-legend';
import { FilterChips } from '@/components/ui/filter-chips';
import { AdvancedFilterDrawer } from '@/components/filters/advanced-filter-drawer';
import { SampleGcfCount, SAMPLE_GCF_HEADER_TOOLTIP } from '@/components/ui/sample-gcf-count';
import { SampleDataSourceLinks } from '@/components/ui/sample-data-source-links';
import { RefetchFrame } from '@/components/ui/refetch-frame';
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

export default function SamplesPage() {
  return (
    <Suspense fallback={null}>
      <SamplesPageInner />
    </Suspense>
  );
}

function SamplesPageInner() {
  const [currentPage, setCurrentPage] = useState(0);
  const [pageSize, setPageSize] = useState(50);
  const [searchTerm, setSearchTerm] = useState('');
  const [goldBucketFilter, setGoldBucketFilter] = useState('');
  // Exact key from ?studyKey=; the `study` column filter matches titles, and 710 titles are shared by several studies.
  const [studyKeyFilter, setStudyKeyFilter] = useState('');
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
  const [sortField, setSortField] = useState('bgcs');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [viewMode, setViewMode] = useState<'table' | 'map'>('table');
  const [entityMode, setEntityMode] = useState<'samples' | 'assemblies'>('samples');
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();

  const [showFilters, setShowFilters] = useState<Record<string, boolean>>({});
  const [filterId, setFilterId] = useState('');
  const [filterBiome, setFilterBiome] = useState('');
  const [filterGoldEcosystem, setFilterGoldEcosystem] = useState('');
  const [filterEnvText, setFilterEnvText] = useState('');
  const [filterMaterial, setFilterMaterial] = useState('');
  const [filterFeature, setFilterFeature] = useState('');
  const [filterHost, setFilterHost] = useState('');
  const [filterDataSource, setFilterDataSource] = useState('');
  const [filterStudy, setFilterStudy] = useState('');
  const [latMin, setLatMin] = useState<string>('');
  const [latMax, setLatMax] = useState<string>('');
  const [lonMin, setLonMin] = useState<string>('');
  const [lonMax, setLonMax] = useState<string>('');
  const [assembliesMin, setAssembliesMin] = useState<string>('');
  const [assembliesMax, setAssembliesMax] = useState<string>('');
  const [bgcsMin, setBgcsMin] = useState<string>('');
  const [bgcsMax, setBgcsMax] = useState<string>('');
  const [gcfsMin, setGcfsMin] = useState<string>('');
  const [gcfsMax, setGcfsMax] = useState<string>('');
  const [advancedFiltersOpen, setAdvancedFiltersOpen] = useState(false);
  const [advancedFilters, setAdvancedFilters] = useState<FilterGroup | null>(null);
  const [advancedFiltersDraft, setAdvancedFiltersDraft] = useState<FilterGroup>(() => createDefaultFilterGroup());
  const [unreadableAdvancedParam, setUnreadableAdvancedParam] = useState<string | null>(null);
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

  const advancedFiltersParam = searchParams.get('advancedFilters');
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
      // Forwarded verbatim so the server refuses it; dropping it made a truncated link return the whole corpus.
      setUnreadableAdvancedParam(unreadableAdvancedFilterParam(advancedFiltersParam));
    }
  }, [advancedFiltersParam]);

  // Seed bbox + GOLD bucket from the URL once on mount so later user edits aren't clobbered.
  const didSeedGeoRef = useRef(false);
  useEffect(() => {
    if (didSeedGeoRef.current) return;
    didSeedGeoRef.current = true;
    const qLatMin = searchParams.get('latMin');
    const qLatMax = searchParams.get('latMax');
    const qLonMin = searchParams.get('lonMin');
    const qLonMax = searchParams.get('lonMax');
    const qGold = searchParams.get('goldBucket');
    const qStudyKey = searchParams.get('studyKey');
    if (qLatMin) setLatMin(qLatMin);
    if (qLatMax) setLatMax(qLatMax);
    if (qLonMin) setLonMin(qLonMin);
    if (qLonMax) setLonMax(qLonMax);
    if (qGold) setGoldBucketFilter(qGold);
    if (qStudyKey) setStudyKeyFilter(qStudyKey);
    if (qLatMin || qLatMax || qLonMin || qLonMax) {
      setShowFilters((prev) => ({ ...prev, location: true }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  // Also drop it from the URL so a copied link or reload doesn't re-apply it.
  const clearStudyKey = () => {
    setStudyKeyFilter('');
    if (!pathname) return;
    const params = new URLSearchParams(searchParams.toString());
    params.delete('studyKey');
    const query = params.toString();
    router.replace(`${pathname}${query ? `?${query}` : ''}`, { scroll: false });
  };

  const applyAdvancedFilters = () => {
    const hasDraft = hasFilterRules(advancedFiltersDraft);
    const nextFilters = hasDraft ? advancedFiltersDraft : null;
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
    // One replace for both URL filters: clearAdvancedFilters' own replace would put ?studyKey= back.
    if (pathname) {
      const params = new URLSearchParams(searchParams.toString());
      params.delete('advancedFilters');
      params.delete('studyKey');
      const query = params.toString();
      router.replace(`${pathname}${query ? `?${query}` : ''}`, { scroll: false });
    }
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

  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const idParam = params.get('id');
      if (idParam) {
        setFilterId(idParam);
        setViewMode('table');
        setCurrentPage(0);
      }
      if (params.get('view') === 'assemblies') {
        setEntityMode('assemblies');
      }
    } catch {
      // ignore
    }
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
  const mapHasActiveFilters = Boolean(
    mapFilterParams.goldBucket || mapFilterParams.biome || mapFilterParams.goldEcosystem ||
    mapFilterParams.search || mapFilterParams.id || mapFilterParams.environmentText ||
    mapFilterParams.material || mapFilterParams.feature || mapFilterParams.host ||
    mapFilterParams.dataSource || mapFilterParams.study || mapFilterParams.studyKey ||
    mapFilterParams.latMin !== undefined || mapFilterParams.latMax !== undefined ||
    mapFilterParams.lonMin !== undefined || mapFilterParams.lonMax !== undefined ||
    mapFilterParams.assembliesMin !== undefined || mapFilterParams.assembliesMax !== undefined ||
    mapFilterParams.bgcsMin !== undefined || mapFilterParams.bgcsMax !== undefined ||
    mapFilterParams.advancedFilters
  );

  // Both hooks always run (rules of hooks); the inactive one is disabled so it sends no request.
  const samplesQuery = useSamples({ ...sampleQueryParams, enabled: entityMode === 'samples' });
  const assembliesQuery = useAssemblies({ ...sampleQueryParams, enabled: entityMode === 'assemblies' });
  const { data, isLoading, isFetching, error, hasLoaded: samplesLoaded } =
    entityMode === 'assemblies' ? assembliesQuery : samplesQuery;

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
    if (mode === 'assemblies' && (sortField === 'assemblies' || sortField === 'id')) {
      setSortField('bgcs');
      setSortOrder('desc');
    }
    try {
      const sp = new URLSearchParams(window.location.search);
      if (mode === 'assemblies') sp.set('view', 'assemblies');
      else sp.delete('view');
      router.replace(`${pathname}${sp.toString() ? `?${sp.toString()}` : ''}`);
    } catch { /* ignore */ }
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

  const samples = data?.data?.data || [];
  const total = data?.data?.total || 0;
  const totalPages = Math.ceil(total / pageSize);
  const statistics = statisticsData?.data || null;

  const hasAnyFilter = Boolean(searchTerm || goldBucketFilter || studyKeyFilter || hasAnyColumnFilter || hasAdvancedFiltersApplied);

  const emptyState = (
    <div className="py-12 text-center text-muted-foreground">
      <p className="text-lg">No metagenomes found</p>
      {(searchTerm || goldBucketFilter) ? (
        <div className="text-sm space-y-1">
          <p>No matches for your search criteria:</p>
          {searchTerm && <p className="font-mono bg-muted px-2 py-1 rounded inline-block">&quot;{searchTerm}&quot;</p>}
          {goldBucketFilter && <p className="font-mono bg-muted px-2 py-1 rounded inline-block">{GOLD_BUCKET_LABEL[goldBucketFilter as keyof typeof GOLD_BUCKET_LABEL] ?? goldBucketFilter}</p>}
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

  if (error) {
    return (
      <MainLayout>
        <div className="w-full py-8">
          <div className="border border-border bg-card py-12 text-center">
            <h3 className="mb-2 text-base font-semibold text-destructive">
              Error loading metagenomes
            </h3>
            {/* The server's own message: a refused filter names the field to fix. */}
            <p className="mx-auto max-w-prose text-sm text-muted-foreground">
              {error.message}
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => window.location.reload()}
              className="mt-4"
            >
              Retry
            </Button>
          </div>
        </div>
      </MainLayout>
    );
  }

  const fmt = (value?: number | null): string =>
    statsLoading ? '—' : (value ?? 0).toLocaleString();

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

        <section className="mb-8">
          <SampleCharts
            {...statsFilters}
            staticManifestUrl="/data/sample-charts.manifest.json"
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
                placeholder="Search by name, study, environment, location, host species…"
                className="h-8 pl-7 text-[13px]"
                value={searchTerm}
                onChange={(e) => handleSearch(e.target.value)}
                aria-label="Search metagenomes"
              />
            </div>

            <select
              value={goldBucketFilter}
              onChange={(e) => setGoldBucketFilter(e.target.value)}
              aria-label="Environment filter"
              className="h-8 rounded-sm border border-input bg-card px-2 text-[13px]"
            >
              <option value="">All environments</option>
              {GOLD_BUCKET_ORDER.map((bucket) => (
                <option key={bucket} value={bucket}>
                  {GOLD_BUCKET_LABEL[bucket]}
                </option>
              ))}
            </select>

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
          filters={[
            ...(searchTerm
              ? [{
                  key: 'search',
                  label: 'Search',
                  value: searchTerm,
                  onRemove: () => {
                    setSearchTerm('');
                    setCurrentPage(0);
                  }
                }]
              : []),
            ...(goldBucketFilter
              ? [{
                  key: 'environment',
                  label: 'Environment',
                  value: GOLD_BUCKET_LABEL[goldBucketFilter as keyof typeof GOLD_BUCKET_LABEL] ?? goldBucketFilter,
                  onRemove: () => {
                    setGoldBucketFilter('');
                    setCurrentPage(0);
                  }
                }]
              : []),
            ...(hasAdvancedFiltersApplied
              ? advancedFilterSummaries.map((summary, index) => ({
                  key: `advanced-${index}`,
                  label: 'Advanced',
                  value: summary,
                  onRemove: clearAdvancedFilters,
                }))
              : []),
          ]}
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

          {viewMode === 'table' && !tableLoading && total > 0 && (
            <div className="mb-4">
              <Pagination
                currentPage={currentPage}
                totalPages={totalPages}
                totalItems={total}
                pageSize={pageSize}
                offset={offset}
                onPageChange={handlePageChange}
                onPageSizeChange={handlePageSizeChange}
                pageSizeOptions={[5, 10, 25, 50, 100]}
              />
            </div>
          )}

          <div>
            {viewMode === 'map' ? (
              mapHasActiveFilters ? (
                <SampleMapDots
                  params={{
                    ...mapFilterParams,
                    enabled: viewMode === 'map',
                  }}
                />
              ) : (
                <SampleMapDots staticManifestUrl="/data/map-samples.manifest.json" />
              )
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

        {viewMode === 'table' && (
          <div className="mt-6">
            <Pagination
              currentPage={currentPage}
              totalPages={totalPages}
              totalItems={total}
              pageSize={pageSize}
              offset={offset}
              onPageChange={handlePageChange}
              onPageSizeChange={handlePageSizeChange}
              pageSizeOptions={[5, 10, 25, 50, 100]}
            />
          </div>
        )}
      </div>
    </MainLayout>
  );
}
