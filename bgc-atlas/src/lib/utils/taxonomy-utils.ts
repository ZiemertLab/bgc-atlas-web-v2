import { TaxonomyRank, TaxonomyDistributionData, type TaxonomyLineage } from '@/lib/types';

export function getTaxonDisplayName(taxon: string | null | undefined): string {
  if (!taxon) return 'Unknown';
  return taxon.replace(/^[dpcofgs]__/, '') || 'Unknown';
}

export function formatTaxonomyBreadcrumb(lineage: string): string[] {
  if (!lineage || lineage.trim() === '') {
    return ['Unknown'];
  }

  return lineage
    .split(';')
    .map((rank) => getTaxonDisplayName(rank))
    .filter(Boolean);
}

export function aggregateByRank(
  data: TaxonomyDistributionData[],
  rank: TaxonomyRank
): { label: string; count: number; percentage: number }[] {
  const aggregated = new Map<string, { count: number; percentage: number }>();

  for (const item of data) {
    const taxonValue = item[rank];
    if (!taxonValue) continue;

    const displayName = getTaxonDisplayName(taxonValue);
    // Prisma DECIMAL columns can arrive as strings or Decimal objects.
    const count = Number(item.bgcCount) || 0;
    const percentage = Number(item.percentage) || 0;

    if (aggregated.has(displayName)) {
      const existing = aggregated.get(displayName)!;
      existing.count += count;
      existing.percentage += percentage;
    } else {
      aggregated.set(displayName, { count, percentage });
    }
  }

  return Array.from(aggregated.entries())
    .map(([label, data]) => ({
      label,
      count: data.count,
      percentage: data.percentage,
    }))
    .sort((a, b) => b.count - a.count);
}

const LINEAGE_RANKS: TaxonomyRank[] = ['domain', 'phylum', 'class', 'order', 'family', 'genus', 'species'];

const RANK_PLURAL: Record<TaxonomyRank, string> = {
  domain: 'domains', phylum: 'phyla', class: 'classes', order: 'orders',
  family: 'families', genus: 'genera', species: 'species',
};

export interface RankBar {
  label: string;
  count: number;
  /** Of the family's members with a taxonomy. */
  percentage: number;
  /** The one bar that holds every taxon past the top ones. */
  other?: boolean;
}

/**
 * The bar chart for one rank, from every lineage of the family: its top taxa, and
 * one "Other (N phyla)" bar holding the rest, so the bars always add up to every
 * member with that rank assigned. Taxa are grouped by display name, as
 * aggregateByRank groups them.
 */
export function rankBarsFromLineages(
  lineages: TaxonomyLineage[],
  rank: TaxonomyRank,
  totalWithTaxonomy: number,
  top = 15,
): RankBar[] {
  const index = LINEAGE_RANKS.indexOf(rank);
  const counts = new Map<string, number>();
  for (const lineage of lineages) {
    const value = lineage[index] as string | null;
    if (!value) continue;
    const label = getTaxonDisplayName(value);
    counts.set(label, (counts.get(label) ?? 0) + (Number(lineage[7]) || 0));
  }
  const pct = (count: number) => (totalWithTaxonomy > 0 ? (count / totalWithTaxonomy) * 100 : 0);
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const bars: RankBar[] = sorted.slice(0, top).map(([label, count]) => ({ label, count, percentage: pct(count) }));
  const rest = sorted.slice(top);
  if (rest.length > 0) {
    const count = rest.reduce((sum, [, n]) => sum + n, 0);
    bars.push({ label: `Other (${rest.length.toLocaleString()} ${RANK_PLURAL[rank]})`, count, percentage: pct(count), other: true });
  }
  return bars;
}

/** Sunburst rows from every lineage: each lineage's ranks up to its first gap. */
export function lineageSunburstRows(lineages: TaxonomyLineage[]): { segments: string[]; value: number }[] {
  const rows: { segments: string[]; value: number }[] = [];
  for (const lineage of lineages) {
    const segments: string[] = [];
    for (let i = 0; i < LINEAGE_RANKS.length; i++) {
      const clean = lineage[i] ? String(lineage[i]).replace(/^[dpcofgs]__/, '').trim() : '';
      if (!clean) break;
      segments.push(clean);
    }
    if (segments.length > 0) rows.push({ segments, value: Number(lineage[7]) || 0 });
  }
  return rows;
}

export function truncateTaxonName(name: string, maxLength: number = 30): string {
  if (!name || name.length <= maxLength) return name;

  return name.substring(0, maxLength - 3) + '...';
}
