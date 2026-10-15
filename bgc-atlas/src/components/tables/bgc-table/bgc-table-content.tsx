'use client';

import { Loader2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ResizableTable } from '@/components/ui/resizable-table';
import { BgcCard } from '@/components/ui/bgc-card';
import { BiomeLegend } from '@/components/ui/biome-legend';
import { Button } from '@/components/ui/button';
import { TableSkeleton } from '@/components/ui/loading-skeleton';
import { useBgcTable } from './bgc-table-context';
import type { useBgcTableColumns } from './bgc-table-columns';
import type { BgcListItem } from './bgc-table-types';

interface BgcTableContentProps {
  bgcs: BgcListItem[];
  /** Built by the parent so the export shares them. */
  columns: ReturnType<typeof useBgcTableColumns>;
  isLoading: boolean;
  error: Error | null;
}

export function BgcTableContent({ bgcs, columns, isLoading, error }: BgcTableContentProps) {
  const context = useBgcTable();

  const {
    sortField,
    sortOrder,
    filters,
    showFilters,
    setColumnOrder,
    setColumnVisibility,
    setColumnWidths,
    setShowFilters,
    setSortField,
    setSortOrder,
    setFilters,
    setCurrentPage,
    resetFilters,
  } = context;

  const handleSort = (columnId: string, direction: 'asc' | 'desc') => {
    setSortField(columnId);
    setSortOrder(direction);
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
        setFilters({ filterId: str });
        break;
      case 'assembly':
        setFilters({ filterAssembly: str });
        break;
      case 'class':
        setFilters({ typeFilter: str });
        setCurrentPage(0);
        break;
      case 'type':
        setFilters({ filterTypeText: str });
        break;
      case 'completeness':
        setFilters({ filterCompleteness: str });
        setCurrentPage(0);
        break;
      case 'taxonomy':
        setFilters({ filterTaxonomy: str });
        break;
      case 'goldEcosystem':
        setFilters({ filterGoldEcosystem: str });
        break;
      case 'length':
        setFilters({ lenMin: range.min ?? '', lenMax: range.max ?? '' });
        break;
      case 'genes':
        setFilters({ genesMin: range.min ?? '', genesMax: range.max ?? '' });
        break;
      case 'gcf':
        setFilters({ filterGcf: str });
        break;
      case 'samples':
        setFilters({ filterSampleText: str });
        break;
      case 'source':
        setFilters({ filterDataSource: str });
        break;
      case 'distance':
        setFilters({ simMin: range.min ?? '', simMax: range.max ?? '' });
        break;
    }
  };

  const tableFilters = {
    id: filters.filterId,
    assembly: filters.filterAssembly,
    class: filters.typeFilter,
    type: filters.filterTypeText,
    completeness: filters.filterCompleteness,
    goldEcosystem: filters.filterGoldEcosystem,
    taxonomy: filters.filterTaxonomy,
    length: { min: filters.lenMin, max: filters.lenMax },
    genes: { min: filters.genesMin, max: filters.genesMax },
    gcf: filters.filterGcf,
    samples: filters.filterSampleText,
    source: filters.filterDataSource,
    distance: { min: filters.simMin, max: filters.simMax }
  };

  const emptyState = (
    <div className="py-10 text-center text-muted-foreground">
      No BGCs found. Adjust or
      <Button variant="link" className="px-1" onClick={resetFilters}>reset filters</Button>.
    </div>
  );

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Biosynthetic Gene Clusters</CardTitle>
          <div className="mt-2">
            <BiomeLegend />
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {error ? (
          <div className="py-12 text-center text-sm">
            <p className="font-semibold text-destructive">Failed to load BGCs</p>
            <p className="mx-auto mt-2 max-w-prose text-muted-foreground">{error.message}</p>
          </div>
        ) : isLoading ? (
          <div className="space-y-6">
            <div className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin text-primary" />
              <span>Loading BGCs…</span>
            </div>
            <TableSkeleton rows={10} />
          </div>
        ) : (
          <>
            <div className="lg:hidden space-y-4">
              {bgcs.length === 0 ? (
                emptyState
              ) : (
                bgcs.map((bgc) => (
                  <BgcCard key={bgc.id} bgc={bgc} />
                ))
              )}
            </div>

            <div className="hidden lg:block">
              <ResizableTable
                columns={columns}
                data={bgcs}
                onColumnReorder={handleColumnReorder}
                onColumnResize={handleColumnResize}
                onColumnVisibilityChange={handleColumnVisibilityChange}
                onSort={handleSort}
                sortColumn={sortField || 'length'}
                sortDirection={sortOrder}
                filters={tableFilters}
                onFilterChange={handleFilterChange}
                onFilterToggle={handleFilterToggle}
                showFilters={showFilters}
                emptyState={emptyState}
              />
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
