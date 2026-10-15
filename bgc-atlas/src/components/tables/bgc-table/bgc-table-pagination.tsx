'use client';

import { Button } from '@/components/ui/button';
import { Pagination } from '@/components/ui/pagination';
import { useBgcTable } from './bgc-table-context';

interface BgcTablePaginationProps {
  total: number;
}

export function BgcTablePagination({ total }: BgcTablePaginationProps) {
  const {
    currentPage,
    pageSize,
    setCurrentPage,
    setPageSize,
    resetFilters,
    paginationConfig,
    config,
  } = useBgcTable();

  if (!config.showPagination) {
    return null;
  }

  const totalPages = Math.ceil(total / pageSize);
  const offset = currentPage * pageSize;

  return (
    <div className="mt-6 flex items-center justify-between gap-3">
      <Button variant="outline" onClick={resetFilters}>
        Reset Filters
      </Button>
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
        pageSizeOptions={paginationConfig.pageSizeOptions}
      />
    </div>
  );
}
