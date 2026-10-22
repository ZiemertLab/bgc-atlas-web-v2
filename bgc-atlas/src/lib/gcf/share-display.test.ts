import { describe, expect, it } from 'vitest';

import type { FilterCondition, FilterGroup } from '@/lib/filters/types';
import { resolveShareCondition } from '@/lib/filters/share-fields';
import {
  ecosystemResolvedNote,
  formatMemberShares,
  formatResolvedPct,
  formatShareValue,
  shareConditionLabel,
  shareConditionsOf,
  shareMatchFor,
  shareMatchText,
  shortShareDenominator,
} from './share-display';

const L = 'en-US';

// GCF-v2b6-035292, as gcf_browse holds it (2026-10-22), trimmed: the
// walkthrough family whose one lanthipeptide member in 12,278 made it the top
// "lanthipeptide" hit.
const walkthrough = {
  productTypeMemberShare: { 'RiPP-like': 99.96, hserlactone: 0.03, 'lanthipeptide-class-iv': 0.01 },
  productTypesAtLeast: { 10: ['RiPP-like'], 50: ['RiPP-like'], 90: ['RiPP-like'] },
  biomeDistributionByLevel: {
    1: {}, 2: {}, 4: {}, 5: {},
    3: { Marine: 34.6, 'Respiratory system': 25.4, 'Digestive system': 9.2, Wood: 0.0 },
  },
  ecosystemsAtLeastByLevel: {
    1: { 10: [], 50: [], 90: [] },
    2: { 10: [], 50: [], 90: [] },
    3: { 10: ['Marine', 'Respiratory system'], 50: [], 90: [] },
    4: { 10: [], 50: [], 90: [] },
    5: { 10: [], 50: [], 90: [] },
  },
  ecosystemResolvedPctByLevel: { 1: 99.5, 2: 90, 3: 63.11, 4: 0, 5: null },
};

const cond = (c: Partial<FilterCondition> & Pick<FilterCondition, 'field' | 'value'>): FilterCondition => ({
  id: 'c', operator: 'equals', ...c,
});
const query = (c: Partial<FilterCondition> & Pick<FilterCondition, 'field' | 'value'>) => {
  const q = resolveShareCondition(cond(c));
  if (!q) throw new Error('unresolvable');
  return q;
};

describe('formatShareValue', () => {
  it('keeps the stored precision and no more', () => {
    expect(formatShareValue(34.6, 1, { locale: L })).toBe('34.6');
    expect(formatShareValue(99.96, 2, { locale: L })).toBe('99.96');
    expect(formatShareValue(50, 2, { locale: L })).toBe('50');
  });

  it('says "< unit" for a present share that rounds to zero, 0 for an absent one', () => {
    expect(formatShareValue(0, 2, { locale: L })).toBe('< 0.01');
    expect(formatShareValue(0, 1, { locale: L })).toBe('< 0.1');
    expect(formatShareValue(undefined, 1, { locale: L })).toBe('0');
  });

  it('never prints a below-threshold share as reaching it', () => {
    // 49.96 is stored as 50.0 at 1 dp, and is NOT in eco_l<n>_ge50.
    expect(formatShareValue(50.0, 1, { belowThreshold: 50, locale: L })).toBe('< 50');
    expect(formatShareValue(12.3, 1, { belowThreshold: 50, locale: L })).toBe('12.3');
  });
});

describe('formatResolvedPct / ecosystemResolvedNote', () => {
  it('rounds to 1 dp without claiming all or none', () => {
    expect(formatResolvedPct(63.11, L)).toBe('63.1');
    expect(formatResolvedPct(99.96, L)).toBe('> 99.9');
    expect(formatResolvedPct(0.04, L)).toBe('< 0.1');
    expect(formatResolvedPct(100, L)).toBe('100');
  });

  it('names the level, and is absent when unknown', () => {
    expect(ecosystemResolvedNote(3, 63.11, L)).toBe('63.1 % of members have an L3 ecosystem');
    expect(ecosystemResolvedNote(3, null)).toBeUndefined();
    expect(ecosystemResolvedNote(3, undefined)).toBeUndefined();
  });
});

describe('shareConditionsOf', () => {
  const group = (conditions: FilterCondition[], groups: FilterGroup[] = []): FilterGroup => ({
    id: 'g', operator: 'AND', conditions, groups,
  });

  it('collects share conditions from nested groups, once each, in order', () => {
    const found = shareConditionsOf(group(
      [
        cond({ field: 'memberBgcCount', operator: 'gte', value: 50 }),
        cond({ field: 'productShare', value: 'lanthipeptide-class-i', threshold: 50 }),
      ],
      [group([
        cond({ field: 'ecoShareL3', value: 'Marine', threshold: 90 }),
        cond({ id: 'dup', field: 'productShare', value: 'lanthipeptide-class-i', threshold: 50 }),
      ])],
    ));
    expect(found.map((f) => f.query.spec)).toEqual([{ kind: 'product' }, { kind: 'ecosystem', level: 3 }]);
    expect(new Set(found.map((f) => f.columnId)).size).toBe(2);
    expect(found[0].columnId).toMatch(/^shareMatch_\w+$/);
  });

  it('gives a condition the same column id however its values are ordered', () => {
    const a = shareConditionsOf(group([cond({ field: 'productShare', operator: 'in', value: ['a', 'b'], threshold: 10 })]));
    const b = shareConditionsOf(group([cond({ field: 'productShare', operator: 'in', value: ['b', 'a'], threshold: 10 })]));
    expect(a[0].columnId).toBe(b[0].columnId);
  });

  it('skips conditions the backends would refuse', () => {
    expect(shareConditionsOf(group([cond({ field: 'productShare', value: 'NRPS', threshold: 25 })]))).toEqual([]);
    expect(shareConditionsOf(null)).toEqual([]);
  });
});

describe('shareConditionLabel', () => {
  it('names the value, the level and the threshold', () => {
    expect(shareConditionLabel(query({ field: 'ecoShareL3', value: 'Marine', threshold: 90 }))).toBe('Marine (L3) ≥ 90 %');
    expect(shareConditionLabel(query({ field: 'productShare', value: 'NRPS', threshold: 0 }))).toBe('NRPS (any member)');
    expect(shareConditionLabel(query({ field: 'productShare', operator: 'not_equals', value: 'NRPS', threshold: 50 })))
      .toBe('NRPS < 50 %');
    expect(shareConditionLabel(query({ field: 'productShare', operator: 'not_in', value: ['a', 'b'], threshold: 0 })))
      .toBe('Product (no member)');
  });
});

describe('shareMatchFor', () => {
  it('shows a tiny product share as it is', () => {
    const match = shareMatchFor(walkthrough, query({
      field: 'productShare', value: 'lanthipeptide-class-iv', threshold: 0,
    }), L);
    expect(match.status).toBe('matched');
    expect(shareMatchText(match)).toBe('lanthipeptide-class-iv: 0.01 % of members');
  });

  it('lists the values that reached the threshold, highest share first', () => {
    const match = shareMatchFor(walkthrough, query({
      field: 'ecoShareL3', operator: 'in', value: ['Digestive system', 'Respiratory system', 'Marine'], threshold: 10,
    }), L);
    expect(match.entries.map((e) => e.value)).toEqual(['Marine', 'Respiratory system']);
    expect(shareMatchText(match)).toBe(
      'Marine: 34.6 %; Respiratory system: 25.4 % of members with an L3 ecosystem',
    );
    expect(match.resolvedNote).toBe('63.1 % of members have an L3 ecosystem');
  });

  it('reads membership from the arrays, not from the rounded share', () => {
    // Marine at 34.6 is >= 10, but if the array says otherwise the array wins.
    const row = { ...walkthrough, ecosystemsAtLeastByLevel: { ...walkthrough.ecosystemsAtLeastByLevel, 3: { 10: [], 50: [], 90: [] } } };
    expect(shareMatchFor(row, query({ field: 'ecoShareL3', value: 'Marine', threshold: 10 })).status).toBe('other');
  });

  it('threshold 0 for ecosystems is any key of the distribution, even one rounding to 0', () => {
    const match = shareMatchFor(walkthrough, query({ field: 'ecoShareL3', value: 'Wood', threshold: 0 }), L);
    expect(match.status).toBe('matched');
    expect(match.entries[0].text).toBe('< 0.1');
  });

  it('a negated condition shows the shares that stayed below it', () => {
    const match = shareMatchFor(walkthrough, query({
      field: 'productShare', operator: 'not_in', value: ['hserlactone', 'NRPS'], threshold: 50,
    }), L);
    expect(match.status).toBe('matched');
    expect(shareMatchText(match)).toBe('hserlactone: 0.03 %; NRPS: 0 % of members');
  });

  it('a row an OR branch matched is not presented as meeting this condition', () => {
    expect(shareMatchFor(walkthrough, query({ field: 'productShare', value: 'NRPS', threshold: 50 })).status).toBe('other');
    expect(shareMatchFor(walkthrough, query({
      field: 'productShare', operator: 'not_equals', value: 'RiPP-like', threshold: 90,
    })).status).toBe('other');
  });

  it('is unresolved where no member has an ecosystem at that level', () => {
    expect(shareMatchFor(walkthrough, query({ field: 'ecoShareL4', value: 'X', threshold: 50 })).status).toBe('unresolved');
    expect(shareMatchFor(walkthrough, query({ field: 'ecoShareL5', value: 'X', threshold: 50 })).status).toBe('unresolved');
  });

  it('is unavailable on a row without the share fields', () => {
    const row = { biomeDistributionByLevel: walkthrough.biomeDistributionByLevel };
    expect(shareMatchFor(row, query({ field: 'ecoShareL3', value: 'Marine', threshold: 10 })).status).toBe('unavailable');
  });
});

describe('formatMemberShares', () => {
  it('exports every product at stored precision, tiny ones included', () => {
    expect(formatMemberShares(walkthrough.productTypeMemberShare))
      .toBe('RiPP-like 99.96%; hserlactone 0.03%; lanthipeptide-class-iv 0.01%');
    expect(formatMemberShares({ NRPS: 50, PKS: 0, T1PKS: 10.5 })).toBe('NRPS 50%; T1PKS 10.5%; PKS <0.01%');
    expect(formatMemberShares(undefined)).toBe('');
  });
});

describe('shortShareDenominator', () => {
  it('shortens the ecosystem denominator, keeps the product one', () => {
    expect(shortShareDenominator(query({ field: 'ecoShareL3', value: 'Marine', threshold: 10 }))).toBe('of members with L3');
    expect(shortShareDenominator(query({ field: 'productShare', value: 'NRPS', threshold: 10 }))).toBe('of members');
  });
});
