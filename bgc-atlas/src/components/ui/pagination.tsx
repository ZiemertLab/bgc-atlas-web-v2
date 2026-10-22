'use client';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react';
import { useId, useState } from 'react';
import { DEFAULT_PAGE_SIZE_OPTIONS } from '@/lib/url-state';

interface PaginationProps {
  currentPage: number;
  totalPages: number;
  totalItems: number;
  pageSize: number;
  offset: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
  pageSizeOptions?: readonly number[];
}

export function Pagination({
  currentPage,
  totalPages,
  totalItems,
  pageSize,
  offset,
  onPageChange,
  onPageSizeChange,
  pageSizeOptions = DEFAULT_PAGE_SIZE_OPTIONS
}: PaginationProps) {
  const [jumpToPage, setJumpToPage] = useState('');
  // Two Pagination instances per page (top and bottom): ids must be unique.
  const pageSizeLabelId = useId();

  const handleJumpToPage = () => {
    const pageNum = parseInt(jumpToPage);
    if (pageNum >= 1 && pageNum <= totalPages) {
      onPageChange(pageNum - 1);
      setJumpToPage('');
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleJumpToPage();
    }
  };

  const getPageNumbers = () => {
    const pages: (number | string)[] = [];
    const showPages = 5;
    
    if (totalPages <= showPages) {
      for (let i = 0; i < totalPages; i++) {
        pages.push(i);
      }
    } else {
      const start = Math.max(0, Math.min(currentPage - 2, totalPages - showPages));
      const end = Math.min(totalPages, start + showPages);
      
      if (start > 0) {
        pages.push(0);
        if (start > 1) pages.push('...');
      }
      
      for (let i = start; i < end; i++) {
        pages.push(i);
      }
      
      if (end < totalPages) {
        if (end < totalPages - 1) pages.push('...');
        pages.push(totalPages - 1);
      }
    }
    
    return pages;
  };

  return (
    <div className="flex w-full min-w-0 flex-col gap-4 sm:w-auto sm:flex-row sm:items-center sm:justify-between">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-4">
        <p className="text-xs text-muted-foreground tabular-nums">
          Showing <span className="font-mono text-foreground">{(offset + 1).toLocaleString()}–{Math.min(offset + pageSize, totalItems).toLocaleString()}</span>{' '}
          of <span className="font-mono text-foreground">{totalItems.toLocaleString()}</span>
        </p>

        <div className="flex items-center gap-2">
          <span id={`${pageSizeLabelId}-show`} className="text-xs text-muted-foreground">Show</span>
          {/* Radix item values are strings. A pageSize outside the options
              still gets an item, so the trigger never renders blank. */}
          <Select
            value={String(pageSize)}
            onValueChange={(val) => onPageSizeChange(parseInt(val, 10))}
          >
            <SelectTrigger
              size="sm"
              // Named by the visible words around it ("Show … per page").
              aria-labelledby={`${pageSizeLabelId}-show ${pageSizeLabelId}-per-page`}
              // data-[size=sm]:h-7, not h-7: the trigger's size variant
              // out-specifies a plain height class. 28px matches the row.
              className="data-[size=sm]:h-7 w-auto min-w-16 gap-1 px-2 font-mono text-xs tabular-nums"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="min-w-[5rem]">
              {(pageSizeOptions.includes(pageSize)
                ? pageSizeOptions
                : [...pageSizeOptions, pageSize].sort((a, b) => a - b)
              ).map((size) => (
                <SelectItem key={size} value={String(size)} className="font-mono text-xs tabular-nums">
                  {size.toLocaleString()}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <span id={`${pageSizeLabelId}-per-page`} className="text-xs text-muted-foreground">per page</span>
        </div>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-muted-foreground">Go to</span>
          <Input
            type="number"
            min="1"
            max={totalPages}
            value={jumpToPage}
            onChange={(e) => setJumpToPage(e.target.value)}
            onKeyPress={handleKeyPress}
            className="h-7 w-20 text-right text-xs tabular-nums"
            placeholder={String(currentPage + 1)}
          />
          <Button
            variant="outline"
            size="sm"
            onClick={handleJumpToPage}
            disabled={!jumpToPage || parseInt(jumpToPage) < 1 || parseInt(jumpToPage) > totalPages}
          >
            Go
          </Button>
        </div>

        {/* Wraps on narrow screens, where six-digit page numbers would overflow. */}
        <div className="flex min-w-0 flex-wrap items-center gap-1">
          {/* Hidden on phones; "Go to" and the last-page number still reach either end. */}
          <Button
            variant="outline"
            size="sm"
            onClick={() => onPageChange(0)}
            disabled={currentPage === 0}
            className="hidden h-7 w-7 p-0 sm:inline-flex"
            aria-label="First page"
          >
            <ChevronsLeft className="size-3.5" />
          </Button>

          <Button
            variant="outline"
            size="sm"
            onClick={() => onPageChange(currentPage - 1)}
            disabled={currentPage === 0}
            className="h-7 w-7 p-0"
            aria-label="Previous page"
          >
            <ChevronLeft className="size-3.5" />
          </Button>

          {getPageNumbers().map((page, index) => (
            <Button
              key={index}
              variant={page === currentPage ? "default" : "outline"}
              size="sm"
              onClick={() => typeof page === 'number' ? onPageChange(page) : undefined}
              disabled={typeof page === 'string'}
              className="h-7 min-w-7 px-1.5 font-mono text-xs tabular-nums"
            >
              {typeof page === 'string' ? page : page + 1}
            </Button>
          ))}

          <Button
            variant="outline"
            size="sm"
            onClick={() => onPageChange(currentPage + 1)}
            disabled={currentPage >= totalPages - 1}
            className="h-7 w-7 p-0"
            aria-label="Next page"
          >
            <ChevronRight className="size-3.5" />
          </Button>

          <Button
            variant="outline"
            size="sm"
            onClick={() => onPageChange(totalPages - 1)}
            disabled={currentPage >= totalPages - 1}
            className="hidden h-7 w-7 p-0 sm:inline-flex"
            aria-label="Last page"
          >
            <ChevronsRight className="size-3.5" />
          </Button>
        </div>
      </div>
    </div>
  );
}