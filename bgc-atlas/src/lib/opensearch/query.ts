// The OpenSearch adapter for the shared FilterGroup IR, parallel to
// lib/filters/prisma-builders.ts. Pure and dependency-free.
import { LEGACY_FIELD_IDS } from '@/lib/filters/bgc-property-fields';
import type {
  FilterCondition,
  FilterFieldDefinition,
  FilterGroup,
  FilterOperator,
  FilterValue,
  OSFieldKind,
} from '@/lib/filters/types';
import { hasFilterRules, isBlankFilterValue } from '@/lib/filters/types';
import type { UnhonouredSink } from '@/lib/filters/types';

export type OSQuery = Record<string, unknown>;

export interface ResolverOptions {
  /** Render equals/in/not_equals/not_in case-insensitively, to match SQL's ILIKE. Off by
   *  default: Property Search uses exact autocomplete values. */
  caseInsensitive?: boolean;
}

// Defined beside the IR in lib/filters/types.ts; re-exported for existing importers.
export type { UnhonouredReason, UnhonouredCondition, UnhonouredSink } from '@/lib/filters/types';

export type OSConditionResolver = (
  condition: FilterCondition,
  reportUnhonoured?: UnhonouredSink,
) => OSQuery | null;

// Value extraction mirrors prisma-builders, kept local to avoid a Prisma import.
const extractString = (value: FilterValue): string => {
  if (Array.isArray(value)) return value[0] == null ? '' : String(value[0]).trim();
  return value == null ? '' : String(value).trim();
};
const extractMultiple = (value: FilterValue): string[] => {
  const arr = Array.isArray(value) ? value : [value];
  return arr.map((v) => String(v).trim()).filter(Boolean);
};
const extractNumber = (value: FilterValue): number | null => {
  const first = Array.isArray(value) ? value[0] : value;
  return toNum(first);
};
// Number('') is 0, not NaN — so an empty range bound must be treated as absent,
// otherwise a min-only filter becomes {gte, lte: 0} and matches nothing.
const toNum = (v: unknown): number | null => {
  if (v === '' || v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const extractRange = (value: FilterValue): { min: number | null; max: number | null } => {
  if (!Array.isArray(value)) {
    const n = toNum(value);
    return { min: n, max: n };
  }
  return { min: toNum(value[0]), max: toNum(value[1]) };
};

const negate = (clause: OSQuery): OSQuery => ({ bool: { must_not: [clause] } });

// `case_insensitive` on a numerically-mapped field 400s the whole search (a plain string
// term is coerced fine), so numberClause and booleanClause build their own `term`
// literals rather than using this helper.
const term = (field: string, value: string, ci = false): OSQuery =>
  ci
    ? { term: { [field]: { value, case_insensitive: true } } }
    : { term: { [field]: value } };

// `terms` has no case_insensitive flag, so the ci form is a should of single terms,
// capped by max_clause_count (1,024) rather than max_terms_count. Falling back to
// `terms` past that would silently become case-sensitive, so it is not done.
const anyTerm = (field: string, values: string[], ci = false): OSQuery =>
  !ci ? { terms: { [field]: values } }
    : values.length === 1 ? term(field, values[0], true)
    : { bool: { should: values.map((v) => term(field, v, true)), minimum_should_match: 1 } };

const numberClause = (field: string, c: FilterCondition): OSQuery | null => {
  if (c.operator === 'between') {
    const { min, max } = extractRange(c.value);
    if (min === null && max === null) return null;
    const r: Record<string, number> = {};
    if (min !== null) r.gte = min;
    if (max !== null) r.lte = max;
    return { range: { [field]: r } };
  }
  const v = extractNumber(c.value);
  if (v === null) return null;
  switch (c.operator) {
    case 'equals': return { term: { [field]: v } };
    case 'not_equals': return negate({ term: { [field]: v } });
    case 'gt': return { range: { [field]: { gt: v } } };
    case 'gte': return { range: { [field]: { gte: v } } };
    case 'lt': return { range: { [field]: { lt: v } } };
    case 'lte': return { range: { [field]: { lte: v } } };
    default: return null;
  }
};

const wildcard = (field: string, pattern: string): OSQuery => ({
  wildcard: { [field]: { value: pattern, case_insensitive: true } },
});

const textClause = (field: string, c: FilterCondition, ci = false): OSQuery | null => {
  const v = extractString(c.value);
  if (!v) return null;
  switch (c.operator) {
    case 'contains': return wildcard(field, `*${v}*`);
    case 'not_contains': return negate(wildcard(field, `*${v}*`));
    case 'starts_with': return wildcard(field, `${v}*`);
    case 'ends_with': return wildcard(field, `*${v}`);
    case 'equals': return term(field, v, ci);
    case 'not_equals': return negate(term(field, v, ci));
    default: return null;
  }
};

const booleanClause = (field: string, c: FilterCondition): OSQuery | null => {
  const v = extractString(c.value);
  if (!v) return null;
  const b = v === 'true' || v === '1';
  if (c.operator === 'equals') return { term: { [field]: b } };
  if (c.operator === 'not_equals') return negate({ term: { [field]: b } });
  return null;
};

// A hierarchical (colon-delimited) node and its descendants: the exact path or a prefix
// on `v:` (the `:` keeps it on a path boundary). Both halves honour `ci`; without it,
// `in` on a hierarchical field would silently stay case-sensitive.
const subtreeClause = (field: string, v: string, ci = false): OSQuery => ({
  bool: {
    should: [
      term(field, v, ci),
      { prefix: { [field]: { value: `${v}:`, ...(ci && { case_insensitive: true }) } } },
    ],
    minimum_should_match: 1,
  },
});
const subtreeAny = (field: string, vals: string[], ci = false): OSQuery =>
  vals.length === 1
    ? subtreeClause(field, vals[0], ci)
    : { bool: { should: vals.map((v) => subtreeClause(field, v, ci)), minimum_should_match: 1 } };

const keywordClause = (
  field: string, c: FilterCondition, hierarchical = false, ci = false,
): OSQuery | null => {
  // Substring operators: a case-insensitive wildcard over the keyword field.
  if (c.operator === 'contains' || c.operator === 'not_contains'
      || c.operator === 'starts_with' || c.operator === 'ends_with') {
    const v = extractString(c.value);
    if (!v) return null;
    const pattern = c.operator === 'starts_with' ? `${v}*`
      : c.operator === 'ends_with' ? `*${v}` : `*${v}*`;
    return c.operator === 'not_contains' ? negate(wildcard(field, pattern)) : wildcard(field, pattern);
  }
  const vals = extractMultiple(c.value);
  if (!vals.length) return null;
  switch (c.operator) {
    // For a hierarchical field, `in`/`not_in` select a node plus its descendants;
    // `equals`/`not_equals` stay strict exact-path matches (an explicit "this node only").
    case 'in': return hierarchical ? subtreeAny(field, vals, ci) : anyTerm(field, vals, ci);
    case 'not_in': return negate(hierarchical ? subtreeAny(field, vals, ci) : anyTerm(field, vals, ci));
    case 'equals': return term(field, vals[0], ci);
    case 'not_equals': return negate(term(field, vals[0], ci));
    default: return null;
  }
};

/**
 * Operators each OS kind's clause builder handles; must stay in step with the switches
 * (query.test.ts checks both directions). Not `def.allowedOperators`, the narrower UI
 * offering: saved filters may use pairs the UI does not offer.
 */
const OPERATORS_BY_KIND: Record<OSFieldKind, FilterOperator[]> = {
  number: ['equals', 'not_equals', 'gt', 'gte', 'lt', 'lte', 'between'],
  boolean: ['equals', 'not_equals'],
  wildcard: ['contains', 'not_contains', 'starts_with', 'ends_with', 'equals', 'not_equals'],
  keyword: ['in', 'not_in', 'equals', 'not_equals', 'contains', 'not_contains', 'starts_with', 'ends_with'],
};

const kindOf = (def: FilterFieldDefinition): 'keyword' | 'number' | 'boolean' | 'wildcard' => {
  if (def.os) return def.os;
  if (def.type === 'number') return 'number';
  if (def.type === 'text') return 'wildcard';
  return 'keyword';
};

/**
 * Every operator the server can build a clause for on this field, wider than
 * `allowedOperators`; /api/search/properties/fields publishes both. Copied on the way out.
 */
export const honourableOperators = (def: FilterFieldDefinition): FilterOperator[] =>
  [...OPERATORS_BY_KIND[kindOf(def)]];

/** Fields by id and by renamed legacy id, so older saved queries still resolve. */
const indexFields = (fields: FilterFieldDefinition[]) => {
  const byId = new Map(fields.map((f) => [f.id, f]));
  for (const [oldId, newId] of Object.entries(LEGACY_FIELD_IDS)) {
    const def = byId.get(newId);
    if (def && !byId.has(oldId)) byId.set(oldId, def);
  }
  return byId;
};

export const makeResolver = (
  fields: FilterFieldDefinition[],
  options?: ResolverOptions,
): OSConditionResolver => {
  const byId = indexFields(fields);
  const ci = options?.caseInsensitive ?? false;
  return (c, reportUnhonoured) => {
    const def = byId.get(c.field);
    // Checked first, so a condition mid-edit never reports.
    if (isBlankFilterValue(c.value)) return null;
    if (!def) {
      reportUnhonoured?.({
        field: c.field, operator: c.operator, reason: 'unknown_field', value: c.value,
      });
      return null;
    }
    const supportedOperators = OPERATORS_BY_KIND[kindOf(def)];
    if (!supportedOperators.includes(c.operator)) {
      reportUnhonoured?.({
        field: c.field, operator: c.operator, reason: 'unsupported_operator',
        value: c.value, supportedOperators,
      });
      return null;
    }
    const targetField = def.queryField ?? c.field;
    let cond = c;
    if (def.valueMap) {
      // A label may map to several raw values, so equals/not_equals become in/not_in.
      const map = def.valueMap;
      const vals = Array.isArray(c.value) ? c.value : (c.value == null || c.value === '' ? [] : [c.value]);
      const expanded = vals.flatMap((v) => map[String(v)] ?? [String(v)]);
      const operator = c.operator === 'equals' ? 'in' : c.operator === 'not_equals' ? 'not_in' : c.operator;
      cond = { ...c, operator, value: expanded };
    }
    const clause = ((): OSQuery | null => {
      switch (kindOf(def)) {
        case 'number': return numberClause(targetField, cond);
        case 'boolean': return booleanClause(targetField, cond);
        case 'wildcard': return textClause(targetField, cond, ci);
        case 'keyword': return keywordClause(targetField, cond, def.hierarchical, ci);
        default: return null;
      }
    })();
    // Otherwise the value itself could not be used; reported, since dropping it widens the answer.
    if (!clause) {
      reportUnhonoured?.({
        field: c.field, operator: c.operator, reason: 'unusable_value',
        value: c.value, supportedOperators,
      });
    }
    return clause;
  };
};

/**
 * The index fields a FilterGroup queries, deduplicated: the family-scope purity
 * denominator is the members with a value for these. Mirrors makeResolver's mapping.
 */
export const collectQueryFields = (
  group: FilterGroup | null,
  fields: FilterFieldDefinition[],
): string[] => {
  if (!group) return [];
  const byId = indexFields(fields);
  const found = new Set<string>();
  const walk = (node: FilterGroup) => {
    node.conditions.forEach((c) => {
      const def = byId.get(c.field);
      if (def) found.add(def.queryField ?? c.field);
    });
    node.groups.forEach(walk);
  };
  walk(group);
  return [...found].sort();
};

/** Translate a FilterGroup into an OpenSearch query (match_all when empty). Conditions
 *  reported to `reportUnhonoured` are absent from the returned query. */
export const buildOpenSearchQuery = (
  group: FilterGroup | null,
  resolver: OSConditionResolver,
  reportUnhonoured?: UnhonouredSink,
): OSQuery => {
  if (!group || !hasFilterRules(group)) return { match_all: {} };

  const buildGroup = (node: FilterGroup): OSQuery | null => {
    const clauses: OSQuery[] = [];
    node.conditions.forEach((c) => {
      const q = resolver(c, reportUnhonoured);
      if (q) clauses.push(q);
    });
    node.groups.forEach((child) => {
      const q = buildGroup(child);
      if (q) clauses.push(q);
    });
    if (!clauses.length) return null;
    if (clauses.length === 1) return clauses[0];
    return node.operator === 'OR'
      ? { bool: { should: clauses, minimum_should_match: 1 } }
      : { bool: { filter: clauses } };
  };

  return buildGroup(group) ?? { match_all: {} };
};

/** terms aggregations for live facet counts over the matched set. */
export const buildAggregations = (
  fields: string[],
  size = 20,
): Record<string, unknown> => {
  const aggs: Record<string, unknown> = {};
  for (const f of fields) {
    aggs[f] = { terms: { field: f, size } };
  }
  return aggs;
};

// Distribution aggregations cover the whole matched set, not the visible page.

/** A "nice" histogram bin width (1/2/2.5/5 × 10^n) aiming for ~targetBins bins.
 *  Falls back to 1 for a flat or inverted range so a histogram is always valid. */
export const niceInterval = (min: number, max: number, targetBins = 30): number => {
  const span = max - min;
  if (!(span > 0) || !Number.isFinite(span)) return 1;
  const raw = span / targetBins;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag; // in [1, 10)
  const step = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10;
  return step * mag;
};

/** terms agg plus a `<field>__missing` count; `sum_other_doc_count` gives the "+N others" tail. */
export const buildTermsAgg = (field: string, size = 20): Record<string, unknown> => ({
  [field]: { terms: { field, size } },
  [`${field}__missing`]: { missing: { field } },
});

/** stats + p1/p99 + missing count for a numeric field. Percentiles set the histogram
 *  window so outliers cannot flatten the bulk into one bin. */
export const buildStatsAgg = (field: string): Record<string, unknown> => ({
  [`${field}__stats`]: { stats: { field } },
  [`${field}__pct`]: { percentiles: { field, percents: [1, 99] } },
  [`${field}__missing`]: { missing: { field } },
});

/** histogram agg over a [min,max] window. hard_bounds clips outliers OUT of the
 *  bars (they still count toward the total), extended_bounds + min_doc_count:0
 *  fill empty interior bins so the x-axis is continuous. */
export const buildHistogramAgg = (
  field: string, interval: number, min: number, max: number,
): Record<string, unknown> => ({
  [field]: {
    histogram: {
      field, interval, min_doc_count: 0,
      extended_bounds: { min, max },
      hard_bounds: { min, max },
    },
  },
});
