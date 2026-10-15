// Field catalog for the BGC-property query builder and the OpenSearch adapter.
// Field ids ARE the OpenSearch field names (see facet_index_mapping.json).
// `os` drives lib/opensearch/query.ts; `group` drives UI grouping; `dynamic`
// marks facets whose values come from the /facet-values autocomplete endpoint.
import type { FilterCondition, FilterFieldDefinition, FilterOperator } from '@/lib/filters/types';
import { createFilterCondition } from '@/lib/filters/types';
import { DATA_SOURCE_OPTIONS, DATA_SOURCE_EXPANSION } from './data-sources';
import { TAILORING_OPTIONS, TAILORING_EXPANSION } from './tailoring-enzymes';

const KW_OPS: FilterOperator[] = ['in', 'not_in', 'equals', 'not_equals'];
// Keyword facets that also allow substring matching (sample name + environment text).
const KW_TEXT_OPS: FilterOperator[] = ['in', 'not_in', 'equals', 'not_equals', 'contains', 'not_contains'];
const NUM_OPS: FilterOperator[] = ['equals', 'gt', 'gte', 'lt', 'lte', 'between'];
const TXT_OPS: FilterOperator[] = ['contains', 'starts_with', 'ends_with', 'not_contains'];
const BOOL_OPS: FilterOperator[] = ['equals'];

type Def = Omit<FilterFieldDefinition, 'allowedOperators' | 'defaultOperator'> &
  Partial<Pick<FilterFieldDefinition, 'allowedOperators' | 'defaultOperator'>>;

// keyword facet (multi-value, autocomplete by default)
const kw = (id: string, label: string, group: string, extra: Partial<Def> = {}): Def => ({
  id, label, group, type: 'select', os: 'keyword', dynamic: true,
  allowedOperators: KW_OPS, defaultOperator: 'in', ...extra,
});
// keyword facet with a small static option list
const opt = (id: string, label: string, group: string, values: string[]): Def => ({
  id, label, group, type: 'select', os: 'keyword', dynamic: false,
  options: values.map((v) => ({ label: v, value: v })),
  allowedOperators: KW_OPS, defaultOperator: 'in',
});
const num = (id: string, label: string, group: string): Def => ({
  id, label, group, type: 'number', os: 'number',
  allowedOperators: NUM_OPS, defaultOperator: 'gte',
});
const txt = (id: string, label: string, group: string): Def => ({
  id, label, group, type: 'text', os: 'wildcard',
  allowedOperators: TXT_OPS, defaultOperator: 'contains',
});
const bool = (id: string, label: string, group: string): Def => ({
  id, label, group, type: 'select', os: 'boolean',
  options: [{ label: 'Yes', value: 'true' }, { label: 'No', value: 'false' }],
  allowedOperators: BOOL_OPS, defaultOperator: 'equals',
});

// Old id -> antiSMASH-vocabulary id; saved queries, shared links and API examples carry old ids.
export const LEGACY_FIELD_IDS: Record<string, string> = {
  product_type: 'product',
};

const REGION = 'Region';
const TAX = 'Taxonomy';
const FUNC = 'Functional hits';
const GENES = 'Gene functions';
const NRPS = 'NRPS/PKS';
const TERP = 'Terpene';
const RIPP = 'RiPP';
const COMP = 'Comparative';
const REG = 'Regulation';
const GCF = 'GCF';
const SAMPLE = 'Sample';
const ENV = 'Environment';

const defs: Def[] = [
  opt('product_category', 'Category', REGION,
    ['NRPS', 'PKS', 'RiPP', 'terpene', 'saccharide', 'other']),
  kw('product', 'Product', REGION),
  bool('is_complete', 'Complete (not on contig edge)', REGION),
  num('length', 'Length (bp)', REGION),
  num('num_cds_features', '# Genes', REGION),
  num('num_protoclusters', '# Protoclusters', REGION),
  opt('candidate_kind', 'Candidate-cluster kind', REGION,
    ['single', 'chemical_hybrid', 'interleaved', 'neighbouring']),
  num('gc_content', 'GC content', REGION),
  kw('detection_rules', 'Detection rule', REGION),
  txt('contig', 'Contig', REGION),
  kw('tax_domain', 'Domain', TAX, { allowedOperators: KW_TEXT_OPS }),
  kw('tax_phylum', 'Phylum', TAX, { allowedOperators: KW_TEXT_OPS }),
  kw('tax_class', 'Class', TAX, { allowedOperators: KW_TEXT_OPS }),
  kw('tax_order', 'Order', TAX, { allowedOperators: KW_TEXT_OPS }),
  kw('tax_family', 'Family', TAX, { allowedOperators: KW_TEXT_OPS }),
  kw('tax_genus', 'Genus', TAX, { allowedOperators: KW_TEXT_OPS }),
  kw('tax_species', 'Species', TAX, { allowedOperators: KW_TEXT_OPS }),
  opt('sample_type', 'Sample type', SAMPLE, ['metagenome', 'isolate', 'MAG', 'SAG']),
  kw('sample_name', 'Sample name', SAMPLE, { allowedOperators: KW_TEXT_OPS }),
  // Curated: labels merge/relabel the raw sources; valueMap expands them at query time.
  {
    id: 'data_source', label: 'Data source', group: SAMPLE, type: 'select', os: 'keyword',
    dynamic: false, options: DATA_SOURCE_OPTIONS, valueMap: DATA_SOURCE_EXPANSION,
    allowedOperators: KW_OPS, defaultOperator: 'in',
  },
  kw('biome', 'Biome', ENV, { allowedOperators: KW_TEXT_OPS }),
  kw('env_feature', 'Environment feature', ENV, { allowedOperators: KW_TEXT_OPS }),
  kw('env_material', 'Environment material', ENV, { allowedOperators: KW_TEXT_OPS }),
  kw('env_package', 'Environmental package', ENV, { allowedOperators: KW_TEXT_OPS }),
  kw('host', 'Host organism', ENV, { allowedOperators: KW_TEXT_OPS }),
  kw('geolocation', 'Geolocation', ENV, { allowedOperators: KW_TEXT_OPS }),
  kw('gold_ecosystem', 'GOLD ecosystem', ENV, { allowedOperators: KW_TEXT_OPS, hierarchical: true }),
  num('latitude', 'Latitude', ENV),
  num('longitude', 'Longitude', ENV),
  num('collection_year', 'Collection year', ENV),
  kw('pfam', 'PFAM', FUNC),
  kw('tigrfam', 'TIGRFAM', FUNC),
  kw('smcog', 'smCoG', FUNC),
  kw('go_terms', 'GO term', FUNC),
  kw('antismash_domains', 'antiSMASH domain', FUNC),
  // Domain names (antiSMASH hit descriptions) — searchable by name.
  kw('pfam_desc', 'PFAM domain (name)', FUNC, { allowedOperators: KW_TEXT_OPS }),
  kw('tigrfam_desc', 'TIGRFAM domain (name)', FUNC, { allowedOperators: KW_TEXT_OPS }),
  kw('smcog_desc', 'smCoG (name)', FUNC, { allowedOperators: KW_TEXT_OPS }),
  // Curated: maps enzyme classes onto the pfam facet (queryField).
  {
    id: 'tailoring_class', label: 'Tailoring enzyme class', group: FUNC, type: 'select',
    os: 'keyword', dynamic: false, options: TAILORING_OPTIONS,
    valueMap: TAILORING_EXPANSION, queryField: 'pfam',
    allowedOperators: KW_OPS, defaultOperator: 'in',
  },
  num('tta_codons', '# TTA codons', FUNC),
  // Gene functions (antiSMASH per-gene gene_kind counts)
  num('n_core_biosynthetic', 'Core biosynthetic genes', GENES),
  num('n_additional_biosynthetic', 'Additional biosynthetic genes', GENES),
  num('n_transport', 'Transport genes', GENES),
  num('n_regulatory', 'Regulatory genes', GENES),
  num('n_resistance', 'Resistance genes', GENES),
  kw('substrates', 'A-domain substrate', NRPS),
  kw('monomers', 'Monomer', NRPS),
  // Composite strings ('Condensation_LCL-AMP-binding-PCP', 'DVWHFSLVDK') — exact
  // match alone can't express "any module containing a PCP domain".
  kw('module_signatures', 'Module signature', NRPS, { allowedOperators: KW_TEXT_OPS }),
  num('num_modules', '# Modules', NRPS),
  kw('stachelhaus_codes', 'Stachelhaus code', NRPS, { allowedOperators: KW_TEXT_OPS }),
  kw('at_specificity', 'AT specificity', NRPS),
  kw('kr_stereochemistry', 'KR stereochemistry', NRPS),
  bool('pks_trans_at', 'trans-AT PKS', NRPS),
  txt('predicted_smiles', 'Predicted SMILES', NRPS),
  txt('monomer_consensus', 'Monomer consensus', NRPS),
  kw('pks_t2_class', 'PKS type-II class', NRPS),
  kw('pks_t2_starter', 'PKS type-II starter', NRPS),
  kw('pks_t2_elongation', 'PKS type-II elongation', NRPS),
  kw('terpene_products', 'Terpene product', TERP),
  kw('terpene_domains', 'Terpene domain', TERP),
  kw('ripp_class', 'RiPP class', RIPP),
  kw('ripp_subclass', 'RiPP subclass', RIPP),
  txt('core_seq', 'Core peptide', RIPP),
  txt('leader_seq', 'Leader peptide', RIPP),
  num('ripp_mass', 'RiPP monoisotopic mass (Da)', RIPP),
  num('rodeo_score', 'RODEO score', RIPP),
  // Numeric/sequence `detailed_info` keys are typed fields; `ripp_modifications` keeps the categorical ones.
  num('ripp_cut_mass', 'RiPP cut mass (Da)', RIPP),
  num('ripp_cut_weight', 'RiPP cut weight (Da)', RIPP),
  num('ripp_mature_weight', 'RiPP mature weight (Da)', RIPP),
  num('ripp_num_bridges', '# RiPP bridges', RIPP),
  txt('ripp_macrolactam', 'Macrolactam sequence', RIPP),
  kw('ripp_modifications', 'RiPP modification', RIPP),
  kw('comparippson_hits', 'CompaRiPPson hit', RIPP),
  kw('knowncluster_hits', 'KnownClusterBLAST hit (MIBiG)', COMP),
  kw('knowncluster_compounds', 'KCB compound', COMP),
  kw('knowncluster_top_compound', 'Top MIBiG compound', COMP),
  num('knowncluster_top_similarity', 'Top MIBiG similarity (%)', COMP),
  kw('clusterblast_hits', 'ClusterBLAST hit', COMP),
  kw('subcluster_hits', 'SubClusterBLAST hit', COMP),
  num('num_knowncluster_hits', '# KCB hits', COMP),
  kw('mibig_comparison_top', 'ClusterCompare top MIBiG', COMP),
  num('mibig_comparison_top_score', 'ClusterCompare score', COMP),
  kw('tfbs_regulators', 'TFBS regulator', REG),
  kw('gcf_id', 'GCF ID', GCF),
  // BiG-SLiCE membership distance, lower = closer (was gcf_membership).
  num('distance', 'GCF distance (lower = closer)', GCF),
];

export const bgcPropertyFilterFields: FilterFieldDefinition[] = defs.map((d) => ({
  ...d,
  allowedOperators: d.allowedOperators!,
  defaultOperator: d.defaultOperator!,
}));

// Fields the query builder shows live facet-count aggregations for by default.
export const defaultFacetFields = [
  'product_category', 'product', 'is_complete', 'tax_phylum', 'tax_genus',
  'sample_type', 'biome', 'gold_ecosystem',
  'pfam', 'substrates', 'ripp_class', 'knowncluster_compounds',
];

// Fields safe for autocomplete (keyword-backed facets only).
export const keywordFacetFields = bgcPropertyFilterFields
  .filter((f) => f.os === 'keyword')
  .map((f) => f.id);

// Fields safe for terms aggregations (keyword + boolean — both are doc_values-backed).
export const aggregatableFacetFields = bgcPropertyFilterFields
  .filter((f) => f.os === 'keyword' || f.os === 'boolean')
  .map((f) => f.id);

// Plottable: keyword, boolean and numeric fields; free-text `wildcard` fields have no bounded
// value set. Also gates the /aggregate route's field allowlist.
export const plottableFields = bgcPropertyFilterFields
  .filter((f) => f.os === 'keyword' || f.os === 'boolean' || f.os === 'number')
  .map((f) => f.id);

/** Boolean fields answer `equals`/`not_equals` only, never `in`; ask this rather than naming a field. */
export const booleanFacetFields = new Set(
  bgcPropertyFilterFields.filter((f) => f.os === 'boolean').map((f) => f.id),
);

// One function for the chart "+" and the facet click: the operator is a property of the field.
export const facetValueCondition = (field: string, value: string): FilterCondition => (
  booleanFacetFields.has(field)
    ? createFilterCondition(field, 'equals', value === '1' || value === 'true' ? 'true' : 'false')
    : createFilterCondition(field, 'in', [value])
);

/** Human text for a boolean facet value; `is_complete` says what it means, the
 *  rest are Yes/No. Never the raw `1`/`0` the index aggregates to. */
export const booleanFacetLabel = (field: string, value: string): string => {
  const yes = value === '1' || value === 'true';
  if (field === 'is_complete') return yes ? 'Complete' : 'Partial (contig edge)';
  return yes ? 'Yes' : 'No';
};

/** Shared with /api/search/properties/aggregate: an omitted chart renders as an endless spinner. */
export const MAX_DISTRIBUTION_FIELDS = 12;
