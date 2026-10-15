// One serializer for the page download (browser) and the streamed export (server, in batches), so
// a page is a byte-identical slice of the full export. Client-safe.
import { escapeDelimitedField } from '@/lib/utils/export';

export type ExportFormat = 'csv' | 'tsv' | 'json';

export type ExportCell = string | number | null | undefined;

export interface ExportColumn<T> {
  id: string;
  label: string;
  value: (row: T) => ExportCell;
}

/** Rows one "All matching" export may carry. Whole tables are on the Downloads page. */
export const EXPORT_ROW_CAP = 100_000;

export const parseExportFormat = (value: string | null | undefined): ExportFormat | null =>
  value === 'csv' || value === 'tsv' || value === 'json' ? value : null;

export const EXPORT_MIME: Record<ExportFormat, string> = {
  csv: 'text/csv; charset=utf-8',
  tsv: 'text/tab-separated-values; charset=utf-8',
  json: 'application/json; charset=utf-8',
};

const separatorOf = (format: ExportFormat) => (format === 'csv' ? ',' : '\t');

export function exportPreamble<T>(columns: ExportColumn<T>[], format: ExportFormat): string {
  if (format === 'json') return '[\n';
  const sep = separatorOf(format);
  return `${columns.map((c) => escapeDelimitedField(c.label, sep)).join(sep)}\n`;
}

export const exportEpilogue = (format: ExportFormat): string => (format === 'json' ? '\n]\n' : '');

// `first` says whether anything precedes these rows, which JSON needs to place its commas.
export function exportRows<T>(
  rows: T[], columns: ExportColumn<T>[], format: ExportFormat, first: boolean,
): string {
  if (rows.length === 0) return '';
  if (format === 'json') {
    const objects = rows.map((row) => `  ${JSON.stringify(
      Object.fromEntries(columns.map((c) => [c.id, normalizeCell(c.value(row))])),
    )}`);
    return `${first ? '' : ',\n'}${objects.join(',\n')}`;
  }
  const sep = separatorOf(format);
  return rows
    .map((row) => columns.map((c) => escapeDelimitedField(normalizeCell(c.value(row)), sep)).join(sep))
    .join('\n') + '\n';
}

export function serializeExport<T>(rows: T[], columns: ExportColumn<T>[], format: ExportFormat): string {
  return exportPreamble(columns, format) + exportRows(rows, columns, format, true) + exportEpilogue(format);
}

/** Absent is '' in a file and null in JSON; numbers stay numbers. */
function normalizeCell(cell: ExportCell): string | number | null {
  if (cell === null || cell === undefined) return null;
  if (typeof cell === 'number') return Number.isFinite(cell) ? cell : null;
  return cell;
}

/** `bgcs_32104_20261002-1930.tsv`; past the cap, `bgcs_first100000of1234567_...`. */
export function exportFilename(
  stem: string, rows: number, total: number, format: ExportFormat, now = new Date(),
): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`
    + `-${pad(now.getHours())}${pad(now.getMinutes())}`;
  const count = rows < total ? `first${rows}of${total}` : String(rows);
  return `${stem}_${count}_${stamp}.${format}`;
}

/** Hand a finished string to the browser as a file. Client only. */
export function downloadText(content: string, filename: string, format: ExportFormat): void {
  const blob = new Blob([content], { type: EXPORT_MIME[format] });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(url);
    a.remove();
  }, 0);
}
