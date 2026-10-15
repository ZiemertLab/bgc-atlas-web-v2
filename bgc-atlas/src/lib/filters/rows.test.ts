import { describe, expect, it } from 'vitest';
import { createFilterCondition, type FilterCondition, type FilterGroup } from './types';
import {
  conditionRow, groupRow, groupToRows, pruneRows, rowsHaveRules, rowsToGroup, summarizeRows,
  type FilterRow, type Join,
} from './rows';

const c = (field: string, value: string = 'x'): FilterCondition => createFilterCondition(field, 'in', [value]);
const row = (field: string, join: Join = 'AND') => conditionRow(c(field), join);

/** The tree with ids dropped, as nested arrays: ['AND', 'a', ['OR', 'b', 'c']]. */
type Shape = string | Shape[];
const shape = (g: FilterGroup): Shape => [g.operator, ...g.conditions.map((x) => x.field), ...g.groups.map(shape)];
const text = (rows: FilterRow[]): string => rows.map((r, i) => `${i ? `${r.join} ` : ''}${r.kind === 'condition' ? r.condition.field : `(${text(r.rows)})`}`).join(' ');
const describe_ = (x: FilterCondition) => x.field;
const line = (rows: FilterRow[]) => summarizeRows(rows, describe_)
  .map((l) => `${l.joiner ? `${l.joiner} ` : ''}${l.parts.map((p) => p.value).join(' ')}`);

describe('rowsToGroup', () => {
  it('keeps an all-AND list as one AND group', () => {
    expect(shape(rowsToGroup([row('a'), row('b'), row('c')]))).toEqual(['AND', 'a', 'b', 'c']);
  });

  it('reads AND before OR: a AND b OR c AND d is (a AND b) OR (c AND d)', () => {
    const g = rowsToGroup([row('a'), row('b'), row('c', 'OR'), row('d')]);
    expect(shape(g)).toEqual(['OR', ['AND', 'a', 'b'], ['AND', 'c', 'd']]);
  });

  it('leaves a one-row alternative bare', () => {
    expect(shape(rowsToGroup([row('a'), row('b', 'OR')]))).toEqual(['OR', 'a', 'b']);
  });

  it('turns a bracketed group into a nested group', () => {
    const g = rowsToGroup([row('a'), groupRow([row('b'), row('c', 'OR')])]);
    expect(shape(g)).toEqual(['AND', 'a', ['OR', 'b', 'c']]);
  });

  it('keeps a condition written after a bracket in its place', () => {
    const g = rowsToGroup([row('a'), groupRow([row('b'), row('c', 'OR')]), row('d')]);
    expect(shape(g)).toEqual(['AND', ['AND', 'a'], ['OR', 'b', 'c'], ['AND', 'd']]);
    expect(text(groupToRows(g))).toBe('a AND (b OR c) AND d');
  });

  it('is empty for no rows', () => {
    expect(shape(rowsToGroup([]))).toEqual(['AND']);
  });
});

describe('groupToRows', () => {
  it('reads the polar example as three rows and one bracket', () => {
    const polar: FilterGroup = {
      id: 'r', operator: 'AND', conditions: [c('category'), c('complete'), c('kind')],
      groups: [{ id: 'g', operator: 'OR', conditions: [c('lat_n'), c('lat_s')], groups: [] }],
    };
    expect(text(groupToRows(polar))).toBe('category AND complete AND kind AND (lat_n OR lat_s)');
  });

  it('flattens an OR of AND groups into one list with per-row joins', () => {
    const g: FilterGroup = {
      id: 'r', operator: 'OR', conditions: [],
      groups: [
        { id: '1', operator: 'AND', conditions: [c('a'), c('b')], groups: [] },
        { id: '2', operator: 'AND', conditions: [c('c'), c('d')], groups: [] },
      ],
    };
    expect(text(groupToRows(g))).toBe('a AND b OR c AND d');
  });

  it('flattens same-operator nesting and the single-child wrapper', () => {
    const g: FilterGroup = {
      id: 'r', operator: 'AND', conditions: [],
      groups: [{ id: '1', operator: 'AND', conditions: [c('a'), c('b')], groups: [] }],
    };
    expect(text(groupToRows(g))).toBe('a AND b');
  });

  it('keeps an OR group inside an AND group in brackets', () => {
    const g: FilterGroup = {
      id: 'r', operator: 'AND', conditions: [c('a')],
      groups: [{ id: '1', operator: 'OR', conditions: [c('b'), c('c')], groups: [] }],
    };
    expect(text(groupToRows(g))).toBe('a AND (b OR c)');
  });

  it('returns nothing for null', () => {
    expect(groupToRows(null)).toEqual([]);
  });

  it.each([
    'a AND b AND c',
    'a OR b',
    'a AND b OR c AND d',
    'a AND b OR c',
    'a OR b AND c OR d',
  ])('round-trips %s', (written) => {
    // Build rows from the written text: tokens alternate field, join, field…
    const tokens = written.split(' ');
    const rows = tokens.filter((_, i) => i % 2 === 0)
      .map((field, i) => row(field, i ? tokens[i * 2 - 1] as Join : 'AND'));
    expect(text(groupToRows(rowsToGroup(rows)))).toBe(written);
  });
});

describe('summarizeRows', () => {
  it('is one line per row while everything is ANDed', () => {
    expect(line([row('a'), row('b'), groupRow([row('c'), row('d', 'OR')])]))
      .toEqual(['a', 'AND b', 'AND ( c OR d )']);
  });

  it('is one line per alternative once an OR appears, bracketed', () => {
    expect(line([row('a'), row('b'), row('c', 'OR'), row('d')]))
      .toEqual(['( a AND b )', 'OR ( c AND d )']);
  });

  it('drops blank conditions and empty groups', () => {
    const blank = conditionRow(createFilterCondition('blank', 'in', []));
    expect(line([row('a'), blank, groupRow([conditionRow(createFilterCondition('e', 'in', []))])])).toEqual(['a']);
  });
});

describe('rowsHaveRules / pruneRows', () => {
  it('ignores half-built rows', () => {
    const blank = conditionRow(createFilterCondition('a', 'in', []));
    expect(rowsHaveRules([blank, groupRow([blank])])).toBe(false);
    expect(rowsHaveRules([blank, row('b')])).toBe(true);
    expect(pruneRows([blank, groupRow([blank]), row('b')]).length).toBe(1);
  });
});
