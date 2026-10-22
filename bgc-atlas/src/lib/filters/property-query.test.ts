import { describe, expect, it } from 'vitest';

import { queryOf, setsFromScope } from './property-query';
import { conditionRow, type FilterRow } from './rows';
import { createDefaultFilterGroup, createFilterCondition, hasFilterRules } from './types';

const describe_ = (c: { field: string; value: unknown }) => `${c.field} ${String(c.value)}`;
const row = (field: string, value: string): FilterRow =>
  conditionRow(createFilterCondition(field, 'in', [value] as never), 'AND');
const fieldsOf = (g: ReturnType<typeof queryOf>['group']) =>
  (g?.conditions ?? []).map((c) => c.field).concat((g?.groups ?? []).flatMap((x) => x.conditions.map((c) => c.field)));

describe('queryOf', () => {
  it('is a plain filter on the one set for BGCs', () => {
    const q = queryOf('bgcs', [[row('product', 'lassopeptide')]], [], 1, describe_);
    expect(q.scope).toBeNull();
    expect(fieldsOf(q.group)).toEqual(['product']);
  });

  it('is no filter at all when no set has rules', () => {
    expect(queryOf('gcfs', [[], []], [], 1, describe_)).toEqual({ group: null, scope: null });
  });

  it('uses the second set when it is the only one with rules (Families)', () => {
    // The bug: this read the empty first set, sent group:null, and listed every family.
    const q = queryOf('gcfs', [[], [row('tax_genus', 'g__Streptomyces')]], [], 1, describe_);
    expect(q.scope).toBeNull();
    expect(q.group).not.toBeNull();
    expect(hasFilterRules(q.group!)).toBe(true);
    expect(fieldsOf(q.group)).toEqual(['tax_genus']);
  });

  it('is a family-scope question with two sets that have rules', () => {
    const q = queryOf('gcfs', [[row('latitude', '66.5')], [], [row('latitude', '-66.5')]], ['Arctic'], 1, describe_);
    expect(q.group).toBeNull();
    expect(q.scope?.cohorts).toHaveLength(2);
    // The kept sets' labels: the named one, then one derived from what the set asks.
    expect(q.scope?.labels[0]).toBe('Arctic');
    expect(q.scope?.labels[1]).not.toBe('');
  });
});

describe('setsFromScope', () => {
  it('puts an old link\'s base filter into every member set', () => {
    const base = { ...createDefaultFilterGroup(), conditions: [createFilterCondition('product', 'in', ['NRPS'] as never)] };
    const cohort = { ...createDefaultFilterGroup(), conditions: [createFilterCondition('latitude', 'gt', '66.5' as never)] };
    const sets = setsFromScope(base, { cohorts: [cohort, cohort], labels: [], minPurity: 1 });
    expect(sets).toHaveLength(2);
  });
});
