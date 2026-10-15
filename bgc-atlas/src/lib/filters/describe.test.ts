import { describe, expect, it } from 'vitest';

import { bgcPropertyFilterFields } from './bgc-property-fields';
import {
  countFilterRules,
  createDefaultFilterGroup,
  createFilterCondition,
  describeFilterGroup,
  type FilterExpressionLine,
  type FilterGroup,
  type FilterOperator,
  type FilterValue,
} from './types';

type Spec = [string, FilterOperator, FilterValue];

const group = (operator: 'AND' | 'OR', specs: Spec[], groups: FilterGroup[] = []): FilterGroup => ({
  ...createDefaultFilterGroup(),
  operator,
  conditions: specs.map(([field, op, value]) => createFilterCondition(field, op, value)),
  groups,
});

/** Lines as plain strings, for readable expectations. */
const render = (lines: FilterExpressionLine[]) => lines.map((line) => [
  line.joiner ?? '',
  line.parts.map((part) => (part.kind === 'op' ? ` ${part.value} ` : part.value)).join(''),
].join(line.joiner ? ' ' : ''));

const describeIt = (g: FilterGroup) => render(describeFilterGroup(g, bgcPropertyFilterFields));

describe('describeFilterGroup', () => {
  it('puts each top-level item on its own line, led by the join', () => {
    const polar = group('OR', [['latitude', 'gt', '66.5'], ['latitude', 'lt', '-66.5']]);
    const root = group('AND', [
      ['product_category', 'in', ['RiPP']],
      ['is_complete', 'equals', 'true'],
      ['candidate_kind', 'in', ['chemical_hybrid']],
    ], [polar]);
    expect(describeIt(root)).toEqual([
      'Category in RiPP',
      'AND Complete (not on contig edge) = Yes',
      'AND Candidate-cluster kind in chemical_hybrid',
      'AND (Latitude > 66.5 OR Latitude < -66.5)',
    ]);
  });

  it('describes an OR of two AND groups', () => {
    const a = group('AND', [['latitude', 'gt', '1'], ['longitude', 'gt', '2']]);
    const b = group('AND', [['latitude', 'lt', '3'], ['longitude', 'lt', '4']]);
    expect(describeIt(group('OR', [], [a, b]))).toEqual([
      '(Latitude > 1 AND Longitude > 2)',
      'OR (Latitude < 3 AND Longitude < 4)',
    ]);
  });

  it('does not bracket a group holding one item, and reads a lone wrapped group as itself', () => {
    expect(describeIt(group('AND', [['longitude', 'gt', '2']], [group('OR', [['latitude', 'gt', '1']])])))
      .toEqual(['Longitude > 2', 'AND Latitude > 1']);
    const only = group('OR', [['latitude', 'gt', '1'], ['latitude', 'lt', '-1']]);
    expect(describeIt(group('AND', [], [only]))).toEqual(['Latitude > 1', 'OR Latitude < -1']);
  });

  it('drops blank conditions and empty groups, as the server does', () => {
    const empty = group('OR', [['latitude', 'gt', '']]);
    const root = group('AND', [['latitude', 'gt', '1'], ['longitude', 'lt', '']], [empty]);
    expect(describeIt(root)).toEqual(['Latitude > 1']);
    expect(countFilterRules(root)).toBe(1);
    expect(describeIt(group('AND', [['latitude', 'gt', '']]))).toEqual([]);
  });

  it('nests brackets for a third-level group from an older link', () => {
    const deep = group('OR', [['latitude', 'gt', '1'], ['latitude', 'lt', '-1']]);
    const mid = group('AND', [['longitude', 'gt', '2']], [deep]);
    const root = group('AND', [['longitude', 'lt', '9']], [mid]);
    expect(describeIt(root)).toEqual([
      'Longitude < 9',
      'AND (Longitude > 2 AND (Latitude > 1 OR Latitude < -1))',
    ]);
    expect(countFilterRules(root)).toBe(4);
  });

  it('keeps a value that contains "AND" as text, not a join', () => {
    const lines = describeFilterGroup(group('AND', [['product', 'contains', 'NRPS AND PKS']]), bgcPropertyFilterFields);
    expect(lines[0].parts).toEqual([{ kind: 'text', value: expect.stringContaining('NRPS AND PKS') }]);
  });
});
