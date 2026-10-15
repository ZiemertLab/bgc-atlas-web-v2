import type { ReactNode } from 'react';

export interface TableColumn<T = unknown> {
  id: string;
  label: string;
  width?: number;
  minWidth?: number;
  maxWidth?: number;
  sortable?: boolean;
  /** Direction of the first click on this column (default 'asc'); use 'desc' for counts and sizes. */
  defaultSortDirection?: 'asc' | 'desc';
  visible?: boolean;
  resizable?: boolean;
  filterable?: boolean;
  filterType?: 'text' | 'select' | 'range';
  filterOptions?: { label: string; value: string }[];
  /** Replaces the entire header, including the sort button; only for `sortable: false` columns. */
  renderHeader?: () => ReactNode;
  /** A control beside the sort button (e.g. a rank `<Select>`); use instead of `renderHeader`. */
  headerControl?: () => ReactNode;
  /** "?" tooltip beside the label; use instead of `renderHeader`, which drops sorting. */
  headerTooltip?: string;
  /**
   * Native hover title on the header label. Costs no width, unlike headerTooltip's
   * icon, so it suits an abbreviated label in a tight column budget.
   */
  headerTitle?: string;
  renderCell?: (rowData: T, rowIndex: number) => ReactNode;
  // Filter state shape varies per column (string / range object / etc.) — callers narrow.
  renderFilter?: (filterState: unknown, onFilterChange: (value: unknown) => void) => ReactNode;
  className?: string;
  headerClassName?: string;
}

export interface ResizableTableProps<T = unknown> {
  columns: TableColumn<T>[];
  data: T[];
  onColumnReorder?: (newOrder: string[]) => void;
  onColumnResize?: (columnId: string, width: number) => void;
  onColumnVisibilityChange?: (columnId: string, visible: boolean) => void;
  onSort?: (columnId: string, direction: 'asc' | 'desc') => void;
  sortColumn?: string;
  sortDirection?: 'asc' | 'desc';
  filters?: Record<string, unknown>;
  onFilterChange?: (columnId: string, value: unknown) => void;
  onFilterToggle?: (columnId: string, show: boolean) => void;
  showFilters?: Record<string, boolean>;
  className?: string;
  emptyState?: ReactNode;
  renderExpandedRow?: (rowData: T, rowIndex: number, visibleColumnCount: number) => ReactNode | null;
  /** Pin the first visible column when scrolling sideways, below `lg` only. */
  stickyFirstColumn?: boolean;
}
