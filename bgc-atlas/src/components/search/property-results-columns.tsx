'use client';

import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { KnownClusterCell } from '@/components/ui/known-cluster-cell';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import type { TableColumn } from '@/components/ui/resizable-table';
import { getProductCategoryBadgeStyle, getTaxonomyBadgeStyle } from '@/lib/utils/chart-utils';
import { formatGOLDBreadcrumb, getGOLDBadgeClass } from '@/lib/utils/gold-parser';
import { cn } from '@/lib/utils';
import { KNOWNCLUSTER_MIN_SIMILARITY } from '@/lib/known-cluster-thresholds';

// Rows are search-index documents, not /api/bgcs rows, so the column set is its own.
export type Hit = Record<string, unknown>;

const arr = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : v == null ? [] : [String(v)]);
const stripRank = (s: string) => s.replace(/^[a-z]__/, '');
const linkClass = 'text-foreground underline underline-offset-2 decoration-foreground/50 hover:decoration-foreground';

export type TaxRank = 'auto' | 'domain' | 'phylum' | 'class' | 'order' | 'family' | 'genus' | 'species';
const TAX_RANKS: { rank: Exclude<TaxRank, 'auto'>; field: string }[] = [
  { rank: 'domain', field: 'tax_domain' },
  { rank: 'phylum', field: 'tax_phylum' },
  { rank: 'class', field: 'tax_class' },
  { rank: 'order', field: 'tax_order' },
  { rank: 'family', field: 'tax_family' },
  { rank: 'genus', field: 'tax_genus' },
  { rank: 'species', field: 'tax_species' },
];
const taxLineage = (h: Hit): string[] =>
  TAX_RANKS.map(({ field }) => stripRank(String(h[field] ?? ''))).filter(Boolean);
// 'auto' = most specific available. Only genus/species are italicized.
const resolveTax = (h: Hit, rank: TaxRank): { name: string; italic: boolean } => {
  if (rank === 'auto') {
    for (let i = TAX_RANKS.length - 1; i >= 0; i--) {
      const name = stripRank(String(h[TAX_RANKS[i].field] ?? ''));
      if (name) return { name, italic: TAX_RANKS[i].rank === 'genus' || TAX_RANKS[i].rank === 'species' };
    }
    return { name: '', italic: false };
  }
  return { name: stripRank(String(h[`tax_${rank}`] ?? '')), italic: rank === 'genus' || rank === 'species' };
};

export const sortFieldFor = (columnId: string, rank: TaxRank): string =>
  (columnId === 'taxonomy' ? (rank === 'auto' ? 'tax_species' : `tax_${rank}`) : columnId);

export const columnForSortField = (field: string): string => (field.startsWith('tax_') ? 'taxonomy' : field);

/** Off while Refine takes ~280px of the row. */
export const HIDDEN_WITH_REFINE = ['sample_name', 'gold_ecosystem'];

const dash = <span className="text-xs text-muted-foreground">—</span>;

export function propertyResultColumns({ taxRank, setTaxRank }: {
  taxRank: TaxRank;
  setTaxRank: (rank: TaxRank) => void;
}): TableColumn<Hit>[] {
  return [
    {
      id: 'bgc_id',
      label: 'BGC',
      width: 100,
      minWidth: 90,
      renderCell: (h) => {
        const id = String(h.bgc_id ?? '');
        return (
          <Link href={`/bgcs/${id}`} title={id} target="_blank" rel="noopener noreferrer"
            className={cn('block max-w-[100px] truncate font-mono text-xs', linkClass)}>
            {id.slice(0, 8)}…
          </Link>
        );
      },
    },
    {
      id: 'product_category',
      label: 'Category',
      width: 110,
      minWidth: 100,
      sortable: true,
      renderCell: (h) => (
        <div className="flex flex-wrap gap-1">
          {arr(h.product_category).map((c) => (
            <Badge key={c} variant="secondary" className="text-[10px]" style={getProductCategoryBadgeStyle(c)}>{c}</Badge>
          ))}
        </div>
      ),
    },
    {
      id: 'product',
      label: 'Product',
      width: 150,
      minWidth: 120,
      sortable: true,
      renderCell: (h) => {
        const products = arr(h.product ?? h.product_type);
        return products.length
          ? <span className="block truncate text-xs" title={products.join(', ')}>{products.join(', ')}</span>
          : dash;
      },
    },
    {
      id: 'length',
      label: 'Length',
      width: 100,
      minWidth: 80,
      sortable: true,
      defaultSortDirection: 'desc',
      className: 'text-right',
      renderCell: (h) => {
        const len = Number(h.length);
        return Number.isFinite(len)
          ? <span className="font-mono text-xs tabular-nums">{(len / 1000).toFixed(1)} kb</span>
          : dash;
      },
    },
    {
      id: 'is_complete',
      label: 'Complete',
      width: 120,
      minWidth: 90,
      sortable: true,
      renderCell: (h) => {
        if (h.is_complete === undefined || h.is_complete === null) return dash;
        const complete = h.is_complete === true || h.is_complete === 'true' || h.is_complete === 1 || h.is_complete === '1';
        // Neutral pair: partial means the region sits on a contig edge, not an error.
        return (
          <Badge variant={complete ? 'solid' : 'outline'} className="text-[10px]">
            {complete ? 'complete' : 'partial'}
          </Badge>
        );
      },
    },
    {
      id: 'taxonomy',
      label: 'Taxonomy',
      width: 180,
      minWidth: 130,
      sortable: true,
      headerControl: () => (
        <Select value={taxRank} onValueChange={(v) => setTaxRank(v as TaxRank)}>
          <SelectTrigger className="h-6 w-auto min-w-16 px-1.5 text-[11px]" aria-label="Taxonomic rank">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="auto">Auto</SelectItem>
            {TAX_RANKS.map(({ rank }) => (
              <SelectItem key={rank} value={rank}>{rank[0].toUpperCase() + rank.slice(1)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      ),
      renderCell: (h) => {
        const tax = resolveTax(h, taxRank);
        if (!tax.name) return dash;
        // Keyed on the row's phylum whatever rank is displayed, as in the BGC table.
        const style = getTaxonomyBadgeStyle(taxRank, String(h.tax_phylum ?? ''), String(h.tax_domain ?? ''));
        const lineage = taxLineage(h);
        return (
          <Tooltip>
            <TooltipTrigger asChild>
              <Badge variant={style ? 'secondary' : 'outline'} style={style}
                className={cn('h-auto max-w-full whitespace-normal text-[11px]', tax.italic && 'italic')}>
                {tax.name}
              </Badge>
            </TooltipTrigger>
            <TooltipContent className="max-w-[440px]">
              <p className="text-xs leading-relaxed">{lineage.join(' › ') || tax.name}</p>
            </TooltipContent>
          </Tooltip>
        );
      },
    },
    {
      id: 'sample_name',
      label: 'Sample',
      width: 140,
      minWidth: 100,
      sortable: true,
      renderCell: (h) => {
        const id = h.sample_id ? String(h.sample_id) : '';
        const name = h.sample_name ? String(h.sample_name) : '';
        return id ? (
          <Link href={`/samples/${id}`} target="_blank" rel="noopener noreferrer" title={name}
            className={cn('block truncate text-xs', linkClass)}>
            {name || id.slice(0, 8)}
          </Link>
        ) : dash;
      },
    },
    {
      id: 'sample_type',
      label: 'Sample type',
      width: 135,
      minWidth: 90,
      sortable: true,
      renderCell: (h) => (h.sample_type ? <span className="text-xs text-muted-foreground">{String(h.sample_type)}</span> : dash),
    },
    {
      id: 'gold_ecosystem',
      label: 'GOLD ecosystem',
      width: 170,
      minWidth: 130,
      sortable: true,
      renderCell: (h) => {
        const gold = h.gold_ecosystem ? String(h.gold_ecosystem) : '';
        return gold ? (
          <Badge variant="secondary" title={gold}
            className={cn('h-auto max-w-full whitespace-normal text-[10px]', getGOLDBadgeClass(gold))}>
            {formatGOLDBreadcrumb(gold)}
          </Badge>
        ) : dash;
      },
    },
    {
      id: 'gcf_id',
      label: 'GCF',
      width: 110,
      minWidth: 90,
      sortable: true,
      renderCell: (h) => {
        const id = h.gcf_id ? String(h.gcf_id) : '';
        const name = h.gcf_name ? String(h.gcf_name) : '';
        return id ? (
          <Link href={`/gcfs/${id}`} target="_blank" rel="noopener noreferrer" title={name || id}
            className={cn('block truncate whitespace-nowrap font-mono text-xs', linkClass)}>
            {name || id.slice(0, 8)}
          </Link>
        ) : dash;
      },
    },
    {
      id: 'contig',
      label: 'Contig',
      width: 180,
      minWidth: 100,
      visible: false,
      renderCell: (h) => (h.contig
        ? <span className="block truncate font-mono text-xs" title={String(h.contig)}>{String(h.contig)}</span>
        : dash),
    },
    {
      id: 'num_cds_features',
      label: 'Genes',
      width: 80,
      minWidth: 70,
      sortable: true,
      defaultSortDirection: 'desc',
      visible: false,
      className: 'text-right',
      renderCell: (h) => (h.num_cds_features != null
        ? <span className="font-mono text-xs tabular-nums">{Number(h.num_cds_features).toLocaleString()}</span>
        : dash),
    },
    {
      id: 'knowncluster_top_compound',
      label: 'Top MIBiG hit',
      width: 200,
      minWidth: 120,
      sortable: true,
      visible: false,
      headerTooltip: 'Best KnownClusterBLAST hit against MIBiG, with its similarity.',
      renderCell: (h) => {
        const similarity = Number(h.knowncluster_top_similarity ?? 0);
        return (
          <KnownClusterCell
            compound={h.knowncluster_top_compound ? String(h.knowncluster_top_compound) : null}
            accession={h.knowncluster_top ? String(h.knowncluster_top) : null}
            similarity={similarity}
            weak={similarity < KNOWNCLUSTER_MIN_SIMILARITY}
          />
        );
      },
    },
    {
      id: 'data_source',
      label: 'Data source',
      width: 140,
      minWidth: 100,
      sortable: true,
      visible: false,
      renderCell: (h) => (h.data_source ? <span className="text-xs">{String(h.data_source)}</span> : dash),
    },
    {
      id: 'latitude',
      label: 'Latitude',
      width: 90,
      minWidth: 80,
      sortable: true,
      visible: false,
      className: 'text-right',
      renderCell: (h) => (h.latitude != null
        ? <span className="font-mono text-xs tabular-nums">{Number(h.latitude).toFixed(2)}</span>
        : dash),
    },
    {
      id: 'longitude',
      label: 'Longitude',
      width: 90,
      minWidth: 80,
      sortable: true,
      visible: false,
      className: 'text-right',
      renderCell: (h) => (h.longitude != null
        ? <span className="font-mono text-xs tabular-nums">{Number(h.longitude).toFixed(2)}</span>
        : dash),
    },
  ];
}
