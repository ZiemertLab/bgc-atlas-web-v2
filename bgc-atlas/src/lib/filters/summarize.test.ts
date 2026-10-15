import { describe, expect, it } from 'vitest';

import { studyFilterFields } from './field-definitions';
import {
  createDefaultFilterGroup,
  createFilterCondition,
  summarizeFilterGroup,
  type FilterGroup,
  type FilterOperator,
  type FilterValue,
} from './types';

const group = (specs: Array<[string, FilterOperator, FilterValue]>): FilterGroup => ({
  ...createDefaultFilterGroup(),
  conditions: specs.map(([field, operator, value]) => createFilterCondition(field, operator, value)),
});

const summarize = (specs: Array<[string, FilterOperator, FilterValue]>) =>
  summarizeFilterGroup(group(specs), studyFilterFields);

describe('summarizeFilterGroup operator rendering', () => {
  it('uses maths symbols for numeric comparisons', () => {
    expect(summarize([['exclusiveGcfs', 'gte', 100]])).toEqual(['Exclusive GCFs ≥ 100']);
    expect(summarize([['exclusiveGcfs', 'lte', 5]])).toEqual(['Exclusive GCFs ≤ 5']);
    expect(summarize([['exclusiveGcfs', 'gt', 1]])).toEqual(['Exclusive GCFs > 1']);
    expect(summarize([['exclusiveGcfs', 'lt', 9]])).toEqual(['Exclusive GCFs < 9']);
    expect(summarize([['exclusiveGcfs', 'equals', 3]])).toEqual(['Exclusive GCFs = 3']);
    expect(summarize([['exclusiveGcfs', 'not_equals', 3]])).toEqual(['Exclusive GCFs ≠ 3']);
  });

  it('never emits the raw operator id', () => {
    const all: FilterOperator[] = [
      'equals', 'not_equals', 'gt', 'gte', 'lt', 'lte', 'between',
      'contains', 'not_contains', 'starts_with', 'ends_with', 'in', 'not_in',
    ];
    for (const operator of all) {
      const [text] = summarize([['exclusiveGcfs', operator, operator === 'between' ? [1, 2] : 1]]);
      expect(text).not.toMatch(/\b(gte|lte|not_equals|not_contains|starts_with|ends_with|not_in)\b/);
    }
  });

  it('keeps words where no clean symbol exists', () => {
    expect(summarize([['title', 'contains', 'sludge']])).toEqual(['Title contains sludge']);
    expect(summarize([['title', 'not_contains', 'draft']])).toEqual(['Title does not contain draft']);
    expect(summarize([['title', 'starts_with', 'Tara']])).toEqual(['Title starts with Tara']);
    expect(summarize([['productCategory', 'in', ['NRPS', 'PKS']]])).toEqual([
      'Product category in NRPS, PKS',
    ]);
    expect(summarize([['productCategory', 'not_in', ['NRPS']]])).toEqual([
      'Product category not in NRPS',
    ]);
  });

  it('spells out a two-sided range instead of joining the raw array', () => {
    expect(summarize([['totalBgcs', 'between', [1000, 5000]]])).toEqual([
      'Total BGCs between 1000 and 5000',
    ]);
  });

  it('describes a one-sided range the way the SQL builder will run it', () => {
    // buildNumberCondition turns a missing bound into a plain >= / <=.
    expect(summarize([['totalBgcs', 'between', [1000, '']]])).toEqual(['Total BGCs ≥ 1000']);
    expect(summarize([['totalBgcs', 'between', ['', 5000]]])).toEqual(['Total BGCs ≤ 5000']);
  });

  it('prefixes nested groups with their join operator', () => {
    const root = group([['exclusiveGcfs', 'gte', 100]]);
    root.groups = [{ ...group([['title', 'contains', 'soil']]), operator: 'OR' }];
    expect(summarizeFilterGroup(root, studyFilterFields)).toEqual([
      'Exclusive GCFs ≥ 100',
      'OR Title contains soil',
    ]);
  });

  it('falls back to the field id when the field is unknown', () => {
    expect(summarize([['mysteryField', 'gte', 2]])).toEqual(['mysteryField ≥ 2']);
  });
});
