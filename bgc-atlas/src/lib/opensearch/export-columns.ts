// Columns and serializers for BGC property-search exports, shared by the current-page
// download and the export-all endpoint so both produce identical files.

export interface ExportColumn { key: string; label: string; }

export const EXPORT_COLUMNS: ExportColumn[] = [
  { key: 'bgc_id', label: 'BGC ID' },
  { key: 'filename', label: 'Filename' },
  { key: 'contig', label: 'Contig' },
  { key: 'product_type', label: 'Product' },
  { key: 'product_category', label: 'Category' },
  { key: 'length', label: 'Length (bp)' },
  { key: 'is_complete', label: 'Complete' },
  { key: 'num_cds_features', label: 'Genes' },
  { key: 'tax_phylum', label: 'Phylum' },
  { key: 'tax_genus', label: 'Genus' },
  { key: 'tax_species', label: 'Species' },
  { key: 'sample_name', label: 'Sample' },
  { key: 'sample_type', label: 'Sample type' },
  { key: 'gcf_name', label: 'GCF' },
  { key: 'gcf_id', label: 'GCF ID' },
  { key: 'data_source', label: 'Data source' },
];

type Hit = Record<string, unknown>;

export function cellValue(hit: Hit, key: string): string {
  const v = hit[key];
  if (v == null) return '';
  if (Array.isArray(v)) return v.map(String).join('; ');
  return String(v);
}

const escapeDelimited = (value: string, delimiter: string): string => {
  if (value.includes(delimiter) || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
};

// The generic pair; `toDelimited`/`toJsonRows` below are the BGC-column bindings.

export function serializeDelimited(
  rows: Hit[], columns: ExportColumn[], delimiter: string,
): string {
  const header = columns.map((c) => escapeDelimited(c.label, delimiter)).join(delimiter);
  const body = rows.map((r) =>
    columns.map((c) => escapeDelimited(cellValue(r, c.key), delimiter)).join(delimiter),
  );
  return [header, ...body].join('\n');
}

export function serializeJsonRows(
  rows: Hit[], columns: ExportColumn[],
): Array<Record<string, string>> {
  return rows.map((r) => Object.fromEntries(columns.map((c) => [c.key, cellValue(r, c.key)])));
}

export const toDelimited = (hits: Hit[], delimiter: string): string =>
  serializeDelimited(hits, EXPORT_COLUMNS, delimiter);

export const toJsonRows = (hits: Hit[]): Array<Record<string, string>> =>
  serializeJsonRows(hits, EXPORT_COLUMNS);
