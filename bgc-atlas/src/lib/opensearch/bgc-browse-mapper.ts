import { stripSourcePrefixes } from '@/lib/utils/sample-id';
import { collapseConsecutiveLevels } from '@/lib/utils/metadata-parser';

type Document = Record<string, unknown>;

const text = (value: unknown): string | null => typeof value === 'string' ? value : null;
const strings = (value: unknown): string[] => Array.isArray(value)
  ? value.filter((item): item is string => typeof item === 'string') : [];
const number = (value: unknown): number | null => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

export function mapBgcBrowseDocument(document: Document) {
  const productCategory = strings(document.product_category);
  const productType = strings(document.product_type);
  const resolvedLevels = collapseConsecutiveLevels([
    text(document.resolved_biome_level_1), text(document.resolved_biome_level_2),
    text(document.resolved_biome_level_3), text(document.resolved_biome_level_4),
  ]);
  const environmentContext = [
    text(document.environment_biome), text(document.environment_feature), text(document.environment_material),
  ].filter((value): value is string => Boolean(value?.trim()));
  const environmentBiome = text(document.environment_biome)?.trim() ?? '';
  const biomeLevels = environmentBiome ? [environmentBiome] : resolvedLevels;
  // Raw BiG-SLiCE membership distance; lower = better.
  const distance = number(document.distance);

  return {
    id: String(document.bgc_id ?? ''),
    assemblyDisplay: text(document.assembly_id),
    assembly: text(document.assembly_id),
    assemblySourceType: text(document.assembly_source_type),
    name: text(document.filename),
    // `category` is the single label the Category column shows: the one category, or
    // 'Hybrid' when a region carries several. `categories` is the raw multi-label array.
    category: productCategory.length > 1 ? 'Hybrid' : productCategory[0] ?? null,
    categories: productCategory,
    products: productType,
    completeness: document.is_complete === true ? 'complete' : 'partial',
    length: number(document.length) ?? 0,
    genes: number(document.num_cds_features),
    gcf: text(document.gcf_id),
    gcfName: text(document.gcf_name),
    distance,
    antismashRunId: text(document.antismash_run_id),
    anchor: text(document.anchor),
    biome: biomeLevels.length ? biomeLevels.join(' > ') : environmentContext[0] ?? 'Unknown',
    biomeLevels,
    biomeEnvironment: environmentContext,
    goldEcosystemPath: text(document.gold_ecosystem_path),
    goldEcosystemMetadata: document.gold_ecosystem_metadata ?? null,
    sampleIds: strings(document.sample_ids),
    sampleLabels: stripSourcePrefixes(strings(document.sample_labels)),
    dataSourceNames: strings(document.data_source_names),
    taxonomyDomain: text(document.tax_domain),
    taxonomyPhylum: text(document.tax_phylum),
    taxonomyClass: text(document.tax_class),
    taxonomyOrder: text(document.tax_order),
    taxonomyFamily: text(document.tax_family),
    taxonomyGenus: text(document.tax_genus),
    taxonomySpecies: text(document.tax_species),
    gtdbLineage: text(document.gtdb_lineage),
  };
}
