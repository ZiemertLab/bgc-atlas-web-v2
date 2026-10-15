// Both BGC tables (which share no column definitions) and the streamed export read cells through
// this module, so a cell cannot mean two things. Client-safe.
import type { BgcListItem, TaxonomyRank } from '@/components/tables/bgc-table/bgc-table-types';
import type { ExportColumn } from '@/lib/export/format';
import { formatBiomeLabel } from '@/lib/utils/metadata-parser';
import { formatDataSourceName } from '@/lib/utils/data-source-name';
import { formatGOLDBreadcrumb } from '@/lib/utils/gold-parser';
import { getTaxonDisplayName } from '@/lib/utils/taxonomy-utils';

export type ExportableBgc = Pick<BgcListItem,
  | 'id' | 'assembly' | 'assemblyDisplay' | 'sampleIds' | 'sampleLabels' | 'dataSourceNames'
  | 'category' | 'products' | 'completeness' | 'biomeLevels' | 'biomeEnvironment'
  | 'goldEcosystemPath' | 'taxonomyDomain' | 'taxonomyPhylum' | 'taxonomyClass'
  | 'taxonomyOrder' | 'taxonomyFamily' | 'taxonomyGenus' | 'taxonomySpecies'
  | 'length' | 'genes' | 'gcf' | 'gcfName' | 'distance' | 'knownCluster'>;

export interface ExportOptions {
  /** The rank the Taxonomy column is showing; the export follows it. */
  taxonomyRank?: TaxonomyRank;
}

/** The taxon the Taxonomy cell shows at `rank`: the most specific available for
 *  'auto', otherwise that rank or nothing. */
const taxonAtRank = (bgc: ExportableBgc, rank: TaxonomyRank): string | null => {
  if (rank === 'auto') {
    return bgc.taxonomySpecies || bgc.taxonomyGenus || bgc.taxonomyFamily ||
      bgc.taxonomyOrder || bgc.taxonomyClass || bgc.taxonomyPhylum || bgc.taxonomyDomain;
  }
  return {
    domain: bgc.taxonomyDomain,
    phylum: bgc.taxonomyPhylum,
    class: bgc.taxonomyClass,
    order: bgc.taxonomyOrder,
    family: bgc.taxonomyFamily,
    genus: bgc.taxonomyGenus,
    species: bgc.taxonomySpecies,
  }[rank];
};

// A column id with no case here exports blank; bgc-table-utils.test.ts catches that.
export const getExportValue = (
  bgc: ExportableBgc,
  columnId: string,
  { taxonomyRank = 'auto' }: ExportOptions = {},
): string | number => {
  switch (columnId) {
    case 'id':
      return bgc.id || '';
    case 'assembly':
      return bgc.assemblyDisplay || bgc.assembly || '';
    case 'source': {
      const names = Array.isArray(bgc.dataSourceNames) ? bgc.dataSourceNames : [];
      return names.filter((n) => n?.trim()).map(formatDataSourceName).join(', ');
    }
    case 'samples': {
      const labels: string[] = Array.isArray(bgc.sampleLabels) ? bgc.sampleLabels : [];
      const ids: string[] = Array.isArray(bgc.sampleIds) ? bgc.sampleIds : [];
      const arr = labels.length > 0 ? labels : ids;
      return arr.join(', ');
    }
    case 'class':
      return bgc.category || '';
    case 'type': {
      const types: string[] = Array.isArray(bgc.products) ? bgc.products : [];
      return types.join(', ');
    }
    case 'completeness':
      return bgc.completeness || '';
    case 'biome': {
      const levels: string[] = Array.isArray(bgc.biomeLevels)
        ? bgc.biomeLevels.filter((v: string) => Boolean(v && v.trim()))
        : [];
      const environmentFallback: string[] = Array.isArray(bgc.biomeEnvironment)
        ? bgc.biomeEnvironment.filter((v: string) => Boolean(v && v.trim()))
        : [];
      const rawBiome = levels[0] || environmentFallback[0] || '';
      if (!rawBiome) return '';
      return formatBiomeLabel(rawBiome);
    }
    case 'goldEcosystem':
      return formatGOLDBreadcrumb(bgc.goldEcosystemPath);
    case 'taxonomy': {
      const taxon = taxonAtRank(bgc, taxonomyRank);
      return taxon ? getTaxonDisplayName(taxon) : '';
    }
    case 'length':
      return typeof bgc.length === 'number' ? bgc.length : (bgc.length ?? 0);
    case 'genes':
      return typeof bgc.genes === 'number' ? bgc.genes : (bgc.genes ?? 0);
    case 'gcf':
      return bgc.gcfName || bgc.gcf || '';
    case 'knownCluster': {
      // Blank below the 50% cutoff, where the cell shows a dash.
      const hit = bgc.knownCluster;
      const label = hit?.compound ?? hit?.accession;
      if (!hit || !label) return '';
      const accession = hit.accession && hit.compound ? ` (${hit.accession})` : '';
      return `${label}${accession}, ${hit.similarity}%`;
    }
    // Three decimals, as the cell shows it; raw floats export as e.g. `1.49011611938477e-8`.
    case 'distance':
      return typeof bgc.distance === 'number' ? bgc.distance.toFixed(3) : '';
    default:
      return '';
  }
};

const column = (id: string, label: string): ExportColumn<ExportableBgc> =>
  ({ id, label, value: (bgc) => getExportValue(bgc, id) });

const RANKS: Exclude<TaxonomyRank, 'auto'>[] = ['domain', 'phylum', 'class', 'order', 'family', 'genus', 'species'];

// The Taxonomy column shows one rank at a time, chosen in its header; a file carries all seven.
export const BGC_EXPORT_COLUMNS: ExportColumn<ExportableBgc>[] = [
  column('id', 'BGC ID'),
  column('assembly', 'Assembly'),
  column('source', 'Source'),
  column('samples', 'Sample'),
  column('class', 'Category'),
  column('type', 'Product'),
  column('completeness', 'Completeness'),
  column('goldEcosystem', 'GOLD Ecosystem'),
  ...RANKS.map((rank) => ({
    id: `taxonomy_${rank}`,
    label: `Taxonomy (${rank})`,
    value: (bgc: ExportableBgc) => getExportValue(bgc, 'taxonomy', { taxonomyRank: rank }),
  })),
  column('length', 'Length (bp)'),
  column('genes', 'Genes'),
  column('gcf', 'GCF'),
  column('knownCluster', 'KnownClusterBLAST'),
  column('distance', 'GCF Distance'),
];
