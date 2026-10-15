import { Prisma } from '@prisma/client';
import type {
  FilterCondition,
  FilterFieldDefinition,
  FilterGroup,
  FilterValue,
  UnhonouredCondition,
} from '@/lib/filters/types';
import { hasFilterRules, isBlankFilterValue } from '@/lib/filters/types';
import { UnhonourableQueryError } from '@/lib/filters/unhonourable-query';

export type ConditionResolver = (condition: FilterCondition) => Prisma.Sql | null;

// The refusal itself is behavioural (no fragment for a condition with a value); the catalog only
// explains it, since the message is how a broken saved filter gets repaired.
const classify = (
  condition: FilterCondition,
  fields: FilterFieldDefinition[],
): UnhonouredCondition => {
  const def = fields.find((field) => field.id === condition.field);
  if (!def) {
    return {
      field: condition.field, operator: condition.operator,
      reason: 'unknown_field', value: condition.value,
    };
  }
  const supportedOperators = def.allowedOperators ?? [];
  if (supportedOperators.length && !supportedOperators.includes(condition.operator)) {
    return {
      field: condition.field, operator: condition.operator,
      reason: 'unsupported_operator', value: condition.value, supportedOperators,
    };
  }
  return {
    field: condition.field, operator: condition.operator,
    reason: 'unusable_value', value: condition.value, supportedOperators,
  };
};

const wrapFragment = (fragment: Prisma.Sql) => Prisma.sql`(${fragment})`;

/**
 * A condition the resolver cannot turn into SQL is never dropped, since dropping widens the result
 * at HTTP 200; it throws UnhonourableQueryError, which routes turn into a 400. Every shared
 * `advancedFilters` link lands here (the browse index refuses it). `fields` only shapes the
 * message but is required, or every refusal would claim "unknown field". All offending conditions
 * are reported in one error.
 */
export const buildAdvancedWhere = (
  group: FilterGroup | null,
  resolver: ConditionResolver,
  fields: FilterFieldDefinition[]
): Prisma.Sql | null => {
  if (!group || !hasFilterRules(group)) {
    return null;
  }

  const unhonoured: UnhonouredCondition[] = [];

  const buildGroup = (node: FilterGroup): Prisma.Sql | null => {
    const fragments: Prisma.Sql[] = [];

    node.conditions.forEach((condition) => {
      const fragment = resolver(condition);
      if (fragment) {
        fragments.push(fragment);
        return;
      }
      // A valueless condition is the builder's half-built row: a silent drop, not a refusal.
      if (!isBlankFilterValue(condition.value)) {
        unhonoured.push(classify(condition, fields));
      }
    });

    node.groups.forEach((child) => {
      const childFragment = buildGroup(child);
      if (childFragment) {
        fragments.push(childFragment);
      }
    });

    if (!fragments.length) {
      return null;
    }

    // Interpolated with Prisma.raw from an unvalidated client payload, so only the two literals pass.
    const joinOp = Prisma.raw(node.operator === 'OR' ? 'OR' : 'AND');
    return fragments.reduce((acc, fragment, index) => {
      const wrapped = wrapFragment(fragment);
      if (index === 0) {
        return wrapped;
      }
      return Prisma.sql`${acc} ${joinOp} ${wrapped}`;
    }, Prisma.sql`` as Prisma.Sql);
  };

  const where = buildGroup(group);
  if (unhonoured.length) {
    throw new UnhonourableQueryError(unhonoured);
  }
  return where;
};

export type AsyncConditionResolver = (
  condition: FilterCondition
) => Promise<Prisma.Sql | null> | Prisma.Sql | null;

// For resolvers that hit the database (/api/bgcs inlines resolved assemblies; a correlated subquery
// sorts the 16.5M-row corpus). Resolves up front, then runs the sync walker. Keyed on the condition
// object, not condition.id: ids from the unvalidated payload are not guaranteed unique.
export const buildAdvancedWhereAsync = async (
  group: FilterGroup | null,
  resolver: AsyncConditionResolver,
  fields: FilterFieldDefinition[]
): Promise<Prisma.Sql | null> => {
  if (!group || !hasFilterRules(group)) {
    return null;
  }

  const collect = (node: FilterGroup): FilterCondition[] => [
    ...node.conditions,
    ...node.groups.flatMap(collect),
  ];

  const conditions = collect(group);
  const fragments = await Promise.all(conditions.map((condition) => resolver(condition)));
  const resolved = new Map<FilterCondition, Prisma.Sql | null>();
  conditions.forEach((condition, index) => resolved.set(condition, fragments[index]));

  return buildAdvancedWhere(group, (condition) => resolved.get(condition) ?? null, fields);
};

export const extractStringValue = (value: FilterValue): string => {
  if (Array.isArray(value)) {
    const first = value[0];
    return first === undefined || first === null ? '' : String(first).trim();
  }
  if (value === undefined || value === null) return '';
  return String(value).trim();
};

export const extractMultipleValues = (value: FilterValue): string[] => {
  if (Array.isArray(value)) {
    return value.map((entry) => String(entry).trim()).filter(Boolean);
  }
  if (value === undefined || value === null) return [];
  return [String(value).trim()].filter(Boolean);
};

// An empty box is absent, not zero (`Number('')` is 0). Mirrors `toNum` in lib/opensearch/query.ts.
const toNumber = (value: unknown): number | null => {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string' && !value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

export const extractNumberValue = (value: FilterValue): number | null =>
  toNumber(Array.isArray(value) ? value[0] : value);

export const extractNumberRange = (value: FilterValue): { min: number | null; max: number | null } => {
  if (!Array.isArray(value)) {
    const parsed = toNumber(value);
    return { min: parsed, max: parsed };
  }
  return { min: toNumber(value[0]), max: toNumber(value[1]) };
};

const stripLikeBoundaries = (value: string) => value.replace(/^%/, '').replace(/%$/, '');

export const buildTextCondition = (
  column: Prisma.Sql,
  condition: FilterCondition,
  toLike: (value: string) => string
): Prisma.Sql | null => {
  const value = extractStringValue(condition.value);
  if (!value) return null;

  const likeValue = toLike(value);
  const escapedValue = stripLikeBoundaries(likeValue);
  switch (condition.operator) {
    case 'contains':
      return Prisma.sql`${column} ILIKE ${likeValue}`;
    case 'not_contains':
      return Prisma.sql`${column} NOT ILIKE ${likeValue}`;
    case 'starts_with':
      return Prisma.sql`${column} ILIKE ${`${escapedValue}%`}`;
    case 'ends_with':
      return Prisma.sql`${column} ILIKE ${`%${escapedValue}`}`;
    case 'equals':
      return Prisma.sql`${column} ILIKE ${escapedValue}`;
    case 'not_equals':
      return Prisma.sql`${column} NOT ILIKE ${escapedValue}`;
    default:
      return null;
  }
};

export const buildMultiColumnTextCondition = (
  columns: Prisma.Sql[],
  condition: FilterCondition,
  toLike: (value: string) => string
): Prisma.Sql | null => {
  const value = extractStringValue(condition.value);
  if (!value) return null;
  const comparisons = columns
    .map((column) => buildTextCondition(column, condition, toLike))
    .filter((comparison): comparison is Prisma.Sql => comparison !== null);
  if (!comparisons.length) return null;
  const useOr = condition.operator !== 'not_contains' && condition.operator !== 'not_equals';
  return comparisons.reduce((acc, comparison, index) => {
    if (index === 0) {
      return comparison;
    }
    return useOr
      ? Prisma.sql`${acc} OR ${comparison}`
      : Prisma.sql`${acc} AND ${comparison}`;
  }, Prisma.sql`` as Prisma.Sql);
};

export const buildNumberCondition = (
  column: Prisma.Sql,
  condition: FilterCondition,
  options: { scale?: number } = {}
): Prisma.Sql | null => {
  const scale = options.scale ?? 1;
  if (condition.operator === 'between') {
    const { min, max } = extractNumberRange(condition.value);
    if (min === null && max === null) return null;
    if (min !== null && max !== null) {
      return Prisma.sql`${column} BETWEEN ${min / scale} AND ${max / scale}`;
    }
    if (min !== null) {
      return Prisma.sql`${column} >= ${min / scale}`;
    }
    if (max !== null) {
      return Prisma.sql`${column} <= ${max / scale}`;
    }
    return null;
  }

  const value = extractNumberValue(condition.value);
  if (value === null) return null;
  const scaled = value / scale;

  switch (condition.operator) {
    case 'equals':
      return Prisma.sql`${column} = ${scaled}`;
    case 'not_equals':
      return Prisma.sql`${column} <> ${scaled}`;
    case 'gt':
      return Prisma.sql`${column} > ${scaled}`;
    case 'gte':
      return Prisma.sql`${column} >= ${scaled}`;
    case 'lt':
      return Prisma.sql`${column} < ${scaled}`;
    case 'lte':
      return Prisma.sql`${column} <= ${scaled}`;
    default:
      return null;
  }
};

export const buildSelectCondition = (
  column: Prisma.Sql,
  condition: FilterCondition,
  options: { mapValue?: (value: string) => string | null } = {}
): Prisma.Sql | null => {
  const values = extractMultipleValues(condition.value);
  if (!values.length) return null;
  const mappedValues = values
    .map((value) => (options.mapValue ? options.mapValue(value) : value))
    .filter((value): value is string => Boolean(value && String(value).trim().length));
  if (!mappedValues.length) return null;

  if (condition.operator === 'in') {
    return Prisma.sql`${column} = ANY(${mappedValues}::text[])`;
  }
  if (condition.operator === 'not_in') {
    return Prisma.sql`${column} <> ALL(${mappedValues}::text[])`;
  }
  const [value] = mappedValues;
  if (!value) return null;
  if (condition.operator === 'equals') {
    return Prisma.sql`${column} = ${value}`;
  }
  if (condition.operator === 'not_equals') {
    return Prisma.sql`${column} <> ${value}`;
  }
  return null;
};
