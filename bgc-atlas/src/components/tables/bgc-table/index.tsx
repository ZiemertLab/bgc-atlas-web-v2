'use client';

import { useEffect } from 'react';
import { bgcExportPath, useBgcs } from '@/lib/hooks/use-bgcs';
import { FilterChips } from '@/components/ui/filter-chips';
import { BgcTableProvider, useBgcTable } from './bgc-table-context';
import { BgcTableFilters } from './bgc-table-filters';
import { BgcTableContent } from './bgc-table-content';
import { useBgcTableColumns } from './bgc-table-columns';
import { BgcTablePagination } from './bgc-table-pagination';
import { useDebouncedValue } from './bgc-table-utils';
import type { BgcTableProps } from './bgc-table-types';

function BgcTableInner() {
  const context = useBgcTable();
  const {
    currentPage,
    pageSize,
    sortField,
    sortOrder,
    filters,
    preFilters,
    setCurrentPage,
    setFilters,
    config,
    mounted,
  } = context;

  const offset = currentPage * pageSize;

  const dSearch = useDebouncedValue(filters.searchTerm);
  const dFilterId = useDebouncedValue(filters.filterId);
  const dFilterName = useDebouncedValue(filters.filterName);
  const dFilterBiome = useDebouncedValue(filters.filterBiome);
  const dFilterTypeText = useDebouncedValue(filters.filterTypeText);
  const dFilterGcf = useDebouncedValue(filters.filterGcf);
  const dFilterAssembly = useDebouncedValue(filters.filterAssembly);
  const dFilterSampleText = useDebouncedValue(filters.filterSampleText);
  const dFilterDataSource = useDebouncedValue(filters.filterDataSource);
  const dFilterTaxonomy = useDebouncedValue(filters.filterTaxonomy);
  const dFilterGoldEcosystem = useDebouncedValue(filters.filterGoldEcosystem);
  const dLenMin = useDebouncedValue(filters.lenMin);
  const dLenMax = useDebouncedValue(filters.lenMax);
  const dGenesMin = useDebouncedValue(filters.genesMin);
  const dGenesMax = useDebouncedValue(filters.genesMax);
  const dSimMin = useDebouncedValue(filters.simMin);
  const dSimMax = useDebouncedValue(filters.simMax);

  const apiParams = {
    limit: pageSize,
    offset,
    // Without sortField the API uses its default multi-field sort.
    ...(sortField && { sortField }),
    ...(sortField && { sortOrder }),
    ...(preFilters.gcf && { gcf: preFilters.gcf }),
    ...(preFilters.assembly && { assembly: preFilters.assembly }),
    ...(preFilters.sampleId && { sampleId: preFilters.sampleId }),
    ...(dSearch && { search: dSearch }),
    ...(filters.typeFilter && { category: filters.typeFilter }),
    ...(dFilterId && { id: dFilterId }),
    ...(dFilterName && { name: dFilterName }),
    ...(dFilterBiome && { biome: dFilterBiome }),
    ...(dFilterTypeText && { product: dFilterTypeText }),
    ...(filters.filterCompleteness && { completeness: filters.filterCompleteness }),
    ...(dFilterAssembly && { assembly: dFilterAssembly }),
    ...(dFilterSampleText && { sample: dFilterSampleText }),
    ...(dFilterDataSource && { dataSource: dFilterDataSource }),
    ...(filters.filterSampleId && { sampleId: filters.filterSampleId }),
    ...(dFilterGcf && { gcf: dFilterGcf }),
    ...(dFilterTaxonomy && { taxonomy: dFilterTaxonomy }),
    ...(dFilterGoldEcosystem && { goldEcosystem: dFilterGoldEcosystem }),
    ...(dLenMin && { lengthMin: Number(dLenMin) }),
    ...(dLenMax && { lengthMax: Number(dLenMax) }),
    ...(dGenesMin && { genesMin: Number(dGenesMin) }),
    ...(dGenesMax && { genesMax: Number(dGenesMax) }),
    ...(dSimMin && { distanceMin: Number(dSimMin) }),
    ...(dSimMax && { distanceMax: Number(dSimMax) }),
  };

  const { data, isLoading, error } = useBgcs(apiParams);

  const bgcs = data?.data?.data || [];
  const total = data?.data?.total || 0;

  useEffect(() => {
    setCurrentPage(0);
  }, [dSearch, dFilterId, dFilterName, dFilterBiome, dFilterTypeText, dFilterAssembly, dFilterGcf, dFilterSampleText, dFilterDataSource, dFilterTaxonomy, dFilterGoldEcosystem, dLenMin, dLenMax, dGenesMin, dGenesMax, dSimMin, dSimMax, filters.filterCompleteness, filters.typeFilter, setCurrentPage]);

  const columns = useBgcTableColumns(context);

  if (!mounted) {
    return null;
  }

  return (
    <div className="space-y-4">
      {(config.showGlobalSearch || config.showProductClassFilter || config.showExportButtons) && (
        <BgcTableFilters bgcs={bgcs} total={total} exportPath={bgcExportPath(apiParams)} />
      )}

      {config.showFilterChips && (
        <FilterChips
          className="mb-4"
          filters={[
            ...(filters.searchTerm ? [{
              key: 'search',
              label: 'Search',
              value: filters.searchTerm,
              onRemove: () => {
                setFilters({ searchTerm: '' });
                setCurrentPage(0);
              }
            }] : []),
            ...(filters.typeFilter ? [{
              key: 'class',
              label: 'Category',
              value: filters.typeFilter,
              onRemove: () => {
                setFilters({ typeFilter: '' });
                setCurrentPage(0);
              }
            }] : []),
          ]}
          onClearAll={() => {
            setFilters({ searchTerm: '', typeFilter: '' });
            setCurrentPage(0);
          }}
        />
      )}

      <BgcTableContent bgcs={bgcs} columns={columns} isLoading={isLoading} error={error} />

      <BgcTablePagination total={total} />
    </div>
  );
}

export function BgcTable(props: BgcTableProps) {
  return (
    <BgcTableProvider
      preFilters={props.preFilters}
      config={props.config}
      columnConfig={props.columnConfig}
      paginationConfig={props.paginationConfig}
      tourConfig={props.tourConfig}
      onBgcClick={props.onBgcClick}
    >
      <BgcTableInner />
    </BgcTableProvider>
  );
}
