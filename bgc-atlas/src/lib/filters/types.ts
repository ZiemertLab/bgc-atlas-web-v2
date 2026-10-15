export type FilterFieldType = 'text' | 'number' | 'select';

export type TextOperator = 'contains' | 'not_contains' | 'equals' | 'not_equals' | 'starts_with' | 'ends_with';
export type NumberOperator = 'equals' | 'not_equals' | 'gt' | 'gte' | 'lt' | 'lte' | 'between';
export type SelectOperator = 'equals' | 'not_equals' | 'in' | 'not_in';

export type FilterOperator = TextOperator | NumberOperator | SelectOperator;

export type FilterValue = string | number | (string | number)[];

// How a field maps onto the OpenSearch index (independent of the UI `type`).
export type OSFieldKind = 'keyword' | 'number' | 'boolean' | 'wildcard';

export interface FilterFieldDefinition {
  id: string;
  label: string;
  type: FilterFieldType;
  description?: string;
  placeholder?: string;
  options?: { label: string; value: string }[];
  defaultOperator?: FilterOperator;
  allowedOperators?: FilterOperator[];
  group?: string;
  /** Values come from the facet-values autocomplete endpoint rather than a static list. */
  dynamic?: boolean;
  /** OpenSearch mapping kind; drives the query adapter. Defaults inferred from `type`. */
  os?: OSFieldKind;
  /** Label -> raw index values, so one curated option can match several (e.g. "MGnify"). */
  valueMap?: Record<string, string[]>;
  /** Index field to query instead of `id`, e.g. tailoring enzyme class -> pfam. */
  queryField?: string;
  /** Colon-delimited path field; `in`/`not_in` match the selected node and its subtree. */
  hierarchical?: boolean;
}

export interface FilterCondition {
  id: string;
  field: string;
  operator: FilterOperator;
  value: FilterValue;
}

export type UnhonouredReason = 'unknown_field' | 'unsupported_operator' | 'unusable_value';

/**
 * A condition an adapter could not honour. Shared by the OpenSearch and SQL builders:
 * dropping a condition silently widens the result set, so both report it the same way.
 */
export interface UnhonouredCondition {
  field: string;
  operator: string;
  reason: UnhonouredReason;
  /** The value as sent, echoed back so a stale saved filter can be repaired. */
  value?: FilterValue;
  supportedOperators?: FilterOperator[];
}

export type UnhonouredSink = (unhonoured: UnhonouredCondition) => void;

// Half-built conditions (field picked, no value yet) must stay a silent drop in the
// unhonourable-condition guards, or the panel refuses every query while it is typed.
export const isBlankFilterValue = (value: FilterValue): boolean => {
  const entries = Array.isArray(value) ? value : [value];
  return !entries.some((entry) => entry !== null && entry !== undefined && `${entry}`.trim().length > 0);
};

export interface FilterGroup {
  id: string;
  operator: 'AND' | 'OR';
  conditions: FilterCondition[];
  groups: FilterGroup[];
}

const generateId = () => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return Math.random().toString(36).slice(2);
};

export const createDefaultFilterGroup = (): FilterGroup => ({
  id: generateId(),
  operator: 'AND',
  conditions: [],
  groups: [],
});

export const createFilterCondition = (
  fieldId: string,
  operator: FilterOperator,
  value: FilterValue
): FilterCondition => ({
  id: generateId(),
  field: fieldId,
  operator,
  value,
});

export const createDefaultCondition = (
  field?: FilterFieldDefinition
): FilterCondition => createFilterCondition(
  field?.id ?? '',
  field?.defaultOperator ?? 'equals',
  ''
);

export const encodeBase64 = (value: string) => {
  const scope = globalThis as typeof globalThis & { btoa?: (data: string) => string };
  if (typeof scope.btoa === 'function') {
    return scope.btoa(value);
  }
  return Buffer.from(value, 'utf-8').toString('base64');
};

export const decodeBase64 = (value: string) => {
  const scope = globalThis as typeof globalThis & { atob?: (data: string) => string };
  if (typeof scope.atob === 'function') {
    return scope.atob(value);
  }
  return Buffer.from(value, 'base64').toString('utf-8');
};

export const serializeFilterGroup = (group: FilterGroup | null) => {
  if (!group) return '';
  try {
    return encodeURIComponent(encodeBase64(JSON.stringify(group)));
  } catch {
    return '';
  }
};

export const deserializeFilterGroup = (encoded: string | null): FilterGroup | null => {
  if (!encoded) return null;
  try {
    const json = decodeBase64(decodeURIComponent(encoded));
    const parsed = JSON.parse(json) as FilterGroup;
    return isFilterGroupShape(parsed) ? parsed : null;
  } catch {
    return null;
  }
};

export class MalformedFilterPayloadError extends Error {
  constructor() {
    super(
      'Cannot read the filters in this link: the advancedFilters value is not a'
      + ' filter group. It was probably truncated in transit — try copying the'
      + ' whole URL again, or rebuild the filter in the Advanced panel.'
    );
    this.name = 'MalformedFilterPayloadError';
  }
}

// Client-supplied payload: a missing conditions/groups array would be a TypeError in every walker.
const isFilterGroupShape = (value: unknown): value is FilterGroup => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const node = value as Partial<FilterGroup>;
  if (!Array.isArray(node.conditions) || !Array.isArray(node.groups)) return false;
  return node.groups.every(isFilterGroupShape);
};

// A present-but-unreadable payload throws; returning null would run the query with
// no filter at all (full corpus, HTTP 200).
export const parseAdvancedFilterParam = (encoded: string | null): FilterGroup | null => {
  if (!encoded || !encoded.trim()) return null;
  const group = deserializeFilterGroup(encoded);
  if (!group) throw new MalformedFilterPayloadError();
  return group;
};

// Compact symbols for chips and the Summary; OPERATOR_LABELS (filter-builder/helpers)
// spells operators out for the dropdown.
const OPERATOR_SUMMARY: Record<FilterOperator, string> = {
  equals: '=',
  not_equals: '≠',
  gt: '>',
  gte: '≥',
  lt: '<',
  lte: '≤',
  between: 'between',
  contains: 'contains',
  not_contains: 'does not contain',
  starts_with: 'starts with',
  ends_with: 'ends with',
  in: 'in',
  not_in: 'not in',
};

const summarizeCondition = (label: string, condition: FilterCondition): string => {
  const { operator, value } = condition;

  if (operator === 'between') {
    const [rawMin, rawMax] = Array.isArray(value) ? value : [value, ''];
    const min = `${rawMin ?? ''}`.trim();
    const max = `${rawMax ?? ''}`.trim();
    // buildNumberCondition runs a one-sided range as >= or <=; describe that.
    if (min && max) return `${label} between ${min} and ${max}`;
    if (min) return `${label} ≥ ${min}`;
    if (max) return `${label} ≤ ${max}`;
    return label;
  }

  const rendered = Array.isArray(value) ? value.join(', ') : `${value ?? ''}`;
    // The payload is unvalidated, so an unknown operator is possible at runtime.
  const symbol = OPERATOR_SUMMARY[operator] ?? String(operator).replace(/_/g, ' ');
  return `${label} ${symbol} ${rendered}`.trim();
};

export const summarizeFilterGroup = (
  group: FilterGroup | null,
  fields: FilterFieldDefinition[]
): string[] => {
  if (!group) return [];
  const fieldMap = new Map(fields.map((field) => [field.id, field.label]));

  const summaries: string[] = [];

  const walk = (node: FilterGroup, depth: number) => {
    const prefix = depth > 0 ? `${node.operator} ` : '';
    node.conditions.forEach((condition) => {
      const label = fieldMap.get(condition.field) ?? condition.field;
      summaries.push(`${prefix}${summarizeCondition(label, condition)}`);
    });
    node.groups.forEach((child) => walk(child, depth + 1));
  };

  walk(group, 0);
  return summaries;
};

export type FilterExpressionPart =
  | { kind: 'text'; value: string }
  | { kind: 'op'; value: 'AND' | 'OR' }
  | { kind: 'paren'; value: '(' | ')' };

export interface FilterExpressionLine {
  joiner: 'AND' | 'OR' | null;
  parts: FilterExpressionPart[];
}

/**
 * The filter as the logic that runs, mirroring buildAdvancedWhere: blank conditions
 * and empty groups dropped, a nested group bracketed only with two or more items.
 * Returned as parts so joins can be styled without re-parsing values containing "AND".
 */
export const describeFilterGroup = (
  group: FilterGroup | null,
  fields: FilterFieldDefinition[],
): FilterExpressionLine[] => {
  if (!group) return [];
  const fieldMap = new Map(fields.map((field) => [field.id, field]));

  const conditionText = (condition: FilterCondition): string => {
    const field = fieldMap.get(condition.field);
    // Option labels, not stored values: "Complete = Yes", never "= true".
    const label = (entry: string | number) =>
      field?.options?.find((option) => option.value === `${entry}`)?.label ?? entry;
    const value = Array.isArray(condition.value) ? condition.value.map(label) : label(condition.value);
    return summarizeCondition(field?.label ?? condition.field, { ...condition, value });
  };

  type Item = { parts: FilterExpressionPart[]; size: number };

  const items = (node: FilterGroup): Item[] => [
    ...node.conditions
      .filter((condition) => !isBlankFilterValue(condition.value))
      .map((condition) => ({ parts: [{ kind: 'text' as const, value: conditionText(condition) }], size: 1 })),
    ...node.groups.map(nested).filter((item): item is Item => item !== null),
  ];

  const bracketed = (item: Item): FilterExpressionPart[] => (item.size > 1
    ? [{ kind: 'paren', value: '(' }, ...item.parts, { kind: 'paren', value: ')' }]
    : item.parts);

  function nested(node: FilterGroup): Item | null {
    const children = items(node);
    if (!children.length) return null;
    if (children.length === 1) return children[0];
    const join: FilterExpressionPart = { kind: 'op', value: node.operator === 'OR' ? 'OR' : 'AND' };
    return {
      parts: children.flatMap((child, index) => [
        ...(index ? [join] : []),
        ...bracketed(child),
      ]),
      size: children.length,
    };
  }

  // A root holding nothing but one group (the property search wraps its builder
  // group this way) reads as that group.
  let root = group;
  while (root.groups.length === 1 && !root.conditions.some((c) => !isBlankFilterValue(c.value))) {
    root = root.groups[0];
  }
  const op = root.operator === 'OR' ? 'OR' : 'AND';
  return items(root).map((item, index) => ({
    joiner: index ? op : null,
    parts: bracketed(item),
  }));
};

export const countFilterRules = (group: FilterGroup | null): number => {
  if (!group) return 0;
  return group.conditions.filter((condition) => !isBlankFilterValue(condition.value)).length
    + group.groups.reduce((sum, child) => sum + countFilterRules(child), 0);
};

export const hasFilterRules = (group?: FilterGroup | null): group is FilterGroup => {
  if (!group) return false;
  // Must share isBlankFilterValue with the unhonourable-condition guards so they agree.
  if (group.conditions.some((condition) => !isBlankFilterValue(condition.value))) {
    return true;
  }
  return group.groups.some((child) => hasFilterRules(child));
};

// Cache-key form of a FilterGroup: drops the browser-minted random ids, which the
// server ignores, so identical filters from different sessions share a key.
export type CanonicalFilterGroup = {
  operator: 'AND' | 'OR';
  conditions: Array<{ field: string; operator: string; value: FilterValue }>;
  groups: CanonicalFilterGroup[];
};

// Null exactly when buildAdvancedWhere returns null, so it shares the no-filter key.
// Condition order is preserved, not sorted.
export const canonicalizeFilterGroup = (
  group: FilterGroup | null
): CanonicalFilterGroup | null => {
  if (!group || !hasFilterRules(group)) return null;

  const walk = (node: FilterGroup): CanonicalFilterGroup => ({
    // buildAdvancedWhere runs anything but 'OR' as AND; a junk operator must not mint its own key.
    operator: node.operator === 'OR' ? 'OR' : 'AND',
    conditions: (node.conditions ?? []).map((condition) => ({
      field: condition.field,
      operator: condition.operator,
      value: condition.value,
    })),
    groups: (node.groups ?? []).map(walk),
  });

  return walk(group);
};
