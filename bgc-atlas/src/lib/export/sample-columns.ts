// /samples and /genome-collections list from one endpoint but show different columns. Client-safe.
import type { Sample } from '@/lib/types';
import type { ExportColumn } from '@/lib/export/format';
import { formatBiomeLabel } from '@/lib/utils/metadata-parser';
import { formatGOLDBreadcrumb } from '@/lib/utils/gold-parser';
import { formatDataSourceName } from '@/lib/utils/data-source-name';
import { getTaxonDisplayName } from '@/lib/utils/taxonomy-utils';

interface ColumnRef { id: string; label: string }

// A GCF count never leaves without its coverage, so the column exports as three.
export const sampleExportColumns = (visible: ColumnRef[]): ColumnRef[] =>
  visible.flatMap((c) => (
    c.id === 'gcfs'
      ? [
          { id: 'gcfs', label: c.label },
          { id: 'clusteredBgcs', label: 'Clustered BGCs' },
          { id: 'unclusteredBgcs', label: 'Unclustered BGCs' },
        ]
      : [{ id: c.id, label: c.label }]
  ));

const sourceNames = (sample: Sample): string => (
  Array.isArray(sample.dataSourceNames)
    ? sample.dataSourceNames.map(formatDataSourceName).join(', ')
    : (sample.dataSourceNames ? formatDataSourceName(sample.dataSourceNames) : '')
);

// A column id with no case here exports blank; app/samples/sample-export.test.ts catches that.
export const sampleExportValue = (sample: Sample, columnId: string): string | number => {
  switch (columnId) {
    case 'id':
      return sample.externalId || sample.id || '';
    case 'assemblies':
      return typeof sample.assemblyCount === 'number' ? sample.assemblyCount : (sample.assemblyCount ?? 0);
    case 'bgcs':
      return typeof sample.bgcCount === 'number' ? sample.bgcCount : (sample.bgcCount ?? 0);
    // Blank, not 0, where the count is unknown: the cell shows a dash there.
    case 'gcfs':
      return sample.gcfCount ?? '';
    case 'clusteredBgcs':
      return sample.clusteredBgcCount ?? '';
    case 'unclusteredBgcs':
      return sample.unclusteredBgcCount ?? '';
    case 'location':
      return sample.location || '';
    case 'biome': {
      const rawCandidate = typeof sample.primaryBiome === 'string' ? sample.primaryBiome.trim() : '';
      const rawFallback = typeof sample.environmentBiome === 'string' ? sample.environmentBiome.trim() : '';
      const raw = rawCandidate || rawFallback;
      if (!raw || /^root$/i.test(raw)) return '';
      return formatBiomeLabel(raw);
    }
    case 'goldEcosystem':
      return formatGOLDBreadcrumb(sample.goldEcosystemPath);
    case 'environment': {
      const env = typeof sample.environment === 'string' ? sample.environment.trim() : '';
      return env || '';
    }
    case 'material':
      return sample.environmentMaterial || '';
    case 'feature':
      return sample.environmentFeature || '';
    case 'host':
      return sample.hostSpecies || sample.hostTaxid || '';
    case 'study': {
      const titles = Array.isArray(sample.studyTitles) ? sample.studyTitles : [];
      return titles[0] || '';
    }
    case 'dataSource':
      return sourceNames(sample);
    default:
      return '';
  }
};

export const METAGENOME_EXPORT_COLUMNS: ExportColumn<Sample>[] = sampleExportColumns([
  { id: 'id', label: 'Sample ID' },
  { id: 'assemblies', label: 'Assemblies' },
  { id: 'bgcs', label: '# BGCs' },
  { id: 'gcfs', label: '# GCFs' },
  { id: 'location', label: 'Location' },
  { id: 'biome', label: 'Biome' },
  { id: 'goldEcosystem', label: 'GOLD Ecosystem' },
  { id: 'environment', label: 'Environment' },
  { id: 'material', label: 'Material' },
  { id: 'feature', label: 'Feature' },
  { id: 'host', label: 'Host' },
  { id: 'study', label: 'Study' },
  { id: 'dataSource', label: 'Data Source' },
]).map(({ id, label }) => ({ id, label, value: (s: Sample) => sampleExportValue(s, id) }));

const RANKS = ['domain', 'phylum', 'class', 'order', 'family', 'genus', 'species'] as const;
type Rank = (typeof RANKS)[number];

export const genomeExportValue = (
  sample: Sample, columnId: string, { taxonomyRank = 'auto' }: { taxonomyRank?: Rank | 'auto' } = {},
): string | number => {
  switch (columnId) {
    case 'id':
      return sample.externalId || sample.id || '';
    case 'assemblies':
      return typeof sample.assemblyCount === 'number' ? sample.assemblyCount : (sample.assemblyCount ?? 0);
    case 'bgcs':
      return typeof sample.bgcCount === 'number' ? sample.bgcCount : (sample.bgcCount ?? 0);
    case 'goldEcosystem':
      return sample.goldEcosystemPath ? formatGOLDBreadcrumb(sample.goldEcosystemPath, ' › ') : '';
    case 'biome': {
      const rawCandidate = typeof sample.primaryBiome === 'string' ? sample.primaryBiome.trim() : '';
      const rawFallback = typeof sample.environmentBiome === 'string' ? sample.environmentBiome.trim() : '';
      const rawEnv = typeof sample.environment === 'string' ? sample.environment.trim() : '';
      const raw = rawCandidate || rawFallback || rawEnv;
      if (!raw || /^root$/i.test(raw)) return '';
      return formatBiomeLabel(raw);
    }
    case 'study': {
      const titles = Array.isArray(sample.studyTitles) ? sample.studyTitles : [];
      return titles[0] || '';
    }
    case 'dataSource':
      return sourceNames(sample);
    case 'taxonomy': {
      const tax = sample.genomeTaxonomy;
      if (!tax) return '';
      const taxon = taxonomyRank === 'auto'
        ? (tax.species || tax.genus || tax.family || tax.order || tax.class || tax.phylum || tax.domain)
        : tax[taxonomyRank];
      return taxon ? getTaxonDisplayName(taxon) : '';
    }
    case 'genomeType':
      return Array.isArray(sample.sourceTypes) ? sample.sourceTypes.join(', ') : '';
    // Blank where there is no CheckM2 value: the cell shows a dash there.
    case 'completeness':
      return sample.checkmCompleteness ?? '';
    case 'contamination':
      return sample.checkmContamination ?? '';
    case 'genomeQuality':
      return sample.genomeQuality ?? '';
    // What the Data Source badge links to on NCBI; the link itself has no cell text.
    case 'accession':
      return sample.gtdbAccession ?? '';
    default:
      return '';
  }
};

const genomeColumn = (id: string, label: string): ExportColumn<Sample> =>
  ({ id, label, value: (s) => genomeExportValue(s, id) });

// The Taxonomy column shows one rank at a time; the file carries all seven.
export const GENOME_EXPORT_COLUMNS: ExportColumn<Sample>[] = [
  genomeColumn('id', 'Genome ID'),
  genomeColumn('accession', 'NCBI accession'),
  genomeColumn('assemblies', 'Assemblies'),
  genomeColumn('bgcs', '# BGCs'),
  genomeColumn('completeness', 'CheckM2 completeness (%)'),
  genomeColumn('contamination', 'CheckM2 contamination (%)'),
  genomeColumn('genomeQuality', 'MIMAG quality'),
  ...RANKS.map((rank) => ({
    id: `taxonomy_${rank}`,
    label: `Taxonomy (${rank})`,
    value: (s: Sample) => genomeExportValue(s, 'taxonomy', { taxonomyRank: rank }),
  })),
  genomeColumn('goldEcosystem', 'GOLD Ecosystem'),
  genomeColumn('biome', 'Biome'),
  genomeColumn('study', 'Study'),
  genomeColumn('genomeType', 'Type'),
  genomeColumn('dataSource', 'Data Source'),
];
