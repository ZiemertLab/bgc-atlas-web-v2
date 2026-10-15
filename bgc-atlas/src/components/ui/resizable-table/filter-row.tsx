'use client';

import { Input } from '@/components/ui/input';
import type { TableColumn } from './types';

interface FilterRowProps {
  visibleColumns: TableColumn<unknown>[];
  filters: Record<string, unknown>;
  showFilters: Record<string, boolean>;
  onFilterChange?: (columnId: string, value: unknown) => void;
}

export function FilterRow({
  visibleColumns,
  filters,
  showFilters,
  onFilterChange,
}: FilterRowProps) {
  return (
    <tr className="border-b">
      {visibleColumns.map((column) => (
        <th
          key={`filter-${column.id}`}
          style={{ width: column.width || 180 }}
          className="px-4 py-2"
        >
          {showFilters[column.id] && column.filterable && renderFilterInput(column, filters[column.id], onFilterChange)}
        </th>
      ))}
    </tr>
  );
}

function renderFilterInput(
  column: TableColumn<unknown>,
  filterValue: unknown,
  onFilterChange?: (columnId: string, value: unknown) => void,
) {
  if (column.renderFilter) {
    return column.renderFilter(filterValue, (value) => onFilterChange?.(column.id, value));
  }
  if (column.filterType === 'select') {
    return (
      <select
        value={(filterValue as string | undefined) ?? ''}
        onChange={(e) => onFilterChange?.(column.id, e.target.value)}
        className="h-8 text-xs rounded-md border border-input bg-background px-2 w-full"
      >
        <option value="">All</option>
        {column.filterOptions?.map((option) => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
    );
  }
  if (column.filterType === 'range') {
    const range = (filterValue as { min?: string; max?: string } | undefined) ?? {};
    return (
      <div className="flex gap-1">
        <Input
          placeholder="min"
          value={range.min ?? ''}
          onChange={(e) => onFilterChange?.(column.id, { ...range, min: e.target.value })}
          className="h-8 w-16 text-xs"
        />
        <Input
          placeholder="max"
          value={range.max ?? ''}
          onChange={(e) => onFilterChange?.(column.id, { ...range, max: e.target.value })}
          className="h-8 w-16 text-xs"
        />
      </div>
    );
  }
  return (
    <Input
      placeholder={`Filter ${column.label.toLowerCase()}...`}
      value={(filterValue as string | undefined) ?? ''}
      onChange={(e) => onFilterChange?.(column.id, e.target.value)}
      className="h-8 text-xs"
    />
  );
}
