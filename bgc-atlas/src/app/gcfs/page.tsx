'use client';

import { Suspense, useState, useEffect, useMemo, useCallback } from 'react';
import Link from 'next/link';
import { useSearchParams, usePathname, useRouter } from 'next/navigation';
import { MainLayout } from '@/components/layout/main-layout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Search, Loader2, AlertCircle, Filter, ArrowUpRight } from 'lucide-react';
import { Pagination } from '@/components/ui/pagination';
import { ResizableTable } from '@/components/ui/resizable-table';
import { TableSkeleton } from '@/components/ui/loading-skeleton';
import { ColdLoadHint } from '@/components/ui/cold-load-hint';
import { CopyLinkButton } from '@/components/ui/copy-link-button';
import { EmptyState } from '@/components/ui/empty-state';
import { InfoTooltip } from '@/components/ui/info-tooltip';
import { FilterChips } from '@/components/ui/filter-chips';
import { GcfCard } from '@/components/ui/gcf-card';
import { GcfNamingDisclosure } from '@/components/ui/gcf-naming-disclosure';
import { RetiredFamilyHint } from '@/components/gcf/retired-family-hint';
import { FRAGMENTED_TOOLTIP, GCF_NAME_TOOLTIP, TIER_EXPLAINER } from '@/lib/gcf-naming';
import { ExportMenu } from '@/components/ui/export-menu';
import { downloadText, exportFilename, serializeExport, type ExportFormat } from '@/lib/export/format';
import { GCF_TABLE_EXPORT_COLUMNS } from '@/lib/export/gcf-columns';
import { formatBgcLength } from '@/lib/utils/bgc-length';
import { GcfCharts } from '@/components/charts/gcf-charts';
import { GcfTaxonomyComposition } from '@/components/charts/gcf-taxonomy-composition';
import { BiomeDistributionChart } from '@/components/ui/biome-distribution-chart';
import { EcosystemLegend } from '@/components/ui/ecosystem-legend';
import { ProductCategoryChart } from '@/components/ui/product-category-chart';
import { ProductCategoryLegend } from '@/components/ui/product-category-legend';
import { TaxonomyDistributionChart } from '@/components/ui/taxonomy-distribution-chart';
import type { TableColumn } from '@/components/ui/resizable-table';
import { gcfExportPath, useGcfs, type GcfListItem } from '@/lib/hooks/use-gcfs';
import { useGcfStatistics } from '@/lib/hooks/use-gcf-statistics';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { AdvancedFilterDrawer } from '@/components/filters/advanced-filter-drawer';
import { gcfFilterFields } from '@/lib/filters/field-definitions';
import { gcfFilterRecipes } from '@/lib/filters/recipes';
import { FAMILY_CLASSES, FAMILY_CLASS_LABELS, isFamilyClass, type FamilyClass } from '@/lib/gcf/family-class';
import {
  FilterGroup,
  createDefaultFilterGroup,
  deserializeFilterGroup,
  hasFilterRules,
  serializeFilterGroup,
  summarizeFilterGroup,
} from '@/lib/filters/types';
import type { TaxonomyRank } from '@/lib/types';
import {
  CATEGORY_SHARE_SORT_FIELD,
  CATEGORY_SHARE_THRESHOLDS,
  DEFAULT_CATEGORY_MIN_SHARE,
  PRODUCT_CATEGORY_VALUES,
  canonicalCategory,
} from '@/lib/gcf/category-share';
import { KnownClusterCell } from '@/components/ui/known-cluster-cell';
import { RefetchFrame } from '@/components/ui/refetch-frame';
import {
  advancedFilterRequestParam,
  unreadableAdvancedFilterParam,
} from '@/lib/filters/advanced-filter-param';

export default function GCFsPage() {
  return (
    <Suspense fallback={null}>
      <GCFsPageInner />
    </Suspense>
  );
}

function GCFsPageInner() {
  // Read first: every filter below seeds from the query string so shared links arrive filtered.
  const searchParams = useSearchParams();
  const paramOr = (key: string, fallback = '') => searchParams.get(key) ?? fallback;

  const [mounted, setMounted] = useState(false);
  const [currentPage, setCurrentPage] = useState(0);
  const [pageSize, setPageSize] = useState(50);
  // Seed debouncedSearch too, or the first request goes out unfiltered before the debounce catches up.
  const [search, setSearch] = useState(() => paramOr('search'));
  const [debouncedSearch, setDebouncedSearch] = useState(() => paramOr('search'));
  const [minBgcs, setMinBgcs] = useState<string>(() => paramOr('minBgcs'));
  const [maxBgcs, setMaxBgcs] = useState<string>(() => paramOr('maxBgcs'));
  const [productType, setProductType] = useState<string>(() => paramOr('productType'));
  // '' = no threshold. An old link with only ?productType= meant "any member", i.e. 0 for a real category;
  // free text naming no category keeps '' and the old text match.
  const [categoryMinShare, setCategoryMinShare] = useState<string>(() => {
    const fromUrl = paramOr('categoryMinShare');
    if (fromUrl) return fromUrl;
    return canonicalCategory(paramOr('productType')) ? '0' : '';
  });
  const selectedCategory = canonicalCategory(productType);
  // Unknown URL values are dropped rather than sent, where the API would answer 400.
  const [familyClass, setFamilyClass] = useState<FamilyClass | ''>(() => {
    const fromUrl = paramOr('familyClass').toLowerCase();
    return isFamilyClass(fromUrl) ? fromUrl : '';
  });
  const [sortField, setSortField] = useState<string>(() => paramOr('sortField', 'memberCount'));
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>(
    () => (paramOr('sortOrder') === 'asc' ? 'asc' : 'desc'),
  );
  const [ecosystemLevel, setEcosystemLevel] = useState<number>(1);
  const [taxonomyRank, setTaxonomyRank] = useState<TaxonomyRank>('phylum');
  const [columnVisibility, setColumnVisibility] = useState<Record<string, boolean>>({});
  const [advancedFiltersOpen, setAdvancedFiltersOpen] = useState(false);
  const [advancedFilters, setAdvancedFilters] = useState<FilterGroup | null>(null);
  const [unreadableAdvancedParam, setUnreadableAdvancedParam] = useState<string | null>(null);
  const [advancedFiltersDraft, setAdvancedFiltersDraft] = useState<FilterGroup>(() => createDefaultFilterGroup());
  const pathname = usePathname();
  const router = useRouter();
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
    () => (hasAdvancedFiltersApplied && advancedFilters ? summarizeFilterGroup(advancedFilters, gcfFilterFields) : []),
    [advancedFilters, hasAdvancedFiltersApplied]
  );

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search);
      setCurrentPage(0);
    }, 500);

    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    setMounted(true);
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
      // Forwarded verbatim so the server refuses it; dropping it would make a truncated link return the whole corpus.
      setUnreadableAdvancedParam(unreadableAdvancedFilterParam(advancedFiltersParam));
    }
  }, [advancedFiltersParam]);

  // Mirror filters into the URL (replace, not push, to spare history). Skip when it already matches, or the
  // changed searchParams re-run this effect in a loop. Starts from searchParams so advancedFilters survives.
  useEffect(() => {
    if (!mounted || !pathname) return;
    const params = new URLSearchParams(searchParams.toString());
    const sync = (key: string, value: string, omitWhen = '') => {
      if (value && value !== omitWhen) params.set(key, value);
      else params.delete(key);
    };
    sync('search', debouncedSearch);
    sync('minBgcs', minBgcs);
    sync('maxBgcs', maxBgcs);
    sync('productType', productType);
    sync('categoryMinShare', productType ? categoryMinShare : '');
    sync('familyClass', familyClass);
    sync('sortField', sortField, 'memberCount');
    sync('sortOrder', sortOrder, 'desc');

    const query = params.toString();
    if (query === searchParams.toString()) return;
    router.replace(`${pathname}${query ? `?${query}` : ''}`, { scroll: false });
  }, [
    mounted, pathname, router, searchParams,
    debouncedSearch, minBgcs, maxBgcs, productType, categoryMinShare, familyClass, sortField, sortOrder,
  ]);

  // The share sort needs a selected category; without one both backends fall back to name order.
  useEffect(() => {
    if (sortField === CATEGORY_SHARE_SORT_FIELD && !selectedCategory) {
      setSortField('memberCount');
      setSortOrder('desc');
    }
  }, [sortField, selectedCategory]);

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

  // Filters only, no paging/sort; the taxonomic composition panel aggregates over exactly this object.
  const narrowingParams = {
    search: debouncedSearch || undefined,
    minBgcs: minBgcs ? Number(minBgcs) : undefined,
    maxBgcs: maxBgcs ? Number(maxBgcs) : undefined,
    category: productType || undefined,
    categoryMinShare: productType && categoryMinShare !== '' ? Number(categoryMinShare) : undefined,
    familyClass: familyClass || undefined,
    advancedFilters: advancedFiltersRequestParam,
  };
  const hasNarrowingFilter = Object.entries(narrowingParams)
    .some(([, value]) => value !== undefined && value !== '');

  // Also what "All matching" exports (gcfExportPath).
  const listParams = {
    ...narrowingParams,
    sortField,
    sortOrder,
    // Only needed when sorting by GOLD Ecosystem; otherwise a level change switches the column client-side without a refetch.
    ...(sortField === 'biomeDistribution' ? { ecosystemLevel } : {}),
  };
  const { data, isLoading, isFetching, error, hasLoaded } = useGcfs({
    limit: pageSize,
    offset: currentPage * pageSize,
    ...listParams,
  });

  const { data: gcfStats, isLoading: statsLoading } = useGcfStatistics();

  const gcfs = data?.data?.data ?? [];
  const total = data?.data?.total ?? 0;
  const totalPages = Math.ceil(total / pageSize);

  const getTaxonomyDistributionForRank = useCallback((gcf: GcfListItem) => {
    const distributions: Partial<Record<TaxonomyRank, Record<string, number>>> = {
      ...(gcf.taxonomyDistributionByRank ?? {}),
    };

    if ((!distributions.domain || Object.keys(distributions.domain).length === 0) &&
      gcf.taxonomyDistribution &&
      Object.keys(gcf.taxonomyDistribution).length > 0) {
      distributions.domain = gcf.taxonomyDistribution;
    }

    const selected = distributions[taxonomyRank];
    if (!selected || Object.keys(selected).length === 0) {
      return null;
    }

    return { rank: taxonomyRank, distribution: selected };
  }, [taxonomyRank]);

  const handleSort = (columnId: string, direction: 'asc' | 'desc') => {
    // The category column sorts by the filtered category's share of members.
    setSortField(columnId === 'productCategories' ? CATEGORY_SHARE_SORT_FIELD : columnId);
    setSortOrder(direction);
  };

  const handlePageChange = (newPage: number) => {
    setCurrentPage(newPage);
  };

  const handlePageSizeChange = (newSize: number) => {
    setPageSize(newSize);
    setCurrentPage(0);
  };

  const handleColumnVisibilityChange = (columnId: string, visible: boolean) => {
    setColumnVisibility((prev) => ({ ...prev, [columnId]: visible }));
  };

  // Same serializer as the streamed export, so this page is a slice of the "All matching" file.
  const handleExport = (format: ExportFormat) => {
    if (!gcfs.length) return;
    downloadText(
      serializeExport(gcfs, GCF_TABLE_EXPORT_COLUMNS, format),
      exportFilename(`gcfs_page${currentPage + 1}`, gcfs.length, gcfs.length, format),
      format,
    );
  };

  const columns: TableColumn<GcfListItem>[] = useMemo(() => [
    {
      id: 'id',
      label: 'GCF ID',
      width: 140,
      sortable: true,
      visible: columnVisibility.id !== false,
      renderCell: (gcf: GcfListItem) => {
        return (
          <div className="flex items-center gap-2">
            <Link
              href={`/gcfs/${gcf.id}`}
              className="inline-flex items-center gap-0.5 font-mono text-xs text-foreground underline underline-offset-2 decoration-foreground/50 hover:decoration-foreground"
            >
              {gcf.id.slice(0, 8)}...
              <ArrowUpRight className="h-3 w-3" aria-hidden="true" />
            </Link>
          </div>
        );
      },
    },
    {
      id: 'name',
      label: 'Name',
      // Fits the longest v3 name, `GCF-F-415858`.
      width: 150,
      sortable: true,
      headerTooltip: GCF_NAME_TOOLTIP,
      visible: columnVisibility.name !== false,
      renderCell: (gcf: GcfListItem) => (
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="truncate">{gcf.name}</span>
        </div>
      ),
    },
    {
      id: 'familyClass',
      label: 'Family class',
      // 160, not 140: sorted, the arrow pushes the tooltip icon onto the
      // Alias resize grip.
      width: 160,
      sortable: true,
      headerTooltip: TIER_EXPLAINER,
      visible: columnVisibility.familyClass !== false,
      renderCell: (gcf: GcfListItem) => {
        if (!gcf.familyClass) {
          return <span className="text-xs text-muted-foreground">—</span>;
        }
        return (
          <span title={gcf.familyClass === 'fragmented' ? FRAGMENTED_TOOLTIP : undefined}>
            {FAMILY_CLASS_LABELS[gcf.familyClass]}
          </span>
        );
      },
    },
    {
      id: 'petName',
      label: 'Alias',
      // Own column: sharing the Name column truncated both. 180 fits the 23-char maximum.
      width: 180,
      sortable: true,
      visible: columnVisibility.petName !== false,
      renderCell: (gcf: GcfListItem) => {
        if (!gcf.petName) return <span className="text-xs text-muted-foreground">—</span>;
        return (
          // The sr-only prefix is the accessible name (aria-label on a generic span is dropped). `relative` keeps
          // it inside the scroll container, or it adds horizontal page scroll on phones.
          <span
            className="relative block truncate text-muted-foreground"
            title="Human-readable alias — for recall only, not an identifier"
          >
            <span className="sr-only">Alias: </span>
            {gcf.petName}
          </span>
        );
      },
    },
    {
      id: 'memberCount',
      label: 'Member BGCs',
      width: 160,
      sortable: true,
      defaultSortDirection: 'desc',
      visible: columnVisibility.memberCount !== false,
      renderCell: (gcf: GcfListItem) => (
        <Link
          href={`/bgcs?gcf=${gcf.id}`}
          className="font-medium text-foreground underline underline-offset-2 decoration-foreground/50 hover:decoration-foreground"
        >
          {gcf.memberBgcCount.toLocaleString()}
        </Link>
      ),
    },
    {
      id: 'assemblyCount',
      label: 'Assemblies',
      width: 130,
      sortable: true,
      defaultSortDirection: 'desc',
      visible: columnVisibility.assemblyCount !== false,
      renderCell: (gcf: GcfListItem) => (
        <span className="text-muted-foreground">{gcf.assemblyCount.toLocaleString()}</span>
      ),
    },
    {
      id: 'length',
      label: 'Length',
      headerTooltip:
        'Median length of the family’s complete member BGCs. ' +
          'Families with no complete member show the longest member observed, prefixed ≥.',
      width: 110,
      minWidth: 90,
      sortable: true,
      defaultSortDirection: 'desc',
      visible: columnVisibility.length !== false,
      renderCell: (gcf: GcfListItem) => {
        const len = formatBgcLength(gcf.lengthStats);
        if (!len) return <span className="text-muted-foreground text-xs">—</span>;

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
      id: 'productCategories',
      label: 'Category distribution',
      width: 260,
      // Orders by the selected category's share of members, so it needs a category.
      sortable: selectedCategory !== null,
      defaultSortDirection: 'desc',
      headerTooltip: selectedCategory
        ? `Share of member BGCs by exact category combination. Sorting orders by the share of members carrying ${selectedCategory}.`
        : 'Share of member BGCs by exact category combination. A hybrid NRPS-PKS member counts once, under NRPS+PKS.',
      visible: columnVisibility.productCategories !== false,
      renderCell: (gcf: GcfListItem) => {
        if (!gcf.productCategoryDistribution || Object.keys(gcf.productCategoryDistribution).length === 0) {
          return <span className="text-muted-foreground text-xs">None</span>;
        }

        return (
          <div className="w-full px-1">
            <ProductCategoryChart
              distribution={gcf.productCategoryDistribution}
              height={24}
              valueLabel="of members"
            />
          </div>
        );
      },
    },
    {
      id: 'productTypeDistribution',
      label: 'Product distribution',
      renderHeader: () => (
        <div className="flex items-center gap-1">
          <span>Product distribution</span>
          <InfoTooltip content="Share of product assignments across granular antiSMASH products (e.g. lassopeptide, lanthipeptide). A BGC with several products counts once for each, so this is not a share of members." />
        </div>
      ),
      width: 260,
      visible: columnVisibility.productTypeDistribution === true,
      renderCell: (gcf: GcfListItem) => {
        if (!gcf.productTypeDistribution || Object.keys(gcf.productTypeDistribution).length === 0) {
          return <span className="text-muted-foreground text-xs">None</span>;
        }

        return (
          <div className="w-full px-1">
            <ProductCategoryChart
              distribution={gcf.productTypeDistribution}
              height={24}
            />
          </div>
        );
      },
    },
    {
      id: 'biomeDistribution',
      label: 'GOLD Ecosystem',
      headerControl: () => (
        <Select
          value={ecosystemLevel.toString()}
          onValueChange={(value) => setEcosystemLevel(Number(value))}
        >
          <SelectTrigger className="h-6 w-16 text-xs px-2">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="1">L1</SelectItem>
            <SelectItem value="2">L2</SelectItem>
            <SelectItem value="3">L3</SelectItem>
            <SelectItem value="4">L4</SelectItem>
            <SelectItem value="5">L5</SelectItem>
          </SelectContent>
        </Select>
      ),
      headerTooltip: `Distribution of BGCs across GOLD ecosystem level ${ecosystemLevel} classifications`,
      width: 260,
      sortable: true,
      visible: columnVisibility.biomeDistribution !== false,
      renderCell: (gcf: GcfListItem) => {
        const distribution = gcf.biomeDistributionByLevel?.[ecosystemLevel] ?? {};
        if (Object.keys(distribution).length === 0) {
          return <span className="text-muted-foreground text-xs">No data</span>;
        }

        return (
          <div className="w-full px-1">
            <BiomeDistributionChart
              distribution={distribution}
              height={24}
            />
          </div>
        );
      },
    },
    {
      id: 'taxonomyDistribution',
      label: 'Taxonomy',
      renderHeader: () => (
        <div className="flex items-center gap-1">
          <span>Taxonomy</span>
          <Select
            value={taxonomyRank}
            onValueChange={(value) => setTaxonomyRank(value as TaxonomyRank)}
          >
            <SelectTrigger className="h-6 w-auto min-w-20 text-xs px-2">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="domain">Domain</SelectItem>
              <SelectItem value="phylum">Phylum</SelectItem>
              <SelectItem value="class">Class</SelectItem>
              <SelectItem value="order">Order</SelectItem>
              <SelectItem value="family">Family</SelectItem>
              <SelectItem value="genus">Genus</SelectItem>
              <SelectItem value="species">Species</SelectItem>
            </SelectContent>
          </Select>
          <InfoTooltip content="Distribution of member BGCs across the selected GTDB taxonomy rank." />
        </div>
      ),
      width: 260,
      sortable: false,
      visible: columnVisibility.taxonomyDistribution !== false,
      renderCell: (gcf: GcfListItem) => {
        const selection = getTaxonomyDistributionForRank(gcf);
        if (!selection) {
          return <span className="text-muted-foreground text-xs">No data</span>;
        }

        return (
          <div className="w-full px-1">
            <TaxonomyDistributionChart
              distribution={selection.distribution}
              height={24}
            />
          </div>
        );
      },
    },
    {
      id: 'mibigAnchor',
      label: 'MIBiG relative',
      // headerTooltip, not renderHeader: renderHeader replaces the sort button.
      headerTooltip:
        'A characterized MIBiG cluster that is a member of this family (BiG-SLiCE '
        + 'distance ≤ 0.4). Not antiSMASH similarity — that is per-BGC and shown on '
        + 'the BGC page.',
      width: 190,
      // Hidden by default: blank on almost every row, and the default set is at the width budget.
      visible: columnVisibility.mibigAnchor === true,
      renderCell: (gcf: GcfListItem) => {
        // undefined = the document predates the field: unknown, so blank rather than "none".
        if (gcf.mibigCompounds === undefined) return null;
        const compounds = gcf.mibigCompounds;
        if (compounds.length === 0) {
          return <span className="text-xs text-muted-foreground">—</span>;
        }
        return (
          // `truncate` needs a flex parent with min-w-0; compound names reach 124 characters.
          <div className="flex min-w-0 items-baseline gap-1" title={compounds.join(', ')}>
            <span className="truncate text-xs">{compounds[0]}</span>
            {compounds.length > 1 && (
              // shrink-0: the count is the only sign that more compounds exist.
              <span className="shrink-0 text-xs text-muted-foreground">
                +{(compounds.length - 1).toLocaleString()}
              </span>
            )}
          </div>
        );
      },
    },
    {
      id: 'knownCluster',
      label: 'KnownClusterBLAST',
      headerTooltip:
        'Dominant characterized MIBiG cluster among this family’s members, by antiSMASH '
        + 'KnownClusterBLAST, with the percentage of members carrying it. Shown only at '
        + '≥50% similarity AND ≥5% of members — a compound matched by a handful of '
        + 'members says nothing about the family. Distinct from MIBiG relative, which is '
        + 'co-membership rather than homology.',
      // The header needs 242px (label + sort control + tooltip + padding), measured at 1440px.
      width: 250,
      // Hidden by default: blank on most rows, and the default set is at the width budget.
      visible: columnVisibility.knownCluster === true,
      renderCell: (gcf: GcfListItem) =>
        gcf.knownCluster ? (
          <KnownClusterCell
            compound={gcf.knownCluster.compound}
            accession={gcf.knownCluster.accession}
            similarity={gcf.knownCluster.similarity}
            coverage={gcf.knownCluster.coverage}
          />
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        ),
    },
    {
      id: 'avgScore',
      label: 'Avg Distance',
      headerTooltip: 'Average BiG-SLiCE distance of member BGCs to this family (lower = more similar).',
      // Fits label + sort arrow + "?" icon; at 140 the icon covers the resize grip.
      width: 190,
      sortable: true,
      visible: columnVisibility.avgScore !== false,
      renderCell: (gcf: GcfListItem) => (
        <span className="font-mono text-xs">
          {gcf.avgDistance !== null ? gcf.avgDistance.toFixed(3) : 'N/A'}
        </span>
      ),
    },
  ], [columnVisibility, ecosystemLevel, taxonomyRank, getTaxonomyDistributionForRank, selectedCategory]);

  const clearFilters = () => {
    setSearch('');
    setDebouncedSearch('');
    setMinBgcs('');
    setMaxBgcs('');
    setProductType('');
    setCategoryMinShare('');
    setFamilyClass('');
    clearAdvancedFilters();
    setCurrentPage(0);
  };

  if (!mounted) {
    return (
      <MainLayout>
        <div className="w-full py-8">
          <div className="flex items-center justify-center h-64">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        </div>
      </MainLayout>
    );
  }

  // The overview bars count families with any member in the category, so the filter must be "any member" too.
  const handleProductCategorySelect = (category: string) => {
    if (!category) return;
    setProductType(category);
    setCategoryMinShare('0');
    setCurrentPage(0);
  };

  const handleCategoryChange = (value: string) => {
    if (value === 'all') {
      setProductType('');
      setCategoryMinShare('');
    } else {
      setProductType(value);
      // Keep a threshold the reader already chose; a first pick gets the default.
      if (categoryMinShare === '') setCategoryMinShare(String(DEFAULT_CATEGORY_MIN_SHARE));
    }
    setCurrentPage(0);
  };

  const shareLabel = (share: number): string =>
    share === 0 ? 'any member' : `≥${share}% of members`;

  const fmtInt = (value?: number | null): string =>
    statsLoading ? '—' : (value ?? 0).toLocaleString();
  const fmtFloat = (value?: number | null): string =>
    statsLoading ? '—' : value === undefined || value === null ? '—' : value.toFixed(1);

  return (
    <MainLayout>
      <div className="w-full py-6">
        <header className="relative mb-6 border-b border-border pb-4">
          <h1 className="atlas-rule mb-3 text-2xl font-semibold tracking-tight md:text-3xl">
            Gene cluster families
          </h1>
          <p className="mt-3 max-w-3xl text-[14px] leading-relaxed text-muted-foreground">
            BGCs grouped by similarity (BiG-SLiCE)
          </p>
          <GcfNamingDisclosure className="mt-2" />
        </header>

        <section className="mb-6 border-b border-border pb-4">
          {/* One column on phones: a nowrap .leader-row in a half-column overflows a 390px viewport. */}
          <dl className="grid grid-cols-1 gap-x-8 gap-y-2 text-sm sm:grid-cols-4">
            <div className="leader-row">
              <dt className="whitespace-nowrap text-muted-foreground">Total GCFs</dt>
              <span className="leader-dots" aria-hidden />
              <dd className="font-mono font-medium tabular-nums text-foreground">
                {fmtInt(gcfStats.data?.totalGcfs)}
              </dd>
            </div>
            <div className="leader-row">
              <dt className="whitespace-nowrap text-muted-foreground">Clustered BGCs</dt>
              <span className="leader-dots" aria-hidden />
              <dd className="font-mono font-medium tabular-nums text-foreground">
                {fmtInt(gcfStats.data?.totalMemberBgcs)}
              </dd>
            </div>
            <div className="leader-row">
              <dt className="whitespace-nowrap text-muted-foreground">Avg. BGCs / GCF</dt>
              <span className="leader-dots" aria-hidden />
              <dd className="font-mono font-medium tabular-nums text-foreground">
                {fmtFloat(gcfStats.data?.avgMemberBgcs)}
              </dd>
            </div>
            <div className="leader-row">
              <dt className="whitespace-nowrap text-muted-foreground">Avg. taxa / GCF</dt>
              <span className="leader-dots" aria-hidden />
              <dd className="font-mono font-medium tabular-nums text-foreground">
                {fmtFloat(gcfStats.data?.avgTaxaCount)}
              </dd>
            </div>
          </dl>
        </section>

        <section className="mb-8 space-y-8">
          {/* Same params as the panel below so the charts, heatmap and rows describe one set
              of families. GcfCharts spans both columns when it is the grid's only child. */}
          <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
            <GcfCharts
              onProductCategorySelect={handleProductCategorySelect}
              staticManifestUrl="/data/gcf-charts.manifest.json"
              params={narrowingParams}
              filtered={hasNarrowingFilter}
            />
            {/* Hides itself at the 0.7 resolution, which the browse index does not hold. */}
            <GcfTaxonomyComposition params={narrowingParams} filtered={hasNarrowingFilter} />
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
                placeholder="Search ID, name, alias, description, category"
                title="Matches a family's ID, name, alias or description, or a product category carried by at least half its members"
                className="h-8 pl-7 text-[13px]"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                aria-label="Search GCFs"
              />
            </div>

            <Input
              type="number"
              placeholder="Min BGCs"
              value={minBgcs}
              onChange={(e) => {
                setMinBgcs(e.target.value);
                setCurrentPage(0);
              }}
              className="h-8 w-[110px] text-[13px]"
              aria-label="Minimum BGCs per GCF"
            />
            <Input
              type="number"
              placeholder="Max BGCs"
              value={maxBgcs}
              onChange={(e) => {
                setMaxBgcs(e.target.value);
                setCurrentPage(0);
              }}
              className="h-8 w-[110px] text-[13px]"
              aria-label="Maximum BGCs per GCF"
            />
            {/* Free text from an old link that names no category shows as the chip only. */}
            <Select
              value={selectedCategory ?? 'all'}
              onValueChange={handleCategoryChange}
            >
              <SelectTrigger className="h-8 w-[150px] text-[13px]" aria-label="Category filter">
                <SelectValue placeholder="Category" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All categories</SelectItem>
                {PRODUCT_CATEGORY_VALUES.map((category) => (
                  <SelectItem key={category} value={category}>{category}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {selectedCategory && (
              <Select
                value={categoryMinShare === '' ? String(DEFAULT_CATEGORY_MIN_SHARE) : categoryMinShare}
                onValueChange={(value) => {
                  setCategoryMinShare(value);
                  setCurrentPage(0);
                }}
              >
                <SelectTrigger
                  className="h-8 w-[190px] text-[13px]"
                  aria-label={`Share of members carrying ${selectedCategory}`}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CATEGORY_SHARE_THRESHOLDS.map((share) => (
                    <SelectItem key={share} value={String(share)}>
                      in {shareLabel(share)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}

            {/* Seed families come from complete or median-length BGCs; fragmented ones from what seeds could not place. */}
            <Select
              value={familyClass || 'all'}
              onValueChange={(value) => {
                setFamilyClass(isFamilyClass(value) ? value : '');
                setCurrentPage(0);
              }}
            >
              <SelectTrigger
                className="h-8 w-[180px] text-[13px]"
                aria-label="Family class filter"
                title="Seed families were clustered from complete or median-length BGCs; fragmented families from what the seed could not place"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All families</SelectItem>
                {FAMILY_CLASSES.map((value) => (
                  <SelectItem key={value} value={value}>{FAMILY_CLASS_LABELS[value]} families</SelectItem>
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

            <Button variant="ghost" size="sm" onClick={clearFilters}>
              Clear
            </Button>

            <CopyLinkButton className="ml-auto" />

            <ExportMenu
              pageRows={gcfs.length}
              onPageExport={handleExport}
              total={total}
              exportPath={gcfExportPath(listParams)}
            />
          </div>
        </section>

        <AdvancedFilterDrawer
          open={advancedFiltersOpen}
          onOpenChange={setAdvancedFiltersOpen}
          fields={gcfFilterFields}
          recipes={gcfFilterRecipes}
          storageKey="gcf-advanced-filters"
          draft={advancedFiltersDraft}
          onDraftChange={setAdvancedFiltersDraft}
          onApply={applyAdvancedFilters}
          onClear={clearAdvancedFilters}
          hasDraft={hasDraftAdvancedFilters}
          hasApplied={hasAdvancedFiltersApplied}
          appliedCount={advancedFilterSummaries.length}
        />

        <RetiredFamilyHint query={debouncedSearch} />

        <FilterChips
          className="mb-4"
          filters={[
            ...(debouncedSearch ? [{
              key: 'search',
              label: 'Search',
              value: debouncedSearch,
              onRemove: () => {
                setSearch('');
                setDebouncedSearch('');
                setCurrentPage(0);
              }
            }] : []),
            ...(minBgcs ? [{
              key: 'minBgcs',
              label: 'Min BGCs',
              value: minBgcs,
              onRemove: () => {
                setMinBgcs('');
                setCurrentPage(0);
              }
            }] : []),
            ...(maxBgcs ? [{
              key: 'maxBgcs',
              label: 'Max BGCs',
              value: maxBgcs,
              onRemove: () => {
                setMaxBgcs('');
                setCurrentPage(0);
              }
            }] : []),
            ...(productType ? [{
              key: 'productType',
              label: 'Category',
              value: selectedCategory && categoryMinShare !== ''
                ? `${selectedCategory} in ${shareLabel(Number(categoryMinShare))}`
                : productType,
              onRemove: () => {
                setProductType('');
                setCategoryMinShare('');
                setCurrentPage(0);
              }
            }] : []),
            ...(familyClass ? [{
              key: 'familyClass',
              label: 'Family class',
              value: FAMILY_CLASS_LABELS[familyClass],
              onRemove: () => {
                setFamilyClass('');
                setCurrentPage(0);
              }
            }] : []),
            ...(hasAdvancedFiltersApplied
              ? advancedFilterSummaries.map((summary, index) => ({
                  key: `advanced-${index}`,
                  label: 'Advanced',
                  value: summary,
                  onRemove: clearAdvancedFilters,
                }))
              : []),
          ]}
          onClearAll={clearFilters}
        />

        <section className="w-[min(100vw,2400px)] ml-[calc(50%_-_min(50vw,1200px))] mr-[calc(50%_-_min(50vw,1200px))] px-4 lg:px-8 xl:px-12 2xl:px-16">
          <div className="mb-3 flex flex-wrap items-end justify-between gap-4 border-b border-border pb-2">
            <div>
              <h2 className="mt-0.5 text-sm font-medium">
                Gene cluster families
                {!isLoading && total > 0 && (
                  <span className="ml-2 font-mono text-xs font-normal tabular-nums text-muted-foreground">
                    {gcfs.length.toLocaleString()} of {total.toLocaleString()}
                  </span>
                )}
              </h2>
            </div>
          </div>

          <div className="mb-4 space-y-3 border-b border-border pb-4">
            <EcosystemLegend level={ecosystemLevel} />
            <ProductCategoryLegend showCombinations />
          </div>

          {!error && !(isLoading && !hasLoaded) && total > 0 && (
            <div className="mb-4">
              <Pagination
                currentPage={currentPage}
                totalPages={totalPages}
                totalItems={total}
                pageSize={pageSize}
                offset={currentPage * pageSize}
                onPageChange={handlePageChange}
                onPageSizeChange={handlePageSizeChange}
                pageSizeOptions={[25, 50, 100, 200]}
              />
            </div>
          )}

          {error ? (
            <div className="py-12 text-center">
              <AlertCircle className="mx-auto mb-4 size-8 text-destructive" />
              <h3 className="mb-1 text-base font-semibold">Failed to load GCFs</h3>
              <p className="mb-4 text-sm text-muted-foreground">{error.message}</p>
              <Button variant="outline" size="sm" onClick={() => window.location.reload()}>
                Retry
              </Button>
            </div>
          ) : isLoading && !hasLoaded ? (
            <div className="space-y-6">
              <ColdLoadHint loading label="Loading GCFs" />
              <TableSkeleton rows={Math.min(pageSize, 10)} columns={8} />
            </div>
          ) : gcfs.length === 0 ? (
            <EmptyState
              title="No GCFs found"
              description={
                debouncedSearch || minBgcs || maxBgcs || productType || familyClass
                  ? `No GCFs match your search criteria. Try adjusting your filters or search terms.`
                  : `No gene cluster families are available yet.`
              }
              action={{
                label: 'Clear filters',
                onClick: clearFilters,
              }}
            />
          ) : (
            <RefetchFrame refetching={isFetching} label="Updating GCFs">
              <div className="space-y-3 lg:hidden">
                {gcfs.map((gcf) => (
                  <GcfCard key={gcf.id} gcf={gcf} />
                ))}
              </div>
              <div className="hidden lg:block">
                <ResizableTable
                  columns={columns}
                  data={gcfs}
                  onSort={handleSort}
                  sortColumn={sortField === CATEGORY_SHARE_SORT_FIELD ? 'productCategories' : sortField}
                  sortDirection={sortOrder}
                  onColumnVisibilityChange={handleColumnVisibilityChange}
                  className="min-w-full"
                  emptyState={
                    <div className="py-12 text-center text-sm text-muted-foreground">
                      No GCFs found
                    </div>
                  }
                />
              </div>
            </RefetchFrame>
          )}
        </section>

        {total > 0 && (
          <div className="mt-6">
            <Pagination
              currentPage={currentPage}
              totalPages={totalPages}
              totalItems={total}
              pageSize={pageSize}
              offset={currentPage * pageSize}
              onPageChange={handlePageChange}
              onPageSizeChange={handlePageSizeChange}
              pageSizeOptions={[25, 50, 100, 200]}
            />
          </div>
        )}
      </div>

    </MainLayout>
  );
}
