import { describe, it, expect } from 'vitest';
import { Prisma } from '@prisma/client';
import {
  buildAdvancedWhere,
  buildAdvancedWhereAsync,
  buildNumberCondition,
  extractNumberRange,
  extractNumberValue,
} from './prisma-builders';
import { UnhonourableQueryError } from '@/lib/filters/unhonourable-query';
import type { FilterCondition, FilterFieldDefinition, FilterGroup, FilterValue } from './types';

const resolver = (c: FilterCondition) => Prisma.sql`col = ${c.value}`;

describe('buildAdvancedWhere group-operator injection guard', () => {
  it('coerces a malicious group operator to AND (no raw injection)', () => {
    const group = {
      id: 'g',
      operator: 'OR 1=1) --' as unknown as FilterGroup['operator'],
      conditions: [
        { id: '1', field: 'x', operator: 'contains', value: 'a' },
        { id: '2', field: 'x', operator: 'contains', value: 'b' },
      ],
      groups: [],
    } as FilterGroup;
    const sql = buildAdvancedWhere(group, resolver, [])!;
    const text = sql.strings.join('?');
    expect(text).not.toContain('1=1');
    expect(text).toContain(' AND ');
    expect(text).not.toContain('OR');
  });

  it('preserves a legitimate OR operator', () => {
    const group: FilterGroup = {
      id: 'g', operator: 'OR',
      conditions: [
        { id: '1', field: 'x', operator: 'contains', value: 'a' },
        { id: '2', field: 'x', operator: 'contains', value: 'b' },
      ],
      groups: [],
    };
    const text = buildAdvancedWhere(group, resolver, [])!.strings.join('?');
    expect(text).toContain(' OR ');
  });
});

// A condition the SQL fallback cannot honour is refused, not dropped: dropping widens the result.
// Every shared `advancedFilters` link lands on this path, never on the index.
const fields: FilterFieldDefinition[] = [
  { id: 'bgcs', label: 'BGC Count', type: 'number',
    allowedOperators: ['equals', 'gt', 'gte', 'lt', 'lte', 'between'] },
  { id: 'biome', label: 'Biome', type: 'text',
    allowedOperators: ['contains', 'equals'] },
];
const one = (c: Partial<FilterCondition>): FilterGroup => ({
  id: 'g', operator: 'AND', groups: [],
  conditions: [{ id: 'c1', field: 'biome', operator: 'contains', value: 'soil', ...c } as FilterCondition],
});
/** Unknown field or unsupported operator yields no fragment, like the route switches' `default:` arms. */
const honoured = (c: FilterCondition) => {
  const def = fields.find((f) => f.id === c.field);
  if (!def || !def.allowedOperators?.includes(c.operator)) return null;
  return Prisma.sql`col = ${c.value}`;
};

describe('buildAdvancedWhere refuses a condition it cannot honour', () => {
  it('throws rather than widening when the field is unknown', () => {
    expect(() => buildAdvancedWhere(one({ field: 'bioome' }), honoured, fields))
      .toThrow(UnhonourableQueryError);
  });

  it('names the offending field and operator so a saved link can be repaired', () => {
    let message = '';
    try {
      buildAdvancedWhere(one({ field: 'bioome', operator: 'contains', value: 'soil' }), honoured, fields);
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain('bioome');
    expect(message).toContain('broader question');
  });

  it('reports EVERY bad condition at once, not just the first', () => {
    const group: FilterGroup = {
      id: 'g', operator: 'AND',
      conditions: [
        { id: 'a', field: 'bioome', operator: 'contains', value: 'soil' },
        { id: 'b', field: 'biome', operator: 'contains', value: 'soil' },
      ],
      groups: [{
        id: 'g2', operator: 'OR', groups: [],
        conditions: [{ id: 'c', field: 'bgcs', operator: 'ends_with' as FilterCondition['operator'], value: '5' }],
      }],
    };
    let err: UnhonourableQueryError | null = null;
    try { buildAdvancedWhere(group, honoured, fields); } catch (e) { err = e as UnhonourableQueryError; }
    expect(err?.conditions.map((c) => c.field).sort()).toEqual(['bgcs', 'bioome']);
    expect(err?.message).toContain('bioome');
    expect(err?.message).toContain('bgcs');
  });

  it('distinguishes an unsupported operator from an unknown field, and lists what the field takes', () => {
    let err: UnhonourableQueryError | null = null;
    try {
      buildAdvancedWhere(
        one({ field: 'biome', operator: 'between' as FilterCondition['operator'], value: ['a', 'b'] }),
        honoured, fields,
      );
    } catch (e) { err = e as UnhonourableQueryError; }
    expect(err?.conditions[0].reason).toBe('unsupported_operator');
    expect(err?.message).toContain('supported: contains, equals');
  });

  it('calls a resolver refusal on a catalogued field+operator an unusable VALUE', () => {
    // Real field, allowed operator: only the value is unusable.
    const numeric = (c: FilterCondition) =>
      Number.isFinite(Number(c.value)) ? Prisma.sql`n = ${Number(c.value)}` : null;
    let err: UnhonourableQueryError | null = null;
    try {
      buildAdvancedWhere(one({ field: 'bgcs', operator: 'gt', value: 'abc' }), numeric, fields);
    } catch (e) { err = e as UnhonourableQueryError; }
    expect(err?.conditions[0].reason).toBe('unusable_value');
    expect(err?.conditions[0].value).toBe('abc');
  });

  it('still drops a half-built condition with an empty value, silently', () => {
    // The builder emits one of these the moment a user picks a field, before they
    // type anything. Refusing it would make the panel unusable.
    expect(buildAdvancedWhere(one({ field: 'bioome', value: '' }), honoured, fields)).toBeNull();
    expect(buildAdvancedWhere(one({ field: 'bgcs', operator: 'between', value: ['', ''] }), honoured, fields))
      .toBeNull();
  });

  it('drops a half-built condition sitting BESIDE a real one, and answers the real one', () => {
    // The case above cannot observe the exemption: a group with only a blank condition returns
    // null before the walk. Only a group with something to run reaches the branch.
    const group: FilterGroup = {
      id: 'g', operator: 'AND', groups: [],
      conditions: [
        { id: 'blank', field: 'bioome', operator: 'contains', value: '' },
        { id: 'real', field: 'biome', operator: 'contains', value: 'soil' },
      ],
    };
    const sql = buildAdvancedWhere(group, honoured, fields);
    expect(sql).not.toBeNull();
    expect(sql!.strings.join('?')).toContain('col =');
  });

  it('honours a good group unchanged', () => {
    const sql = buildAdvancedWhere(one({}), honoured, fields);
    expect(sql).not.toBeNull();
    expect(sql!.strings.join('?')).toContain('col =');
  });

  it('guards the async entry point the /bgcs route uses, catalog and all', async () => {
    let err: UnhonourableQueryError | null = null;
    try {
      // A catalogued field with a forbidden operator; an unknown field would not test the catalog.
      await buildAdvancedWhereAsync(
        one({ field: 'biome', operator: 'between' as FilterCondition['operator'], value: ['a', 'b'] }),
        async (c) => honoured(c),
        fields,
      );
    } catch (e) { err = e as UnhonourableQueryError; }
    expect(err).toBeInstanceOf(UnhonourableQueryError);
    expect(err?.conditions[0].reason).toBe('unsupported_operator');
    expect(err?.message).toContain('supported: contains, equals');
  });

  it('still calls an uncatalogued field unknown, from the async entry point too', async () => {
    await expect(
      buildAdvancedWhereAsync(one({ field: 'bioome' }), async (c) => honoured(c), fields),
    ).rejects.toThrow(/unknown field "bioome"/);
  });
});

// `Number('')` is 0, so an empty box would run as `= 0` or `BETWEEN 5 AND 0`. The OpenSearch
// adapter treats '' as null too, and the two backends must agree.
describe('an empty numeric value is absent, not zero', () => {
  it('reads an empty string as no value rather than 0', () => {
    expect(extractNumberValue('')).toBeNull();
    expect(extractNumberValue('   ')).toBeNull();
    // FilterValue does not admit these, but the group is JSON.parsed from an
    // unvalidated payload, so they arrive at runtime regardless.
    expect(extractNumberValue(null as unknown as FilterValue)).toBeNull();
    expect(extractNumberValue(undefined as unknown as FilterValue)).toBeNull();
    expect(extractNumberValue(0)).toBe(0);
    expect(extractNumberValue('0')).toBe(0);
  });

  it('treats an empty range bound as absent, so a one-sided range stays one-sided', () => {
    expect(extractNumberRange(['', ''])).toEqual({ min: null, max: null });
    expect(extractNumberRange([5, ''])).toEqual({ min: 5, max: null });
    expect(extractNumberRange(['', 5])).toEqual({ min: null, max: 5 });
    expect(extractNumberRange([0, 0])).toEqual({ min: 0, max: 0 });
  });

  it('builds no fragment for an empty box, instead of `column = 0`', () => {
    const empty: FilterCondition = { id: 'c', field: 'len', operator: 'equals', value: '' };
    expect(buildNumberCondition(Prisma.sql`b.len`, empty)).toBeNull();
    expect(buildNumberCondition(Prisma.sql`b.len`, { ...empty, operator: 'gte' })).toBeNull();
    expect(buildNumberCondition(Prisma.sql`b.len`, { ...empty, operator: 'between', value: ['', ''] }))
      .toBeNull();
  });

  it('builds `>= 5`, not `BETWEEN 5 AND 0`, when only the lower bound is filled', () => {
    const sql = buildNumberCondition(Prisma.sql`b.len`, {
      id: 'c', field: 'len', operator: 'between', value: [5, ''],
    })!;
    expect(sql).not.toBeNull();
    const text = sql.strings.join('?');
    expect(text).toContain('>=');
    expect(text).not.toContain('BETWEEN');
    expect(sql.values).toEqual([5]);
  });

  it('so the empty-value exemption is actually reachable on a numeric field', () => {
    const group: FilterGroup = {
      id: 'g', operator: 'AND', groups: [],
      conditions: [
        { id: 'blank', field: 'bgcs', operator: 'equals', value: '' },
        { id: 'real', field: 'biome', operator: 'contains', value: 'soil' },
      ],
    };
    const numeric = (c: FilterCondition) => c.field === 'bgcs'
      ? buildNumberCondition(Prisma.sql`n`, c)
      : Prisma.sql`col = ${c.value}`;
    const sql = buildAdvancedWhere(group, numeric, fields);
    expect(sql).not.toBeNull();
    expect(sql!.values).toEqual(['soil']);
  });
});
