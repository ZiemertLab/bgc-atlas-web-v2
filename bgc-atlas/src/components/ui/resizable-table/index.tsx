'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  horizontalListSortingStrategy,
} from '@dnd-kit/sortable';
import { cn } from '@/lib/utils';
import { ColumnSettingsPopover } from './column-settings-popover';
import { FilterRow } from './filter-row';
import { SortableTableHead } from './sortable-table-head';
import type { ResizableTableProps, TableColumn } from './types';

export type { TableColumn, ResizableTableProps } from './types';

export function ResizableTable<T>({
  columns: initialColumns,
  data,
  onColumnReorder,
  onColumnResize,
  onColumnVisibilityChange,
  onSort,
  sortColumn,
  sortDirection,
  filters = {},
  onFilterChange,
  onFilterToggle,
  showFilters = {},
  className,
  emptyState,
  renderExpandedRow,
  stickyFirstColumn = false,
}: ResizableTableProps<T>) {
  const [columns, setColumns] = useState(initialColumns);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const visibleColumns = useMemo(() =>
    columns
      .filter(col => col.visible !== false)
      .map(col => {
        const propCol = (initialColumns || []).find(c => c.id === col.id);
        if (!propCol) return col;
        return {
          ...propCol,
          width: col.width,
          visible: col.visible,
        };
      }),
    [columns, initialColumns]
  );

  const columnIds = useMemo(() =>
    visibleColumns.map(col => col.id),
    [visibleColumns]
  );

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;

    if (over && active.id !== over.id) {
      const oldIndex = columnIds.indexOf(active.id as string);
      const newIndex = columnIds.indexOf(over.id as string);

      const newColumnOrder = arrayMove(columnIds, oldIndex, newIndex);

      const newColumns = [...columns];
      const visibleColumnsReordered = arrayMove(visibleColumns, oldIndex, newIndex);

      let visibleIndex = 0;
      for (let i = 0; i < newColumns.length; i++) {
        if (newColumns[i].visible !== false) {
          newColumns[i] = visibleColumnsReordered[visibleIndex];
          visibleIndex++;
        }
      }

      setColumns(newColumns);
      onColumnReorder?.(newColumnOrder);
    }
  }, [columnIds, columns, visibleColumns, onColumnReorder]);

  const handleColumnResize = useCallback((columnId: string, width: number) => {
    setColumns(prev => prev.map(col =>
      col.id === columnId ? { ...col, width } : col
    ));
    onColumnResize?.(columnId, width);
  }, [onColumnResize]);

  const handleVisibilityChange = useCallback((columnId: string, visible: boolean) => {
    setColumns(prev => prev.map(col =>
      col.id === columnId ? { ...col, visible } : col
    ));
    onColumnVisibilityChange?.(columnId, visible);
  }, [onColumnVisibilityChange]);

  const anyFilterOpen = Object.values(showFilters).some(Boolean);

  // Always-visible custom scrollbar: the native one sits at the table's bottom and auto-hides
  // on overlay-scrollbar platforms, hiding that there is more content sideways.
  const bodyScrollRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const [isHorizontallyScrollable, setIsHorizontallyScrollable] = useState(false);
  const [thumb, setThumb] = useState({ width: 0, left: 0 });
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);
  // An expanded row is one cell spanning every column, so its content is pinned to the
  // scroll box's visible width rather than the table's.
  const [bodyClientWidth, setBodyClientWidth] = useState(0);

  const MIN_THUMB = 32;

  const syncFromBody = useCallback(() => {
    const body = bodyScrollRef.current;
    const track = trackRef.current;
    if (!body) return;
    const maxScroll = body.scrollWidth - body.clientWidth;
    setCanScrollLeft(body.scrollLeft > 1);
    setCanScrollRight(body.scrollLeft < maxScroll - 1);
    if (track) {
      const trackW = track.clientWidth;
      const width = Math.max(trackW * (body.clientWidth / body.scrollWidth), MIN_THUMB);
      const maxLeft = trackW - width;
      const left = maxScroll > 0 ? (body.scrollLeft / maxScroll) * maxLeft : 0;
      setThumb({ width, left });
    }
  }, []);

  useEffect(() => {
    const body = bodyScrollRef.current;
    if (!body) return;

    const update = () => {
      setIsHorizontallyScrollable(body.scrollWidth > body.clientWidth + 1);
      setBodyClientWidth(body.clientWidth);
      syncFromBody();
    };

    update();

    const resizeObserver = new ResizeObserver(update);
    resizeObserver.observe(body);
    if (trackRef.current) resizeObserver.observe(trackRef.current);
    return () => resizeObserver.disconnect();
  }, [visibleColumns, data, anyFilterOpen, syncFromBody, isHorizontallyScrollable]);

  const handleBodyScroll = useCallback(() => {
    syncFromBody();
  }, [syncFromBody]);

  // Move/up listeners go on window so the drag survives the pointer leaving the bar.
  const scrollbarDragRef = useRef<{ startX: number; startScrollLeft: number } | null>(null);

  const handleScrollbarDragMove = useCallback((e: PointerEvent) => {
    const body = bodyScrollRef.current;
    const track = trackRef.current;
    if (!body || !track || !scrollbarDragRef.current) return;
    const trackW = track.clientWidth;
    const width = Math.max(trackW * (body.clientWidth / body.scrollWidth), MIN_THUMB);
    const maxLeft = trackW - width;
    const maxScroll = body.scrollWidth - body.clientWidth;
    const dx = e.clientX - scrollbarDragRef.current.startX;
    const scrollPerPx = maxLeft > 0 ? maxScroll / maxLeft : 0;
    body.scrollLeft = scrollbarDragRef.current.startScrollLeft + dx * scrollPerPx;
  }, []);

  const handleScrollbarDragEnd = useCallback(() => {
    scrollbarDragRef.current = null;
    window.removeEventListener('pointermove', handleScrollbarDragMove);
    window.removeEventListener('pointerup', handleScrollbarDragEnd);
    document.body.style.userSelect = '';
  }, [handleScrollbarDragMove]);

  const beginScrollbarDrag = useCallback((clientX: number) => {
    const body = bodyScrollRef.current;
    if (!body) return;
    scrollbarDragRef.current = { startX: clientX, startScrollLeft: body.scrollLeft };
    window.addEventListener('pointermove', handleScrollbarDragMove);
    window.addEventListener('pointerup', handleScrollbarDragEnd);
    document.body.style.userSelect = 'none';
  }, [handleScrollbarDragMove, handleScrollbarDragEnd]);

  const handleThumbPointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    beginScrollbarDrag(e.clientX);
  }, [beginScrollbarDrag]);

  const handleTrackPointerDown = useCallback((e: React.PointerEvent) => {
    const body = bodyScrollRef.current;
    const track = trackRef.current;
    if (!body || !track) return;
    const rect = track.getBoundingClientRect();
    const trackW = track.clientWidth;
    const width = Math.max(trackW * (body.clientWidth / body.scrollWidth), MIN_THUMB);
    const maxLeft = trackW - width;
    const maxScroll = body.scrollWidth - body.clientWidth;
    const targetLeft = Math.min(Math.max(e.clientX - rect.left - width / 2, 0), maxLeft);
    body.scrollLeft = maxLeft > 0 ? (targetLeft / maxLeft) * maxScroll : 0;
    beginScrollbarDrag(e.clientX);
  }, [beginScrollbarDrag]);

  useEffect(() => () => {
    window.removeEventListener('pointermove', handleScrollbarDragMove);
    window.removeEventListener('pointerup', handleScrollbarDragEnd);
  }, [handleScrollbarDragMove, handleScrollbarDragEnd]);

  return (
    <div className={cn("space-y-4", className)}>
      <div className="flex items-center justify-between">
        <div className="text-sm text-muted-foreground">
          {data.length} {data.length === 1 ? 'item' : 'items'}
        </div>
        <div className="flex items-center gap-2">
          <ColumnSettingsPopover
            columns={columns as TableColumn<unknown>[]}
            onVisibilityChange={handleVisibilityChange}
          />
        </div>
      </div>

      {isHorizontallyScrollable && (
        <div
          className="sticky top-0 z-20 rounded-t-md border border-b-0 bg-background px-2 py-2"
          aria-hidden="true"
        >
          <div
            ref={trackRef}
            onPointerDown={handleTrackPointerDown}
            className="relative h-2.5 w-full cursor-pointer rounded-full bg-muted"
          >
            <div
              onPointerDown={handleThumbPointerDown}
              style={{ width: thumb.width, transform: `translateX(${thumb.left}px)` }}
              className="absolute inset-y-0 left-0 cursor-grab rounded-full bg-muted-foreground/50 transition-colors hover:bg-muted-foreground/70 active:cursor-grabbing active:bg-muted-foreground/80"
            />
          </div>
        </div>
      )}

      <div className="relative">
        {isHorizontallyScrollable && (
          <>
            <div
              aria-hidden="true"
              className={cn(
                'pointer-events-none absolute inset-y-0 left-0 z-10 w-14 rounded-l-md bg-gradient-to-r from-background via-background/80 to-transparent transition-opacity duration-200',
                canScrollLeft ? 'opacity-100' : 'opacity-0'
              )}
            />
            <div
              aria-hidden="true"
              className={cn(
                'pointer-events-none absolute inset-y-0 right-0 z-10 w-14 rounded-r-md bg-gradient-to-l from-background via-background/80 to-transparent transition-opacity duration-200',
                canScrollRight ? 'opacity-100' : 'opacity-0'
              )}
            />
          </>
        )}

        <div
          ref={bodyScrollRef}
          onScroll={handleBodyScroll}
          className={cn(
            'fancy-scrollbar border overflow-auto',
            isHorizontallyScrollable ? 'rounded-b-md border-t-0' : 'rounded-md'
          )}
        >
          <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <table
            className={cn(
              'w-full table-fixed caption-bottom text-sm',
              stickyFirstColumn && [
                'max-lg:[&_th:first-child]:sticky max-lg:[&_th:first-child]:left-0 max-lg:[&_th:first-child]:z-20 max-lg:[&_th:first-child]:bg-card',
                'max-lg:[&_td:first-child]:sticky max-lg:[&_td:first-child]:left-0 max-lg:[&_td:first-child]:z-20 max-lg:[&_td:first-child]:bg-card max-lg:[&_td:first-child]:shadow-[2px_0_4px_-2px_rgba(0,0,0,0.1)]',
              ]
            )}
          >
            <thead>
              <SortableContext items={columnIds} strategy={horizontalListSortingStrategy}>
                <tr className="border-b transition-colors hover:bg-accent data-[state=selected]:bg-muted">
                  {visibleColumns.map((column) => (
                    <SortableTableHead
                      key={column.id}
                      column={column as TableColumn<unknown>}
                      onResize={(width) => handleColumnResize(column.id, width)}
                      sortColumn={sortColumn}
                      sortDirection={sortDirection}
                      onSort={onSort}
                      onFilterToggle={onFilterToggle}
                      isFilterActive={Boolean(showFilters?.[column.id])}
                    />
                  ))}
                </tr>
                {anyFilterOpen && (
                  <FilterRow
                    visibleColumns={visibleColumns as TableColumn<unknown>[]}
                    filters={filters}
                    showFilters={showFilters}
                    onFilterChange={onFilterChange}
                  />
                )}
              </SortableContext>
            </thead>
            <tbody>
              {data.length === 0 ? (
                <tr>
                  <td
                    colSpan={Math.max(visibleColumns.length, 1)}
                    className="px-6 py-10 text-center text-muted-foreground"
                  >
                    {emptyState ?? 'No records available'}
                  </td>
                </tr>
              ) : (
                data.map((row, rowIndex) => (
                  <React.Fragment key={rowIndex}>
                    <tr className="border-b transition-colors hover:bg-accent data-[state=selected]:bg-muted">
                      {visibleColumns.map((column) => (
                        <td
                          key={column.id}
                          style={{ width: column.width || 180 }}
                          className={cn("align-middle px-4 py-3", column.className)}
                        >
                          {column.renderCell
                            ? column.renderCell(row, rowIndex)
                            : ((row as Record<string, ReactNode>)[column.id] ?? null)
                          }
                        </td>
                      ))}
                    </tr>
                    {renderExpandedRow ? (() => {
                      const expandedContent = renderExpandedRow(row, rowIndex, visibleColumns.length);
                      return expandedContent ? (
                        <tr className="border-b">
                          <td colSpan={visibleColumns.length} className="p-0">
                            {isHorizontallyScrollable && bodyClientWidth > 0 ? (
                              <div
                                className="sticky left-0 overflow-x-auto"
                                style={{ width: bodyClientWidth }}
                              >
                                {expandedContent}
                              </div>
                            ) : expandedContent}
                          </td>
                        </tr>
                      ) : null;
                    })() : null}
                  </React.Fragment>
                ))
              )}
            </tbody>
          </table>
        </DndContext>
        </div>
      </div>
    </div>
  );
}
