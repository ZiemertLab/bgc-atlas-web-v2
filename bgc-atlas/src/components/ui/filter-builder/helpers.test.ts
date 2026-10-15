import { describe, it, expect } from 'vitest';
import { isTwoChoiceToggle, operatorChoices } from './helpers';
import { bgcPropertyFilterFields } from '@/lib/filters/bgc-property-fields';
import type { FilterFieldDefinition, FilterOperator } from '@/lib/filters/types';

// The row must display the operator it stores, even one outside allowedOperators.
const field = (id: string): FilterFieldDefinition =>
  bgcPropertyFilterFields.find((f) => f.id === id)!;

describe('operatorChoices', () => {
  it('keeps a stored operator the field does offer', () => {
    const { value, options, outOfList } = operatorChoices(field('product'), 'equals');
    expect(value).toBe('equals');
    expect(outOfList).toBe(false);
    expect(options).toEqual(field('product').allowedOperators);
  });

  it('displays a stored operator the field does NOT offer, and flags it', () => {
    const { value, options, outOfList } = operatorChoices(field('is_complete'), 'in');
    expect(value).toBe('in');             // not 'equals', the field default
    expect(outOfList).toBe(true);
    expect(options).toContain('in');
    expect(options).toContain('equals');
  });

  it('displays an out-of-list operator that WORKS, rather than relabelling it', () => {
    // Column filters send this pair and get correct answers; the row must not relabel it.
    const { value, outOfList } = operatorChoices(field('product'), 'contains');
    expect(value).toBe('contains');
    expect(outOfList).toBe(true);
  });

  it('never substitutes for ANY field in the catalog', () => {
    const substituted: string[] = [];
    for (const def of bgcPropertyFilterFields) {
      for (const op of ['in', 'contains', 'between', 'gte'] as FilterOperator[]) {
        const { value } = operatorChoices(def, op);
        if (value !== op) substituted.push(`${def.id} ${op} -> ${value}`);
      }
    }
    expect(substituted).toEqual([]);
  });

  it('falls back to the field default only when nothing is stored', () => {
    expect(operatorChoices(field('length'), undefined).value).toBe(field('length').defaultOperator);
    expect(operatorChoices(undefined, undefined).value).toBe('equals');
  });
});

describe('isTwoChoiceToggle', () => {
  const yesNo = bgcPropertyFilterFields.find((f) => f.id === 'is_complete') as FilterFieldDefinition;
  const many = bgcPropertyFilterFields.find((f) => f.id === 'candidate_kind') as FilterFieldDefinition;
  const twoWithNot: FilterFieldDefinition = {
    id: 'completeness', label: 'Completeness', type: 'select',
    options: [{ label: 'Complete', value: 'complete' }, { label: 'Partial', value: 'partial' }],
    allowedOperators: ['equals', 'not_equals'], defaultOperator: 'equals',
  };

  it('turns a two-choice field with "is" into a toggle', () => {
    expect(isTwoChoiceToggle(yesNo, 'equals')).toBe(true);
    expect(isTwoChoiceToggle(twoWithNot, 'equals')).toBe(true);
  });

  it('keeps the full row when the stored operator is not "is"', () => {
    // "is not" is valid but the toggle cannot show it; an unoffered operator from
    // an old link must stay visible so it can be repaired.
    expect(isTwoChoiceToggle(twoWithNot, 'not_equals')).toBe(false);
    expect(isTwoChoiceToggle(yesNo, 'in')).toBe(false);
  });

  it('leaves fields with more than two choices alone', () => {
    expect(isTwoChoiceToggle(many, 'equals')).toBe(false);
    expect(isTwoChoiceToggle(undefined, 'equals')).toBe(false);
  });
});
