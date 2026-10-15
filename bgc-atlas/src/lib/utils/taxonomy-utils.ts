import { TaxonomyRank, TaxonomyDistributionData } from '@/lib/types';

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

export function truncateTaxonName(name: string, maxLength: number = 30): string {
  if (!name || name.length <= maxLength) return name;

  return name.substring(0, maxLength - 3) + '...';
}
