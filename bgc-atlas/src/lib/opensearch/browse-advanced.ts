// Serve a browse page's ?advancedFilters= FilterGroup from the browse indexes
// (bgc_browse / sample_browse / gcf_browse); on Postgres a trivial advanced filter on
// /bgcs can hit the statement timeout. Clauses are built by ./query's makeResolver;
// this module holds the field mapping and the support gate.
//
// Invariant (shared with buildAdvancedWhere): a condition that cannot be honoured
// raises, never drops, and an index that can answer only part of a group refuses the
// whole group. A dropped condition widens the result set at HTTP 200.
import type {
  FilterCondition,
  FilterFieldDefinition,
  FilterGroup,
  FilterOperator,
  FilterValue,
  UnhonouredCondition,
} from '@/lib/filters/types';
import { hasFilterRules, isBlankFilterValue } from '@/lib/filters/types';
import { UnhonourableQueryError } from '@/lib/filters/unhonourable-query';
import type { OSQuery } from './query';
import { buildOpenSearchQuery, honourableOperators, makeResolver } from './query';
// Type-only import, so browse-query.ts can import this module without a cycle.
import type { BrowseEntity } from './browse-query';

/** Local rather than in field-definitions.ts: index field names are a server-side detail. */
type BrowseField = FilterFieldDefinition & {
  /** Several index fields, OR-ed. Mirrors buildMultiColumnTextCondition. */
  queryFields?: string[];
  /** Value translation (keys matched lowercased). A value the map lacks is refused. */
  rewriteValue?: Record<string, string>;
  /** Opt OUT of case-insensitivity, where the SQL form is case-sensitive too. */
  caseSensitive?: boolean;
  /** Target this field, matched exactly, when the value is a UUID (as buildDataSourceCondition). */
  uuidQueryField?: string;
  /** Narrow servable operators where the SQL form answers a narrower question. */
  operators?: FilterOperator[];
  /** SQL negates one element of an array (`EXISTS (... unnest(col) ... NOT ILIKE x)`),
   *  which `must_not` cannot express, so negation stays unservable. */
  elementwiseNegation?: boolean;
  /** Leave the `exists` guard off a negated clause (sourceType only; see there). */
  negationSkipsExists?: boolean;
};

/** Positive operators: each field's SQL form and the index build the same comparison. */
const POSITIVE_OPERATORS: FilterOperator[] = [
  'equals', 'gt', 'gte', 'lt', 'lte', 'between', 'contains', 'starts_with', 'ends_with', 'in',
];

/**
 * The positive clause each negative operator is the `must_not` of. A bare must_not
 * also matches documents missing the field, where SQL's `NOT ILIKE` is NULL and
 * drops the row; negatedClause adds an `exists` filter to close that gap.
 */
const POSITIVE_COUNTERPART: Partial<Record<FilterOperator, FilterOperator>> = {
  not_contains: 'contains',
  not_equals: 'equals',
  not_in: 'in',
};

const NEGATIVE_OPERATORS = Object.keys(POSITIVE_COUNTERPART) as FilterOperator[];

// Same rule browse-query.ts applies to ?dataSource= / ?sampleId=.
const UUID_SHAPED = /^[0-9a-fA-F-]{36}$/;

const kw = (id: string, label: string, queryField?: string): BrowseField => ({
  id, label, type: 'text', os: 'keyword', ...(queryField && { queryField }),
});
const kwAny = (id: string, label: string, queryFields: string[]): BrowseField => ({
  id, label, type: 'text', os: 'keyword', queryFields,
});
const num = (id: string, label: string, queryField: string): BrowseField => ({
  id, label, type: 'number', os: 'number', queryField,
});

/**
 * bgcs -> bgc_browse, mirroring buildBgcAdvancedCondition. `gcf` matches gcf_id or
 * gcf_name, wider than SQL (uuid only) on purpose: the table renders the name.
 */
const BGC_FIELDS: BrowseField[] = [
  kw('id', 'BGC ID', 'bgc_id'),
  kw('assembly', 'Assembly', 'assembly_id'),
  // SQL negates elementwise over the sample relation.
  { ...kw('sampleId', 'Sample ID', 'sample_ids'), elementwiseNegation: true },
  kwAny('gcf', 'GCF', ['gcf_id', 'gcf_name']),
  { ...kw('productCategory', 'Category', 'product_category'), elementwiseNegation: true },
  { ...kw('productType', 'Product', 'product_type'), elementwiseNegation: true },
  {
    id: 'completeness', label: 'Completeness', type: 'select', os: 'boolean',
    queryField: 'is_complete',
    // 'unknown' is not accepted: passed through it would read as `is_complete = false`.
    rewriteValue: { complete: 'true', partial: 'false' },
  },
  kwAny('biome', 'Biome', [
    'resolved_biome_level_1', 'resolved_biome_level_2', 'resolved_biome_level_3',
    'resolved_biome_level_4', 'environment_biome', 'environment_feature',
    'environment_material',
  ]),
  // Single-target, so it can serve a negative. bgc_browse's gold_ecosystem_path comes
  // from the same assembly_samples_mv column SQL compares, so `exists` drops what SQL's join drops.
  kw('goldEcosystem', 'GOLD Ecosystem', 'gold_ecosystem_path'),
  kwAny('taxonomy', 'Taxonomy', [
    'tax_domain', 'tax_phylum', 'tax_class', 'tax_order', 'tax_family',
    'tax_genus', 'tax_species', 'gtdb_lineage',
  ]),
  num('length', 'Length (bp)', 'length'),
  num('genes', '# Genes', 'num_cds_features'),
  num('distance', 'GCF distance', 'distance'),
];

/** samples -> sample_browse, mirroring buildSampleAdvancedCondition. */
const SAMPLE_FIELDS: BrowseField[] = [
  // SQL matches sb.external_id, sb.id::text and sb.name; all three are indexed.
  kwAny('id', 'Sample ID', ['external_id', 'sample_id', 'name']),
  kw('environment', 'Environment', 'environment_biome'),
  kw('biome', 'Biome', 'primary_biome'),
  // Not `hierarchical`: SQL is a plain ILIKE substring match with no subtree semantics.
  kw('goldEcosystem', 'GOLD Ecosystem', 'gold_ecosystem_path'),
  kw('environmentFeature', 'Environment Feature', 'environment_feature'),
  kw('environmentMaterial', 'Environment Material', 'environment_material'),
  {
    ...kw('dataSource', 'Data Source', 'data_source_names'),
    // Mirrors buildDataSourceCondition: a uuid matches data_source_ids exactly,
    // anything else is matched against the names.
    uuidQueryField: 'data_source_ids',
    elementwiseNegation: true,
  },
  { ...kw('study', 'Study', 'study_titles'), elementwiseNegation: true },
  num('assemblies', 'Assemblies', 'assembly_count'),
  num('bgcs', 'BGC Count', 'bgc_count'),
  // COALESCE(..., 0) on both backends, so a sample with no counts row is 0 to both.
  num('gcfCount', 'GCF Count', 'gcf_count'),
  num('clusteredBgcCount', 'Clustered BGCs', 'clustered_bgc_count'),
  num('unclusteredBgcCount', 'Unclustered BGCs', 'unclustered_bgc_count'),
  num('lat', 'Latitude', 'latitude'),
  num('lon', 'Longitude', 'longitude'),
  {
    id: 'sourceType', label: 'Source Type', type: 'select', os: 'keyword',
    queryField: 'source_types',
    // Case-sensitive: SQL is an exact `&&` overlap, so ci would make the index wider.
    caseSensitive: true,
    // `&&` ignores the operator, so only the set operators are served. Negatives are
    // servable: SQL negates the whole array, which is must_not(terms).
    operators: ['equals', 'in', 'not_equals', 'not_in'],
    // No exists guard: SQL COALESCEs to an empty array (never NULL) and returns a
    // sample with none, while OpenSearch reports an empty array as a missing field.
    negationSkipsExists: true,
  },
];

/** gcfs -> gcf_browse, mirroring buildGcfAdvancedCondition in api/gcfs/route.ts. */
const GCF_FIELDS: BrowseField[] = [
  kw('id', 'GCF ID', 'gcf_id'),
  kw('name', 'Name', 'gcf_name'),
  // Not elementwise: SQL reads a negative on these multi-valued fields as "no value
  // matches" (noneOrAny), which is must_not plus the exists guard.
  kw('productType', 'Category', 'product_categories'),
  // Union of gcf_environmental_distribution_mv biome levels 1-3.
  kw('biome', 'Biome', 'biome_terms'),
  // Union of the primary members' bgcs.product elements.
  kw('productClass', 'Product', 'product_terms'),
  // Union of the primary members' seven taxonomy ranks.
  kw('taxonomy', 'Taxonomy', 'taxonomy_terms'),
  num('memberBgcCount', 'Member BGCs', 'member_bgc_count'),
  num('assemblyCount', 'Assemblies', 'assembly_count'),
  num('completeBgcCount', 'Complete BGCs', 'complete_bgc_count'),
  num('taxaCount', 'Distinct taxa', 'unique_taxa_count'),
  num('productCategoryCount', 'Product categories', 'unique_product_categories'),
  num('studyCount', 'Studies', 'study_count'),
  num('ecosystemSpecificity', 'Ecosystem specificity L1 (%)', 'max_pct_l1'),
  num('domEcosystemPct', 'Dominant ecosystem share (%)', 'max_pct_l3'),
  num('domPhylumPct', 'Dominant phylum share (%)', 'dom_phylum_pct'),
  // dom_ecosystem_l3 is copied from the Postgres column, so both backends compare one derivation.
  kw('domEcosystem', 'Dominant ecosystem (L3)', 'dom_ecosystem_l3'),
  kw('domPhylum', 'Dominant phylum', 'dom_phylum'),
  {
    id: 'mibigAnchored', label: 'MIBiG reference', type: 'select', os: 'boolean',
    queryField: 'mibig_anchored',
    // A whitelist as well as a map: `mibigAnchored = yes` is refused, not sent as a dead term.
    rewriteValue: { true: 'true', false: 'false' },
  },
  {
    id: 'familyClass', label: 'Family class', type: 'select', os: 'keyword',
    queryField: 'family_class',
    rewriteValue: { seed: 'seed', fragmented: 'fragmented' },
    // The operators the SQL side and the UI allow.
    operators: ['equals', 'not_equals'],
  },
  num('avgScore', 'Avg Distance (lower = closer)', 'avg_distance'),
  // Not in the UI catalog, but the SQL resolver accepts both spellings, so saved filters may use it.
  num('avgDistance', 'Avg Distance (lower = closer)', 'avg_distance'),
];

const CATALOGS: Record<BrowseEntity, BrowseField[]> = {
  bgcs: BGC_FIELDS,
  samples: SAMPLE_FIELDS,
  gcfs: GCF_FIELDS,
};

/** Exposed for the drift tests, which walk it against the UI catalogs. */
export const browseAdvancedFields = (entity: BrowseEntity): BrowseField[] => CATALOGS[entity];

const INDEXES: Record<BrowseEntity, Map<string, BrowseField>> = {
  bgcs: new Map(BGC_FIELDS.map((f) => [f.id, f])),
  samples: new Map(SAMPLE_FIELDS.map((f) => [f.id, f])),
  gcfs: new Map(GCF_FIELDS.map((f) => [f.id, f])),
};

/**
 * The one index field a negated condition must guard with `exists`, or null when the
 * index cannot answer a negative: with several targets SQL negates as a conjunction
 * over raw columns (NULL in any drops the row), and elementwiseNegation fields ask a
 * different question from must_not. Both fall back to SQL.
 */
const negationTarget = (def: BrowseField): string | null => {
  if (def.elementwiseNegation) return null;
  // A uuid value retargets the clause, so the guarded field depends on the value.
  if (def.uuidQueryField) return null;
  const targets = def.queryFields ?? [def.queryField ?? def.id];
  return targets.length === 1 ? targets[0] : null;
};

/**
 * Operators this field can be served with: positives, negatives only where
 * negationTarget accepts, what the OS kind can build (honourableOperators), and
 * def.operators. Shared by the gate and the builder; if they disagree the
 * aggregation routes answer 502.
 */
export const servableBrowseOperators = (def: BrowseField): FilterOperator[] => {
  const kindOperators = honourableOperators(def);
  const candidates = negationTarget(def)
    ? [...POSITIVE_OPERATORS, ...NEGATIVE_OPERATORS]
    : POSITIVE_OPERATORS;
  return candidates.filter(
    (op) => kindOperators.includes(op) && (!def.operators || def.operators.includes(op)),
  );
};

/**
 * Whether every condition names a field and operator the index can answer. Values are
 * not checked: the builder can still raise `unusable_value`, so callers past this gate
 * must handle UnhonourableQueryError. All-or-nothing; blank-valued conditions are ignored.
 */
export function supportsAdvancedBrowse(entity: BrowseEntity, group: FilterGroup | null): boolean {
  if (!group) return true;
  const byId = INDEXES[entity];

  const servable = (node: FilterGroup): boolean =>
    (node.conditions ?? []).every((condition) => {
      if (isBlankFilterValue(condition.value)) return true;
      const def = byId.get(condition.field);
      if (!def) return false;
      return servableBrowseOperators(def).includes(condition.operator);
    })
    && (node.groups ?? []).every(servable);

  return servable(group);
}

const firstValue = (value: FilterValue): string => {
  const entry = Array.isArray(value) ? value[0] : value;
  return entry == null ? '' : String(entry).trim();
};

/** The index fields to OR over, and the condition to build against each. */
type ConditionPlan = { targets: string[]; condition: FilterCondition };

const planCondition = (def: BrowseField, condition: FilterCondition): ConditionPlan | null => {
  if (def.uuidQueryField && UUID_SHAPED.test(firstValue(condition.value))) {
    // SQL matches a uuid exactly whatever the operator, so force `equals`.
    return { targets: [def.uuidQueryField], condition: { ...condition, operator: 'equals' } };
  }

  const targets = def.queryFields ?? [def.queryField ?? def.id];

  if (def.rewriteValue) {
    const map = def.rewriteValue;
    const raw = Array.isArray(condition.value) ? condition.value : [condition.value];
    const mapped = raw.map((entry) => map[String(entry).trim().toLowerCase()]);
    // A value the map lacks is refused: booleanClause reads anything but "true"/"1" as
    // false, so 'unknown' would become `is_complete: false`. SQL refuses it too.
    if (mapped.some((entry) => entry === undefined)) return null;
    return { targets, condition: { ...condition, value: mapped as string[] } };
  }

  return { targets, condition };
};

/** `must_not` the positive clause, requiring the field to be present (see POSITIVE_COUNTERPART). */
const negatedClause = (def: BrowseField, clause: OSQuery): OSQuery | null => {
  if (def.negationSkipsExists) return { bool: { must_not: [clause] } };
  const field = negationTarget(def);
  // Unreachable; null (an `unusable_value` refusal) rather than a bare, wider must_not.
  if (!field) return null;
  return { bool: { must_not: [clause], filter: [{ exists: { field } }] } };
};

/**
 * The group as one OpenSearch clause, or null when it carries no rules. Throws one
 * UnhonourableQueryError listing every unusable condition. Mirrors buildAdvancedWhere.
 */
export function buildAdvancedBrowseFilter(
  entity: BrowseEntity,
  group: FilterGroup | null,
): OSQuery | null {
  if (!group || !hasFilterRules(group)) return null;

  const byId = INDEXES[entity];
  const unhonoured: UnhonouredCondition[] = [];
  let produced = 0;

  const resolve = (condition: FilterCondition): OSQuery | null => {
    // Checked first, so a condition mid-edit never reports.
    if (isBlankFilterValue(condition.value)) return null;

    const def = byId.get(condition.field);
    if (!def) {
      unhonoured.push({
        field: condition.field, operator: condition.operator,
        reason: 'unknown_field', value: condition.value,
      });
      return null;
    }

    const supportedOperators = servableBrowseOperators(def);
    if (!supportedOperators.includes(condition.operator)) {
      unhonoured.push({
        field: condition.field, operator: condition.operator,
        reason: 'unsupported_operator', value: condition.value, supportedOperators,
      });
      return null;
    }

    const plan = planCondition(def, condition);
    // Negatives are built as the positive counterpart, then wrapped.
    const positive = plan ? POSITIVE_COUNTERPART[plan.condition.operator] : undefined;
    const built = plan
      // One resolver per target field, so case-insensitivity is decided per field.
      ? plan.targets
        .map((target) => makeResolver(
          [{ ...def, id: plan.condition.field, queryField: target }],
          { caseInsensitive: !def.caseSensitive },
        )({ ...plan.condition, ...(positive ? { operator: positive } : {}) }))
        .filter((clause): clause is OSQuery => clause !== null)
      : [];
    const clauses = positive
      ? built.map((clause) => negatedClause(def, clause))
        .filter((clause): clause is OSQuery => clause !== null)
      : built;

    // Otherwise the value itself could not be used (e.g. "abc" on a numeric field).
    if (!clauses.length) {
      unhonoured.push({
        field: condition.field, operator: condition.operator,
        reason: 'unusable_value', value: condition.value, supportedOperators,
      });
      return null;
    }

    produced += 1;
    return clauses.length === 1
      ? clauses[0]
      : { bool: { should: clauses, minimum_should_match: 1 } };
  };

  const query = buildOpenSearchQuery(group, resolve);
  if (unhonoured.length) throw new UnhonourableQueryError(unhonoured);
  // {match_all:{}} is noise in a `filter` array; return no filter instead.
  return produced ? query : null;
}
