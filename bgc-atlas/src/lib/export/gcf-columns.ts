// Client-safe.
import type { GcfListItem } from '@/lib/hooks/use-gcfs';
import type { ExportColumn } from '@/lib/export/format';
import { formatBgcLength } from '@/lib/utils/bgc-length';

const RANKS = ['domain', 'phylum', 'class', 'order', 'family', 'genus', 'species'] as const;
const ECOSYSTEM_LEVELS = [1, 2, 3, 4, 5] as const;

/** Species distributions run to hundreds of names; the cell shows only the largest few. */
const TOP_SHARES = 5;

// Entries that round to 0.0 are dropped. Nothing is renormalised: category shares are of members
// and must not be rescaled to sum to 100.
export function formatShares(
  dist: Record<string, number> | null | undefined,
  { top, label = (k: string) => k }: { top?: number; label?: (key: string) => string } = {},
): string {
  if (!dist) return '';
  const entries = Object.entries(dist)
    .filter(([, v]) => Number.isFinite(v) && v >= 0.05)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  return (top ? entries.slice(0, top) : entries)
    .map(([k, v]) => `${label(k)} ${v.toFixed(1)}%`)
    .join('; ');
}

/** GTDB keys arrive rank-prefixed (`p__Bacillota`); the cells strip that. */
const stripRank = (key: string) => key.replace(/^[a-z]__/, '');

const taxonomyAt = (gcf: GcfListItem, rank: (typeof RANKS)[number]) => {
  const byRank = gcf.taxonomyDistributionByRank ?? {};
  const dist = byRank[rank] ?? (rank === 'domain' ? gcf.taxonomyDistribution : undefined);
  return formatShares(dist, { top: TOP_SHARES, label: stripRank });
};

export const GCF_TABLE_EXPORT_COLUMNS: ExportColumn<GcfListItem>[] = [
  { id: 'id', label: 'GCF ID', value: (g) => g.id },
  { id: 'name', label: 'Name', value: (g) => g.name },
  // The Name cell carries a Fragmented badge; a file has no badge.
  { id: 'familyClass', label: 'Family class', value: (g) => g.familyClass ?? '' },
  { id: 'petName', label: 'Alias', value: (g) => g.petName ?? '' },
  { id: 'memberCount', label: 'Member BGCs', value: (g) => g.memberBgcCount },
  // What the Length cell's '≥' rests on, which its tooltip states and a file cannot.
  { id: 'completeCount', label: 'Complete members', value: (g) => g.completeBgcCount },
  { id: 'assemblyCount', label: 'Assemblies', value: (g) => g.assemblyCount },
  // Carries the '≥' for families with no complete member.
  { id: 'length', label: 'Length', value: (g) => formatBgcLength(g.lengthStats)?.text ?? '' },
  {
    id: 'productCategories',
    label: 'Category distribution (% of members, by exact combination)',
    value: (g) => formatShares(g.productCategoryDistribution),
  },
  {
    id: 'productTypeDistribution',
    // A BGC with several products counts once for each, so these are shares of
    // assignments, not of members (see the column's header tooltip).
    label: 'Product distribution (% of product assignments)',
    value: (g) => formatShares(g.productTypeDistribution),
  },
  ...ECOSYSTEM_LEVELS.map((level) => ({
    id: `biomeDistribution_l${level}`,
    label: `GOLD Ecosystem (L${level})`,
    // Verbatim keys, as BiomeDistributionChart draws them: formatBiomeLabel would
    // merge 'Host-associated' with the synthetic 'Host-assoc.: Plants' bucket.
    value: (g: GcfListItem) => formatShares(g.biomeDistributionByLevel?.[level], { top: TOP_SHARES }),
  })),
  ...RANKS.map((rank) => ({
    id: `taxonomy_${rank}`,
    label: `Taxonomy (${rank})`,
    value: (g: GcfListItem) => taxonomyAt(g, rank),
  })),
  {
    id: 'mibigAnchor',
    label: 'MIBiG relative',
    value: (g) => {
      const compounds = g.mibigCompounds ?? [];
      const accessions = g.mibigAccessions ?? [];
      if (!compounds.length && !accessions.length) return '';
      return accessions.length ? `${compounds.join(', ')} (${accessions.join(', ')})` : compounds.join(', ');
    },
  },
  {
    id: 'knownCluster',
    label: 'KnownClusterBLAST',
    // A family-level hit never travels without the share of members carrying it.
    value: (g) => {
      const hit = g.knownCluster;
      const label = hit?.compound ?? hit?.accession;
      if (!hit || !label) return '';
      const accession = hit.accession && hit.compound ? ` (${hit.accession})` : '';
      return `${label}${accession}, ${hit.similarity}% similarity, ${hit.coverage.toFixed(1)}% of members`;
    },
  },
  {
    id: 'avgScore',
    label: 'Avg Distance',
    value: (g) => (g.avgDistance === null ? '' : g.avgDistance.toFixed(3)),
  },
];
