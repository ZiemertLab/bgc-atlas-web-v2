import type React from 'react';

export interface BgcListItem {
  id: string;
  assemblyDisplay: string | null;
  assembly: string;
  assemblySourceType: string;
  name: string;
  category: string | null;
  categories: string[];
  products: string[];
  completeness: 'complete' | 'partial' | 'unknown';
  length: number | null;
  genes: number | null;
  gcf: string | null;
  gcfName: string | null;
  // BiG-SLiCE distance to the GCF; lower = more similar
  distance: number | null;
  // KnownClusterBLAST hit against MIBiG; null below 50% similarity (~94% of regions).
  knownCluster?: {
    accession: string | null;
    compound: string | null;
    similarity: number;
  } | null;
  biome: string | null;
  biomeLevels: string[];
  biomeEnvironment: string[];
  antismashRunId: string | null;
  anchor: string | null;
  sampleIds: string[];
  sampleLabels: string[];
  dataSourceNames: string[];
  goldEcosystemPath: string | null;
  taxonomyDomain: string | null;
  taxonomyPhylum: string | null;
  taxonomyClass: string | null;
  taxonomyOrder: string | null;
  taxonomyFamily: string | null;
  taxonomyGenus: string | null;
  taxonomySpecies: string | null;
  gtdbLineage: string | null;
}

export type TaxonomyRank = 'auto' | 'domain' | 'phylum' | 'class' | 'order' | 'family' | 'genus' | 'species';

export interface BgcTablePreFilters {
  gcf?: string;
  assembly?: string;
  sampleId?: string;
}

export interface BgcTableConfig {
  showGlobalSearch?: boolean;        // Default: true
  showProductClassFilter?: boolean;  // Default: true
  showExportButtons?: boolean;       // Default: true
  showFilterChips?: boolean;         // Default: true
  showPagination?: boolean;          // Default: true
  enableUrlSync?: boolean;           // Default: false (true for BGCs page)
  enableTour?: boolean;              // Default: false
}

export interface BgcTableColumnConfig {
  defaultVisibility?: Record<string, boolean>;
  defaultOrder?: string[];
  defaultWidths?: Record<string, number>;
  disabledColumns?: string[];
}

export interface BgcTablePaginationConfig {
  defaultPageSize?: number;          // Default: 50
  pageSizeOptions?: number[];        // Default: [5, 10, 25, 50, 100]
}

export interface BgcTableTourConfig {
  enableTour?: boolean;
  tourPrefix?: string;  // e.g. "gcf-detail-"
}

export interface BgcTableProps {
  // Immutable, passed to the API
  preFilters?: BgcTablePreFilters;

  config?: BgcTableConfig;

  columnConfig?: BgcTableColumnConfig;

  paginationConfig?: BgcTablePaginationConfig;

  tourConfig?: BgcTableTourConfig;

  onBgcClick?: (bgc: BgcListItem) => void;  // Override default behavior
  onFilterChange?: (filters: BgcTableFilterState) => void;

  className?: string;
  containerClassName?: string;
}

export interface BgcTableFilterState {
  searchTerm: string;
  typeFilter: string;
  filterId: string;
  filterName: string;
  filterBiome: string;
  filterTypeText: string;
  filterCompleteness: string;
  filterAssembly: string;
  filterGcf: string;
  filterSampleText: string;
  filterSampleId: string;
  filterDataSource: string;
  filterTaxonomy: string;
  filterGoldEcosystem: string;
  lenMin: string;
  lenMax: string;
  genesMin: string;
  genesMax: string;
  simMin: string;
  simMax: string;
}

export interface BgcTableState {
  currentPage: number;
  pageSize: number;

  sortField: string;
  sortOrder: 'asc' | 'desc';

  filters: BgcTableFilterState;

  columnOrder: string[];
  columnVisibility: Record<string, boolean>;
  columnWidths: Record<string, number>;
  showFilters: Record<string, boolean>;

  openingBgcId: string | null;
  taxonomyRank: TaxonomyRank;
  mounted: boolean;
}

export interface BgcTableContextValue extends BgcTableState {
  setCurrentPage: (page: number) => void;
  setPageSize: (size: number) => void;
  setSortField: (field: string) => void;
  setSortOrder: (order: 'asc' | 'desc') => void;
  setFilters: (filters: Partial<BgcTableFilterState>) => void;
  setColumnOrder: React.Dispatch<React.SetStateAction<string[]>>;
  setColumnVisibility: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  setColumnWidths: React.Dispatch<React.SetStateAction<Record<string, number>>>;
  setShowFilters: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  setOpeningBgcId: (id: string | null) => void;
  setTaxonomyRank: (rank: TaxonomyRank) => void;

  resetFilters: () => void;
  handleBgcClick: (bgc: BgcListItem) => void;

  preFilters: BgcTablePreFilters;
  config: Required<BgcTableConfig>;
  columnConfig: BgcTableColumnConfig;
  paginationConfig: Required<BgcTablePaginationConfig>;
  tourConfig: BgcTableTourConfig;
}
