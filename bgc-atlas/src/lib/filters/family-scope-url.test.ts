import { describe, it, expect } from 'vitest';
import {
  deserializeFamilyScope, isActiveFamilyScope, serializeFamilyScope,
} from '@/lib/filters/family-scope-url';
import type { FilterGroup } from '@/lib/filters/types';

const cohort = (value: string): FilterGroup => ({
  id: 'g', operator: 'AND', groups: [],
  conditions: [{ id: 'c', field: 'latitude', operator: 'gt', value }],
});
const empty: FilterGroup = { id: 'e', operator: 'AND', groups: [], conditions: [] };

describe('family scope URL round-trip', () => {
  it('restores cohorts, labels and purity', () => {
    const scope = { cohorts: [cohort('66.5'), cohort('-66.5')], labels: ['Arctic', 'Antarctic'], minPurity: 0.9 };
    const back = deserializeFamilyScope(serializeFamilyScope(scope));
    expect(back).toEqual(scope);
  });

  // A link that drops the scope silently reopens as a far larger, plausible answer.
  it('drops cohorts with no rules, and with them the whole scope', () => {
    expect(serializeFamilyScope({ cohorts: [cohort('1'), empty], labels: ['a', 'b'], minPurity: 1 })).toBe('');
    expect(isActiveFamilyScope({ cohorts: [cohort('1')], labels: ['a'], minPurity: 1 })).toBe(false);
  });

  it('keeps each label with its own cohort when an earlier one is dropped', () => {
    const scope = { cohorts: [empty, cohort('1'), cohort('2')], labels: ['skip', 'keep1', 'keep2'], minPurity: 1 };
    expect(deserializeFamilyScope(serializeFamilyScope(scope))?.labels).toEqual(['keep1', 'keep2']);
  });

  it('survives junk in the URL rather than throwing into the page', () => {
    expect(deserializeFamilyScope('not-base64!!')).toBeNull();
    expect(deserializeFamilyScope(null)).toBeNull();
  });

  it('clamps a purity outside 0..1', () => {
    const s = serializeFamilyScope({ cohorts: [cohort('1'), cohort('2')], labels: ['', ''], minPurity: 5 });
    expect(deserializeFamilyScope(s)?.minPurity).toBe(1);
  });
});
