'use client';

import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import type {
  BgcTableContextValue,
  BgcTableFilterState,
  BgcListItem,
  TaxonomyRank,
  BgcTablePreFilters,
  BgcTableConfig,
  BgcTableColumnConfig,
  BgcTablePaginationConfig,
  BgcTableTourConfig,
} from './bgc-table-types';
import { antismashViewerHref } from './bgc-table-utils';

const BgcTableContext = createContext<BgcTableContextValue | undefined>(undefined);

const defaultConfig: Required<BgcTableConfig> = {
  showGlobalSearch: true,
  showProductClassFilter: true,
  showExportButtons: true,
  showFilterChips: true,
  showPagination: true,
  enableUrlSync: false,
  enableTour: false,
};

const defaultPaginationConfig: Required<BgcTablePaginationConfig> = {
  defaultPageSize: 50,
  pageSizeOptions: [5, 10, 25, 50, 100],
};

const defaultColumnVisibility: Record<string, boolean> = {
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
};

const defaultColumnOrder = ['id', 'assembly', 'source', 'samples', 'class', 'type', 'completeness', 'goldEcosystem', 'taxonomy', 'length', 'genes', 'gcf', 'distance'];

const defaultColumnWidths: Record<string, number> = {
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
};

interface BgcTableProviderProps {
  children: React.ReactNode;
  preFilters?: BgcTablePreFilters;
  config?: BgcTableConfig;
  columnConfig?: BgcTableColumnConfig;
  paginationConfig?: BgcTablePaginationConfig;
  tourConfig?: BgcTableTourConfig;
  onBgcClick?: (bgc: BgcListItem) => void;
}

export function BgcTableProvider({
  children,
  preFilters = {},
  config = {},
  columnConfig = {},
  paginationConfig = {},
  tourConfig = {},
  onBgcClick,
}: BgcTableProviderProps) {
  const mergedConfig: Required<BgcTableConfig> = { ...defaultConfig, ...config };
  const mergedPaginationConfig: Required<BgcTablePaginationConfig> = { ...defaultPaginationConfig, ...paginationConfig };

  const searchParams = useSearchParams();

  const [currentPage, setCurrentPage] = useState(0);
  const [pageSize, setPageSize] = useState(mergedPaginationConfig.defaultPageSize);

  // '' = the API default order (length DESC, completeness DESC).
  const [sortField, setSortField] = useState<string>('');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');

  const [filters, setFiltersState] = useState<BgcTableFilterState>({
    searchTerm: '',
    typeFilter: '',
    filterId: '',
    filterName: '',
    filterBiome: '',
    filterTypeText: '',
    filterCompleteness: '',
    filterAssembly: '',
    filterGcf: '',
    filterSampleText: '',
    filterSampleId: '',
    filterDataSource: '',
    filterTaxonomy: '',
    filterGoldEcosystem: '',
    lenMin: '',
    lenMax: '',
    genesMin: '',
    genesMax: '',
    simMin: '',
    simMax: '',
  });

  const [columnOrder, setColumnOrder] = useState<string[]>(
    columnConfig.defaultOrder || defaultColumnOrder
  );
  const [columnVisibility, setColumnVisibility] = useState<Record<string, boolean>>(
    columnConfig.defaultVisibility || defaultColumnVisibility
  );
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>(
    columnConfig.defaultWidths || defaultColumnWidths
  );
  const [showFilters, setShowFilters] = useState<Record<string, boolean>>({});

  const [openingBgcId, setOpeningBgcId] = useState<string | null>(null);
  const [taxonomyRank, setTaxonomyRank] = useState<TaxonomyRank>('auto');
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);

    if (!mergedConfig.enableUrlSync) return;

    const assemblyFromUrl = searchParams.get('assembly');
    const sampleIdFromUrl = searchParams.get('sampleId');
    const gcfFromUrl = searchParams.get('gcf');

    if (assemblyFromUrl || sampleIdFromUrl || gcfFromUrl) {
      setFiltersState(prev => ({
        ...prev,
        ...(assemblyFromUrl && { filterAssembly: assemblyFromUrl }),
        ...(sampleIdFromUrl && { filterSampleId: sampleIdFromUrl }),
        ...(gcfFromUrl && { filterGcf: gcfFromUrl }),
      }));
      setCurrentPage(0);
    }
  }, [mergedConfig.enableUrlSync, searchParams]);

  const setFilters = useCallback((partialFilters: Partial<BgcTableFilterState>) => {
    setFiltersState(prev => ({ ...prev, ...partialFilters }));
  }, []);

  const resetFilters = useCallback(() => {
    setFiltersState({
      searchTerm: '',
      typeFilter: '',
      filterId: '',
      filterName: '',
      filterBiome: '',
      filterTypeText: '',
      filterCompleteness: '',
      filterAssembly: '',
      filterGcf: '',
      filterSampleText: '',
      filterSampleId: '',
      filterDataSource: '',
      filterTaxonomy: '',
      filterGoldEcosystem: '',
      lenMin: '',
      lenMax: '',
      genesMin: '',
      genesMax: '',
      simMin: '',
      simMax: '',
    });
    setShowFilters({});
    setCurrentPage(0);
  }, []);

  const handleBgcClick = useCallback((bgc: BgcListItem) => {
    if (onBgcClick) {
      onBgcClick(bgc);
      return;
    }

    if (!bgc?.antismashRunId) {
      return;
    }

    // no extraction wait here: the viewer page reports extraction status itself
    const href = antismashViewerHref(bgc);
    if (href) {
      window.open(href, '_blank', 'noopener,noreferrer');
    }
  }, [onBgcClick]);

  const value: BgcTableContextValue = {
    currentPage,
    pageSize,
    sortField,
    sortOrder,
    filters,
    columnOrder,
    columnVisibility,
    columnWidths,
    showFilters,
    openingBgcId,
    taxonomyRank,
    mounted,

    setCurrentPage,
    setPageSize,
    setSortField,
    setSortOrder,
    setFilters,
    setColumnOrder,
    setColumnVisibility,
    setColumnWidths,
    setShowFilters,
    setOpeningBgcId,
    setTaxonomyRank,

    resetFilters,
    handleBgcClick,

    preFilters,
    config: mergedConfig,
    columnConfig,
    paginationConfig: mergedPaginationConfig,
    tourConfig,
  };

  return (
    <BgcTableContext.Provider value={value}>
      {children}
    </BgcTableContext.Provider>
  );
}

export function useBgcTable() {
  const context = useContext(BgcTableContext);
  if (!context) {
    throw new Error('useBgcTable must be used within a BgcTableProvider');
  }
  return context;
}
