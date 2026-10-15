'use client';

import React, { useCallback, useState } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Filter, GripVertical } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { InfoTooltip } from '@/components/ui/info-tooltip';
import { cn } from '@/lib/utils';
import type { TableColumn } from './types';

interface SortableTableHeadProps {
  column: TableColumn<unknown>;
  onResize: (width: number) => void;
  sortColumn?: string;
  sortDirection?: 'asc' | 'desc';
  onSort?: (columnId: string, direction: 'asc' | 'desc') => void;
  onFilterToggle?: (columnId: string, show: boolean) => void;
  isFilterActive?: boolean;
}

export function SortableTableHead({
  column,
  onResize,
  sortColumn,
  sortDirection,
  onSort,
  onFilterToggle,
  isFilterActive,
}: SortableTableHeadProps) {
  const [isResizing, setIsResizing] = useState(false);

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: column.id,
    disabled: isResizing,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsResizing(true);

    const startX = e.clientX;
    const startWidth = column.width || 180;

    const handleMouseMove = (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const diff = e.clientX - startX;
      const newWidth = Math.max(column.minWidth || 80, Math.min(column.maxWidth || 500, startWidth + diff));
      onResize(newWidth);
    };

    const handleMouseUp = (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsResizing(false);
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
    };

    document.body.style.cursor = 'col-resize';
    document.addEventListener('mousemove', handleMouseMove, { passive: false });
    document.addEventListener('mouseup', handleMouseUp, { passive: false });
  }, [column.minWidth, column.maxWidth, column.width, onResize]);

  const handleSort = useCallback(() => {
    if (!column.sortable || !onSort) return;
    // Re-clicking toggles; a fresh column opens at its defaultSortDirection.
    const newDirection =
      sortColumn === column.id
        ? sortDirection === 'asc'
          ? 'desc'
          : 'asc'
        : column.defaultSortDirection ?? 'asc';
    onSort(column.id, newDirection);
  }, [column.defaultSortDirection, column.id, column.sortable, onSort, sortColumn, sortDirection]);

  return (
    <th
      ref={setNodeRef}
      style={{ ...style, width: column.width || 180 }}
      className={cn(
        "relative border-b border-border bg-muted/50 px-2 py-3 text-left align-middle font-bold text-muted-foreground select-none",
        column.headerClassName
      )}
    >
      <div className="flex items-center gap-2 px-2">
        <div
          {...attributes}
          {...listeners}
          className="cursor-grab hover:cursor-grabbing p-1 hover:bg-muted rounded flex-shrink-0"
          title="Drag to reorder columns"
        >
          <GripVertical className="h-4 w-4" />
        </div>

        <div className="flex-1 flex items-center gap-1 min-w-0 pr-4">
          {column.renderHeader ? (
            column.renderHeader()
          ) : column.sortable ? (
            <Button
              variant="ghost"
              size="sm"
              className="h-auto p-0 font-bold hover:bg-transparent"
              onClick={handleSort}
              title={column.headerTitle}
            >
              {column.label}
              {sortColumn === column.id && (
                <span className="ml-1">
                  {sortDirection === 'asc' ? '↑' : '↓'}
                </span>
              )}
            </Button>
          ) : (
            <span title={column.headerTitle}>{column.label}</span>
          )}
          {/* Stops events reaching the <th>, which would otherwise sort while the control is used. */}
          {column.headerControl && (
            <span
              className="flex shrink-0"
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => e.stopPropagation()}
            >
              {column.headerControl()}
            </span>
          )}
          {/* Lifted above the resize handle, which would otherwise swallow the hover. */}
          {column.headerTooltip && (
            <span className="relative z-30 flex shrink-0">
              <InfoTooltip content={column.headerTooltip} />
            </span>
          )}
          {column.filterable && onFilterToggle && (
            <Button
              variant="ghost"
              size="sm"
              className={cn(
                "h-6 w-6 p-0",
                isFilterActive && "text-primary"
              )}
              aria-label={`Filter ${column.label}`}
              onClick={() => onFilterToggle(column.id, !isFilterActive)}
            >
              <Filter className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      </div>

      {column.resizable !== false && (
        <div
          className={cn(
            "absolute right-0 top-0 h-full w-3 cursor-col-resize bg-transparent hover:bg-primary/30 transition-colors z-20",
            isResizing && "bg-primary/50"
          )}
          onMouseDown={handleMouseDown}
          title="Drag to resize column"
        />
      )}
    </th>
  );
}
