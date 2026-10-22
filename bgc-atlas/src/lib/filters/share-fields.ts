// The two family filters that ask "how much of this family is X", and the one
// place their meaning is decided for BOTH backends.
//
//   Product          (productShare)        share of the family's primary members
//                                          carrying an antiSMASH product type
//   Ecosystem share  (ecoShareL1..L5)      share of the members WITH an ecosystem
//                                          at GOLD level n that have this one
//
// A condition is an ordinary FilterCondition: the value is the product type (or
// ecosystem) and the operator is equals / not_equals / in / not_in, so the filter
// builder, the serializer and the URL mirror need nothing new. The threshold
// rides beside them as `condition.threshold` (percent of members). Level is in
// the field id because each level has its own vocabulary and its own columns.
//
// Thresholds are the ones with precomputed arrays: 10/50/90 read
// `product_types_ge<T>` / `eco_l<n>_ge<T>`, which hold exactly the values whose
// 2-dp share is >= T, on the index AND in gcf_distributions_mv. Threshold 0 is
// "any member": product_terms on the index, the keys of
// product_type_member_share in SQL (verified equal, 2026-10-22: lassopeptide
// 12,547 / NRPS 68,163 / lanthipeptide-class-i 4,337 / RCDPS 1 on both).
//
// Ecosystem threshold 0 is "any member at level n has it":
// eco_l<n>_any on the index, the keys of biome_distribution_l<n> in SQL -- the
// same set, since the index lists are those keys (gcf_share_fields_any_map.sql;
// a key exists iff >= 1 resolved member has it). An index without the lists
// does not serve it; see lib/opensearch/gcf-browse-fields.ts.
//
// `in` means ANY listed value reaches the threshold on its own, not that their
// shares add up to it: lanthipeptide-class-i at 30 % and -ii at 30 % is not a
// match for "is any of [i, ii] >= 50 %". A negative is the complement among the
// families the share is defined for: products -- every family with a product;
// ecosystems -- families with at least one member resolved at that level
// (resolved_pct_l<n> > 0), because a share "of members with an L3 ecosystem" has
// no value for a family with none.
//
// Client-safe: no Prisma here. The SQL half is lib/gcf/share-filter-sql.ts.
import type { FilterCondition, FilterOperator, UnhonouredCondition } from '@/lib/filters/types';

export const PRODUCT_SHARE_FIELD = 'productShare';

export const ECO_SHARE_LEVELS = [1, 2, 3, 4, 5] as const;
export type EcoShareLevel = typeof ECO_SHARE_LEVELS[number];

export const ecoShareFieldId = (level: EcoShareLevel) => `ecoShareL${level}`;

export const DEFAULT_SHARE_THRESHOLD = 50;
export const PRODUCT_SHARE_THRESHOLDS: readonly number[] = [0, 10, 50, 90];
export const ECO_SHARE_THRESHOLDS: readonly number[] = [0, 10, 50, 90];

export const SHARE_OPERATORS: FilterOperator[] = ['equals', 'not_equals', 'in', 'not_in'];

/** facet-values keys for the builder's value picker (lib/opensearch/client.ts). */
export const PRODUCT_TYPE_VOCAB = 'gcf_product_type';
export const ecoVocabField = (level: EcoShareLevel) => `gcf_ecosystem_l${level}`;

export type ShareSpec =
  | { kind: 'product' }
  | { kind: 'ecosystem'; level: EcoShareLevel };

const ECO_FIELD = /^ecoShareL([1-5])$/;

export const shareSpecForField = (fieldId: string): ShareSpec | null => {
  if (fieldId === PRODUCT_SHARE_FIELD) return { kind: 'product' };
  const match = ECO_FIELD.exec(fieldId);
  return match ? { kind: 'ecosystem', level: Number(match[1]) as EcoShareLevel } : null;
};

export const isShareField = (fieldId: string) => shareSpecForField(fieldId) !== null;

export const shareThresholds = (spec: ShareSpec): readonly number[] =>
  spec.kind === 'product' ? PRODUCT_SHARE_THRESHOLDS : ECO_SHARE_THRESHOLDS;

/** The threshold a condition asks for; a missing one is the default (50 %). */
export const conditionThreshold = (condition: Pick<FilterCondition, 'threshold'>): number =>
  condition.threshold ?? DEFAULT_SHARE_THRESHOLD;

/** "≥ 50 % of members" / "any member" / "≥ 50 % of members with an L3 ecosystem". */
export const formatShareThreshold = (spec: ShareSpec, threshold: number): string => {
  if (threshold === 0) return 'any member';
  if (spec.kind === 'product') return `≥ ${threshold} % of members`;
  return `≥ ${threshold} % of members with an L${spec.level} ecosystem`;
};

/**
 * The refusal for a share condition whose threshold this field does not offer
 * (e.g. 25), or null. Both backends report it in this
 * one shape, ahead of the value, so the reader is sent to the threshold control
 * rather than to a value that is fine.
 */
export const shareThresholdRefusal = (condition: FilterCondition): UnhonouredCondition | null => {
  const spec = shareSpecForField(condition.field);
  if (!spec) return null;
  const threshold = Number(conditionThreshold(condition));
  const offered = shareThresholds(spec);
  if (offered.includes(threshold)) return null;
  return {
    field: condition.field,
    operator: condition.operator,
    reason: 'unsupported_threshold',
    value: condition.value,
    threshold: Number.isFinite(threshold) ? threshold : undefined,
    supportedThresholds: [...offered],
  };
};

/** "≥ 25 % is not offered; choose 10, 50 or 90 %". */
export const describeThresholdRefusal = (field: string, threshold: number | undefined, offered: number[]): string => {
  const asked = threshold === undefined ? 'that threshold' : threshold === 0 ? 'any member (0 %)' : `≥ ${threshold} %`;
  const choices = offered.map((t) => (t === 0 ? '0 (any member)' : String(t)));
  const list = choices.length > 1 ? `${choices.slice(0, -1).join(', ')} or ${choices.at(-1)}` : choices.join('');
  return `field "${field}": ${asked} is not offered; choose ${list} %`;
};

/** A share condition, resolved: what to match, where, and whether negated. */
export interface ShareQuery {
  spec: ShareSpec;
  threshold: number;
  values: string[];
  negated: boolean;
  /** The array field / column holding the values that reach the threshold.
   *  The SAME name on gcf_browse and gcf_distributions_mv, except threshold 0,
   *  which the index holds as product_terms / eco_l<n>_any and SQL as the keys
   *  of product_type_member_share / biome_distribution_l<n>. */
  column: string;
}

const valuesOf = (condition: FilterCondition): string[] => {
  const raw = Array.isArray(condition.value) ? condition.value : [condition.value];
  const values = raw
    .map((entry) => (entry === null || entry === undefined ? '' : String(entry).trim()))
    .filter(Boolean);
  // equals / not_equals take one value, as every other field's does.
  const single = condition.operator === 'equals' || condition.operator === 'not_equals';
  return [...new Set(single ? values.slice(0, 1) : values)];
};

/**
 * The share condition as a query, or null when it cannot be honoured: not a share
 * field, an operator outside SHARE_OPERATORS, a threshold this field does not
 * offer (e.g. 25), or no value. Both backends call
 * this, so they refuse the same conditions.
 */
export const resolveShareCondition = (condition: FilterCondition): ShareQuery | null => {
  const spec = shareSpecForField(condition.field);
  if (!spec || !SHARE_OPERATORS.includes(condition.operator)) return null;
  const threshold = Number(conditionThreshold(condition));
  if (!shareThresholds(spec).includes(threshold)) return null;
  const values = valuesOf(condition);
  if (!values.length) return null;
  const column = spec.kind === 'product'
    ? (threshold === 0 ? 'product_terms' : `product_types_ge${threshold}`)
    : (threshold === 0 ? `eco_l${spec.level}_any` : `eco_l${spec.level}_ge${threshold}`);
  return {
    spec,
    threshold,
    values,
    negated: condition.operator === 'not_equals' || condition.operator === 'not_in',
    column,
  };
};

/**
 * The OpenSearch clause for a resolved share condition (gcf_browse).
 *
 * Exact, case-sensitive terms: the values come from the index's own vocabulary
 * (the builder's picker, or the legacy expansion), and the SQL side compares
 * them exactly too.
 */
export const shareOsClause = (query: ShareQuery): Record<string, unknown> => {
  const positive = { terms: { [query.column]: query.values } };
  if (!query.negated) return positive;
  const present = query.spec.kind === 'product'
    ? { exists: { field: 'product_terms' } }
    : { range: { [`resolved_pct_l${query.spec.level}`]: { gt: 0 } } };
  return { bool: { must_not: [positive], filter: [present] } };
};
