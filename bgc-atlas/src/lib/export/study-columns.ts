// Every /studies column plus the row expander's figures. Client-safe.
import type { Study } from '@/lib/types';
import type { ExportColumn } from '@/lib/export/format';
import { SOURCE_TYPE_LABELS } from '@/lib/utils/chart-utils';
import { formatDataSourceName } from '@/lib/utils/data-source-name';

/** An ecosystem share map as one cell: "Aquatic 62.1%; Terrestrial 37.9%". */
const ecosystemShares = (dist: Record<string, number> | undefined): string => {
  if (!dist) return '';
  return Object.entries(dist)
    .sort(([, a], [, b]) => b - a)
    .map(([name, pct]) => `${name} ${pct.toFixed(1)}%`)
    .join('; ');
};

// Category assignments: a hybrid region counts under each category, so these are counts, never shares.
const categoryAssignments = (counts: Record<string, number> | null): string =>
  Object.entries(counts ?? {})
    .filter(([, n]) => n > 0)
    .sort(([, a], [, b]) => b - a)
    .map(([category, n]) => `${category} ${n}`)
    .join('; ');

/** BGCs per dataset type as one cell: "Metagenome 1200; MAG 340". These partition the BGCs. */
const sourceTypeCounts = (counts: Record<string, number> | null): string =>
  Object.entries(counts ?? {})
    .filter(([, n]) => n > 0)
    .sort(([, a], [, b]) => b - a)
    .map(([type, n]) => `${SOURCE_TYPE_LABELS[type] ?? type} ${n}`)
    .join('; ');

export const STUDY_EXPORT_COLUMNS: ExportColumn<Study>[] = [
  { id: 'study_id', label: 'Study ID', value: (s) => s.study_id },
  { id: 'title', label: 'Title', value: (s) => s.title || s.study_name || s.study_key },
  { id: 'center', label: 'Center', value: (s) => s.center_name ?? '' },
  { id: 'bioproject', label: 'BioProject', value: (s) => s.bioproject ?? '' },
  { id: 'accession', label: 'Accession', value: (s) => s.accession ?? '' },
  { id: 'samples', label: 'Samples', value: (s) => s.sample_count },
  { id: 'genomes', label: 'Genomes (MAG, SAG, isolate)', value: (s) => s.genome_count },
  { id: 'total_bgcs', label: 'BGCs', value: (s) => s.total_bgcs },
  { id: 'complete_bgcs', label: 'Complete BGCs', value: (s) => s.complete_bgcs },
  // GCF counts travel with their coverage.
  { id: 'clustered_bgcs', label: 'Clustered BGCs', value: (s) => s.clustered_bgcs },
  {
    id: 'gcf_coverage',
    label: 'GCF coverage (%)',
    value: (s) => (s.gcf_coverage == null ? '' : (s.gcf_coverage * 100).toFixed(1)),
  },
  { id: 'distinct_gcfs', label: 'GCFs', value: (s) => s.distinct_gcfs },
  { id: 'exclusive_gcfs', label: 'Exclusive GCFs', value: (s) => s.exclusive_gcfs },
  { id: 'rare_gcfs', label: 'Rare GCFs', value: (s) => s.rare_gcfs },
  { id: 'pct_complete', label: '% Complete', value: (s) => (s.pct_complete == null ? '' : s.pct_complete.toFixed(1)) },
  {
    id: 'category_assignments',
    label: 'Composition (category assignments)',
    value: (s) => categoryAssignments(s.product_category_dist),
  },
  { id: 'bgcs_by_dataset_type', label: 'BGCs by assembly type', value: (s) => sourceTypeCounts(s.source_type_dist) },
  { id: 'sources', label: 'Sources', value: (s) => (s.data_sources ?? []).map(formatDataSourceName).join('; ') },
  { id: 'gold_bucket', label: 'Biome', value: (s) => s.gold_bucket ?? '' },
  ...[1, 2, 3].map((level) => ({
    id: `gold_ecosystem_l${level}`,
    label: `GOLD Ecosystem (L${level})`,
    value: (s: Study) => ecosystemShares(s.ecosystem_dist_by_level?.[level]),
  })),
];
