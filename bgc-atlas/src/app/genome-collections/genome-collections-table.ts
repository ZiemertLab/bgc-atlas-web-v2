import {
  buildDataSourceUrl,
  buildGtdbGenomeUrl,
  extractGtdbAssemblyId,
} from '@/lib/utils/data-source-links';

export const getGenomeCollectionsDefaultColumnVisibility = () => ({
  id: true,
  // Every genome is one assembly (750,901 of 750,901), so the column only ever said
  // "1"; the Genome ID button opens the same details. Opt in from Columns.
  assemblies: false,
  bgcs: true,
  completeness: true,
  contamination: true,
  // Redundant with the two coloured figures beside it; opt in to filter by label.
  genomeQuality: false,
  taxonomy: true,
  goldEcosystem: true,
  biome: false,
  study: false,
  genomeType: true,
  dataSource: true,
});

type BuildGenomeCollectionDataSourceHrefParams = {
  sourceName: string;
  sampleExternalId: string | null | undefined;
  gtdbAccession: string | null | undefined;
  sourceUrl?: string | null | undefined;
};

export function buildGenomeCollectionDataSourceHref({
  sourceName,
  sampleExternalId,
  gtdbAccession,
  sourceUrl,
}: BuildGenomeCollectionDataSourceHrefParams): string | null {
  if (sourceName.toLowerCase().includes('gtdb')) {
    const assemblyId = extractGtdbAssemblyId(gtdbAccession);
    return assemblyId ? buildGtdbGenomeUrl(assemblyId) : (sourceUrl?.trim() || null);
  }

  return buildDataSourceUrl(sourceName, sampleExternalId ?? null) ?? (sourceUrl?.trim() || null);
}
