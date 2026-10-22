'use client';

import { Suspense, useState, useEffect, useMemo, useCallback, useRef } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { readNumber, readOneOf, readPage, readPageSize } from '@/lib/url-state';
import { formatRangeLabel } from '@/lib/filter-chip-labels';
import { useExternalNavigationKey, useMirrorToUrl } from '@/lib/hooks/use-mirror-to-url';
import { MainLayout } from '@/components/layout/main-layout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Search, Loader2, Filter, ArrowUpRight } from 'lucide-react';
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
import { ListErrorState } from '@/components/ui/list-error-state';
import { isDeepPageRefusal } from '@/lib/api-client';
import { useLastKnown } from '@/lib/hooks/use-last-known';
import { downloadText, exportFilename, serializeExport, type ExportFormat } from '@/lib/export/format';
import { gcfTableExportColumns } from '@/lib/export/gcf-columns';
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
import { CombinedShareMatchCell, ShareMatchCell } from '@/components/gcf/share-match-cell';
import {
  ecosystemColumnTooltip,
  ecosystemResolvedNote,
  ecosystemValueLabel,
  shareConditionLabel,
  shareConditionTooltip,
  shareConditionsOf,
} from '@/lib/gcf/share-display';
import { RefetchFrame } from '@/components/ui/refetch-frame';
import {
  advancedFilterRequestParam,
  unreadableAdvancedFilterParam,
} from '@/lib/filters/advanced-filter-param';

const PAGE_SIZE_OPTIONS = [25, 50, 100, 200];
const DEFAULT_PAGE_SIZE = 50;

/**
 * Share conditions that get a column each; past this, one combined column. The
 * default set already overflows a 1440px screen, so each auto-shown column is
 * paid for in scrolling.
 */
const MAX_SHARE_MATCH_COLUMNS = 2;
const COMBINED_SHARE_MATCH_COLUMN = 'shareMatches';

/**
 * The sorts a link may carry: the table's sortable column ids, plus the share
 * sort the category column sends. Anything else reads as the default, so a junk
 * value never paints a sort arrow over rows the server ordered by name.
 */
const SORT_FIELDS = [
  'id',
  'name',
  'familyClass',
  'petName',
  'memberCount',
  'assemblyCount',
  'length',
  'biomeDistribution',
  'avgScore',
  CATEGORY_SHARE_SORT_FIELD,
] as const;

export default function GCFsPage() {
  return (
    <Suspense fallback={null}>
      <GCFsPageKeyed />
    </Suspense>
  );
}

/** Remounts the page on a same-route navigation it did not write, so it re-seeds
 *  from the URL like a fresh visit (see useMirrorToUrl). */
function GCFsPageKeyed() {
  const navKey = useExternalNavigationKey();
  return <GCFsPageInner key={navKey} />;
}

function GCFsPageInner() {
  // Read first: every filter below seeds from the query string so shared links arrive filtered.
  const searchParams = useSearchParams();
  const paramOr = (key: string, fallback = '') => searchParams.get(key) ?? fallback;

  const [mounted, setMounted] = useState(false);
  const [currentPage, setCurrentPage] = useState(() => readPage(searchParams.get('page')));
  const [pageSize, setPageSize] = useState(() =>
    readPageSize(searchParams.get('size'), PAGE_SIZE_OPTIONS, DEFAULT_PAGE_SIZE),
  );
  // Seed debouncedSearch too, or the first request goes out unfiltered before the debounce catches up.
  const [search, setSearch] = useState(() => paramOr('search'));
  const [debouncedSearch, setDebouncedSearch] = useState(() => paramOr('search'));
  // Both backends ignore a bound that is not a number, so dropping one here
  // narrows nothing the server would have; it only keeps a chip from showing it.
  const [minBgcs, setMinBgcs] = useState<string>(() => readNumber(paramOr('minBgcs')));
  const [maxBgcs, setMaxBgcs] = useState<string>(() => readNumber(paramOr('maxBgcs')));
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
  const [sortField, setSortField] = useState<string>(
    () => readOneOf(paramOr('sortField'), SORT_FIELDS, 'memberCount'),
  );
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>(
    () => (paramOr('sortOrder') === 'asc' ? 'asc' : 'desc'),
  );
  const [ecosystemLevel, setEcosystemLevel] = useState<number>(1);
  const [taxonomyRank, setTaxonomyRank] = useState<TaxonomyRank>('phylum');
  const [columnVisibility, setColumnVisibility] = useState<Record<string, boolean>>({});
  const [advancedFiltersOpen, setAdvancedFiltersOpen] = useState(false);
  // Seeded in initializers, as on /studies: the URL mirror below owns this
  // param too, and its first write must already see the parsed value. An
  // unreadable value is kept, and forwarded verbatim, so the SERVER refuses it;
  // dropping it is what made a truncated link answer the whole corpus at 200.
  const [advancedFilters, setAdvancedFilters] = useState<FilterGroup | null>(() =>
    deserializeFilterGroup(searchParams.get('advancedFilters')),
  );
  const [unreadableAdvancedParam, setUnreadableAdvancedParam] = useState<string | null>(() =>
    unreadableAdvancedFilterParam(searchParams.get('advancedFilters')),
  );
  const [advancedFiltersDraft, setAdvancedFiltersDraft] = useState<FilterGroup>(
    () => deserializeFilterGroup(searchParams.get('advancedFilters')) ?? createDefaultFilterGroup(),
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
  // "Why this row matched": one column per applied share condition (Product,
  // Ecosystem share). Derived from the APPLIED filters, so removing a condition
  // removes its column; a reader's Columns choice for it is kept in
  // columnVisibility under a column id stable for that condition.
  const shareConditions = useMemo(
    () => shareConditionsOf(hasAdvancedFiltersApplied ? advancedFilters : null),
    [advancedFilters, hasAdvancedFiltersApplied],
  );
  const advancedFilterSummaries = useMemo(
    () => (hasAdvancedFiltersApplied && advancedFilters ? summarizeFilterGroup(advancedFilters, gcfFilterFields) : []),
    [advancedFilters, hasAdvancedFiltersApplied]
  );

  // Debounce search input. The page resets only when the search actually
  // changed: this also runs on mount, and resetting then would throw away a
  // ?page= the link arrived with. Anything that sets debouncedSearch directly
  // goes through clearSearchNow, which keeps this ref in step.
  const lastDebouncedSearch = useRef(search);
  const clearSearchNow = () => {
    setSearch('');
    setDebouncedSearch('');
    lastDebouncedSearch.current = '';
    setCurrentPage(0);
  };
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search);
      if (search !== lastDebouncedSearch.current) {
        lastDebouncedSearch.current = search;
        setCurrentPage(0);
      }
    }, 500);

    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Mirror filters, sort and paging back into the URL (see useMirrorToUrl for
  // replace-not-push, omitted defaults and the one-writer contract).
  // advancedFilters goes through the same write: a separate replace() in the
  // apply handler raced this one and put the old value back. The forwarded value,
  // not the encoded state, so an unreadable link keeps its evidence in the URL.
  useMirrorToUrl(
    [
      ['search', debouncedSearch],
      ['minBgcs', minBgcs],
      ['maxBgcs', maxBgcs],
      ['productType', productType],
      ['categoryMinShare', productType ? categoryMinShare : ''],
      ['familyClass', familyClass],
      ['sortField', sortField, 'memberCount'],
      ['sortOrder', sortOrder, 'desc'],
      ['page', currentPage + 1, 1],
      ['size', pageSize, DEFAULT_PAGE_SIZE],
      ['advancedFilters', advancedFiltersRequestParam ?? ''],
    ],
    mounted,
  );

  // The share sort needs a selected category; without one both backends fall back to name order.
  useEffect(() => {
    if (sortField === CATEGORY_SHARE_SORT_FIELD && !selectedCategory) {
      setSortField('memberCount');
      setSortOrder('desc');
    }
  }, [sortField, selectedCategory]);

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
  const { data, isLoading, isFetching, error, hasLoaded, refetch } = useGcfs({
    limit: pageSize,
    offset: currentPage * pageSize,
    ...listParams,
  });

  const { data: gcfStats, isLoading: statsLoading } = useGcfStatistics();

  const gcfs = data?.data?.data ?? [];
  const total = data?.data?.total ?? 0;

  // Under a deep-page refusal the pager stays, at the last total the list
  // reported, so the reader can step back; any other error hides it, where
  // "Showing 1–0 of 0" would read as an empty result.
  const pagerShown = !error || isDeepPageRefusal(error);
  // Keyed on the filters alone, as on /bgcs: a sort change keeps the same total.
  const pagerItems = useLastKnown(total, !error, JSON.stringify(narrowingParams));
  const pagerPages = Math.ceil(pagerItems / pageSize);

  const getTaxonomyDistributionForRank = useCallback((gcf: GcfListItem) => {
    const distributions: Partial<Record<TaxonomyRank, Record<string, number>>> = {
      ...(gcf.taxonomyDistributionByRank ?? {}),
    };
    // The trimmed per-rank maps come with their untrimmed taxon counts; the
    // domain fallback below is a full map, so it needs no count.
    let taxaCount = gcf.taxonomyTaxaCountByRank?.[taxonomyRank];

    if ((!distributions.domain || Object.keys(distributions.domain).length === 0) &&
      gcf.taxonomyDistribution &&
      Object.keys(gcf.taxonomyDistribution).length > 0) {
      distributions.domain = gcf.taxonomyDistribution;
      if (taxonomyRank === 'domain') taxaCount = undefined;
    }

    const selected = distributions[taxonomyRank];
    if (!selected || Object.keys(selected).length === 0) {
      return null;
    }

    return { rank: taxonomyRank, distribution: selected, taxaCount };
  }, [taxonomyRank]);

  const handleSort = (columnId: string, direction: 'asc' | 'desc') => {
    // The category column sorts by the filtered category's share of members.
    setSortField(columnId === 'productCategories' ? CATEGORY_SHARE_SORT_FIELD : columnId);
    setSortOrder(direction);
    // Page 7 of a reordered list is not the page the reader was on.
    setCurrentPage(0);
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
      serializeExport(gcfs, gcfTableExportColumns(hasAdvancedFiltersApplied ? advancedFilters : null), format),
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
    // Beside the member count, which is what each share is a share of.
    ...(shareConditions.length > MAX_SHARE_MATCH_COLUMNS
      ? [{
          id: COMBINED_SHARE_MATCH_COLUMN,
          label: 'Matched filters',
          headerTooltip:
            'Why each row matched the share filters. Product shares are of the family’s members; '
            + 'ecosystem shares are of the members with an ecosystem at that level. Hover a cell for each in full.',
          width: 300,
          visible: columnVisibility[COMBINED_SHARE_MATCH_COLUMN] !== false,
          renderCell: (gcf: GcfListItem) => (
            <CombinedShareMatchCell gcf={gcf} queries={shareConditions.map((c) => c.query)} />
          ),
        }]
      : shareConditions.map(({ columnId, query }) => ({
          id: columnId,
          label: shareConditionLabel(query),
          headerTooltip: shareConditionTooltip(query),
          // Narrow: the figure leads and is what the eye needs;
          // the cell truncates and its title carries the full sentence.
          width: 180,
          visible: columnVisibility[columnId] !== false,
          renderCell: (gcf: GcfListItem) => <ShareMatchCell gcf={gcf} query={query} />,
        }))),
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
          onValueChange={(value) => {
            setEcosystemLevel(Number(value));
            // Sorted by this column, the level decides the row order, so the
            // page the reader was on no longer exists.
            if (sortField === 'biomeDistribution') setCurrentPage(0);
          }}
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
      headerTooltip: ecosystemColumnTooltip(ecosystemLevel),
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
              valueLabel={ecosystemValueLabel(ecosystemLevel)}
              footnote={ecosystemResolvedNote(ecosystemLevel, gcf.ecosystemResolvedPctByLevel?.[ecosystemLevel])}
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
              taxaCount={selection.taxaCount}
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
  ], [columnVisibility, ecosystemLevel, taxonomyRank, getTaxonomyDistributionForRank, selectedCategory, sortField, shareConditions]);

  const clearFilters = () => {
    clearSearchNow();
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
              onRemove: clearSearchNow
            }] : []),
            ...(minBgcs || maxBgcs ? [{
              key: 'bgcs',
              label: 'BGCs',
              value: formatRangeLabel(minBgcs, maxBgcs),
              onRemove: () => {
                setMinBgcs('');
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

          {pagerShown && !(isLoading && !hasLoaded) && pagerItems > 0 && (
            <div className="mb-4">
              <Pagination
                currentPage={currentPage}
                totalPages={pagerPages}
                totalItems={pagerItems}
                pageSize={pageSize}
                offset={currentPage * pageSize}
                onPageChange={handlePageChange}
                onPageSizeChange={handlePageSizeChange}
                pageSizeOptions={PAGE_SIZE_OPTIONS}
              />
            </div>
          )}

          {error ? (
            <ListErrorState
              error={error}
              noun="GCFs"
              onRetry={refetch}
              retrying={isFetching}
              onFirstPage={() => setCurrentPage(0)}
            />
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
                  <GcfCard key={gcf.id} gcf={gcf} shareQueries={shareConditions.map((c) => c.query)} />
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

        {pagerShown && pagerItems > 0 && (
          <div className="mt-6">
            <Pagination
              currentPage={currentPage}
              totalPages={pagerPages}
              totalItems={pagerItems}
              pageSize={pageSize}
              offset={currentPage * pageSize}
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
