import { describe, expect, it } from 'vitest';

import {
  canonicalizeFilterGroup,
  deserializeFilterGroup,
  serializeFilterGroup,
  summarizeFilterGroup,
  type FilterCondition,
  type FilterGroup,
} from './types';
import { migrateLegacyFilterGroup } from './legacy-conditions';
import { gcfFilterFields } from './field-definitions';

/**
 * Old `productClass` links ("Product contains lanthi", any member, by text) are
 * read as the share-based Product filter at "any member", expanded into the
 * product types the text matched, so they return what they returned.
 */

const group = (conditions: Partial<FilterCondition>[], groups: FilterGroup[] = []): FilterGroup => ({
  id: 'g1',
  operator: 'AND',
  conditions: conditions.map((c, i) => ({ id: `c${i + 1}`, ...c }) as FilterCondition),
  groups,
});

const first = (g: FilterGroup) => migrateLegacyFilterGroup(g).conditions[0];

describe('productClass is read as Product at "any member"', () => {
  it('contains matching several types becomes "is any of" those types', () => {
    expect(first(group([{ field: 'productClass', operator: 'contains', value: 'lanthi' }]))).toEqual({
      id: 'c1',
      field: 'productShare',
      operator: 'in',
      // lipolanthine too: the old substring match took it, so the link keeps it.
      value: [
        'lanthipeptide-class-i', 'lanthipeptide-class-ii', 'lanthipeptide-class-iii',
        'lanthipeptide-class-iv', 'lanthipeptide-class-v', 'lipolanthine',
      ],
      threshold: 0,
    });
  });

  it('contains matching one type becomes "is" that type, in its canonical case', () => {
    // ILIKE was case-insensitive; the index and the arrays are not, so the
    // migrated value has to be spelled the way the vocabulary spells it.
    expect(first(group([{ field: 'productClass', operator: 'contains', value: 'LASSO' }])))
      .toMatchObject({ field: 'productShare', operator: 'equals', value: 'lassopeptide', threshold: 0 });
  });

  it('equals is exact and case-insensitive, not a substring', () => {
    // `equals NRPS` must not pick up NRPS-like, NRP-metallophore, ...
    expect(first(group([{ field: 'productClass', operator: 'equals', value: 'nrps' }])))
      .toMatchObject({ operator: 'equals', value: 'NRPS', threshold: 0 });
  });

  it('starts_with and ends_with match the way the ILIKE did', () => {
    expect(first(group([{ field: 'productClass', operator: 'starts_with', value: 'T' }])).value)
      .toEqual(['T1PKS', 'T2PKS', 'T3PKS', 't3nrps-iterative', 'terpene', 'terpene-precursor',
        'thioamide-NRP', 'thioamitides', 'transAT-PKS', 'transAT-PKS-like', 'triceptide',
        'tropodithietic-acid']);
    expect(first(group([{ field: 'productClass', operator: 'ends_with', value: '-like' }])).value)
      .toEqual(['NRPS-like', 'PKS-like', 'RiPP-like', 'phosphonate-like', 'transAT-PKS-like']);
  });

  it('a negative becomes the negation of the same set', () => {
    expect(first(group([{ field: 'productClass', operator: 'not_contains', value: 'lanthi' }])))
      .toMatchObject({ operator: 'not_in', threshold: 0 });
    expect(first(group([{ field: 'productClass', operator: 'not_equals', value: 'T1PKS' }])))
      .toMatchObject({ operator: 'not_equals', value: 'T1PKS', threshold: 0 });
  });

  it('in (an API caller) is matched value by value', () => {
    expect(first(group([{ field: 'productClass', operator: 'in', value: ['nrps', 't1pks'] }])))
      .toMatchObject({ operator: 'in', value: ['NRPS', 'T1PKS'] });
  });

  it('text that matches no type is kept verbatim: it matched nothing then, and now', () => {
    expect(first(group([{ field: 'productClass', operator: 'contains', value: 'zzz' }])))
      .toMatchObject({ field: 'productShare', operator: 'equals', value: 'zzz', threshold: 0 });
  });

  it('a half-built row stays half-built', () => {
    expect(first(group([{ field: 'productClass', operator: 'contains', value: '' }])))
      .toMatchObject({ field: 'productShare', operator: 'equals', value: '', threshold: 0 });
  });

  it('an operator the field never answered is left for the backends to refuse', () => {
    const odd = { field: 'productClass', operator: 'gt' as const, value: 3 };
    expect(first(group([odd]))).toMatchObject(odd);
  });

  it('reaches nested groups and leaves every other field alone', () => {
    const nested = group([{ field: 'memberBgcCount', operator: 'gte', value: 50 }], [
      group([{ field: 'productClass', operator: 'equals', value: 'terpene' }]),
    ]);
    const migrated = migrateLegacyFilterGroup(nested);
    expect(migrated.conditions[0]).toEqual(nested.conditions[0]);
    expect(migrated.groups[0].conditions[0]).toMatchObject({ field: 'productShare', value: 'terpene' });
  });

  it('a share condition without a threshold gets the default, written down', () => {
    expect(first(group([{ field: 'ecoShareL3', operator: 'equals', value: 'Marine' }])).threshold).toBe(50);
    expect(first(group([{ field: 'productShare', operator: 'equals', value: 'NRPS', threshold: 10 }])).threshold)
      .toBe(10);
  });
});

describe('a link is migrated once and then stable', () => {
  const old = serializeFilterGroup(group([
    { field: 'productClass', operator: 'contains', value: 'lanthi' },
    { field: 'memberBgcCount', operator: 'gte', value: 50 },
  ]));

  it('deserialize reads the old link in the new form', () => {
    const read = deserializeFilterGroup(old)!;
    expect(read.conditions[0]).toMatchObject({ field: 'productShare', operator: 'in', threshold: 0 });
    expect(read.conditions[1]).toEqual({ id: 'c2', field: 'memberBgcCount', operator: 'gte', value: 50 });
  });

  it('the URL mirror writes the new form once; reading that back changes nothing', () => {
    // What /gcfs does: state = deserialize(url); url = serialize(state); repeat.
    const firstWrite = serializeFilterGroup(deserializeFilterGroup(old));
    expect(firstWrite).not.toBe(old);
    const secondWrite = serializeFilterGroup(deserializeFilterGroup(firstWrite));
    expect(secondWrite).toBe(firstWrite);
    expect(deserializeFilterGroup(secondWrite)).toEqual(deserializeFilterGroup(firstWrite));
  });

  // canonicalizeFilterGroup is the cache-key form for the samples statistics
  // routes only. /api/gcfs keys on the raw URL parameters (gcfs:list:v5), so
  // there an old link and its migrated form are two keys for one answer -- a
  // miss on the first request after the mirror rewrites the URL, nothing worse.
  it('the old and the migrated link have one canonical form', () => {
    const migrated = serializeFilterGroup(deserializeFilterGroup(old));
    expect(canonicalizeFilterGroup(deserializeFilterGroup(old)))
      .toEqual(canonicalizeFilterGroup(deserializeFilterGroup(migrated)));
  });

  it('the canonical form keeps a share threshold, as a number, and only on a share field', () => {
    const at = (threshold: unknown, field = 'productShare') => canonicalizeFilterGroup(group([
      { field, operator: 'equals', value: 'NRPS', threshold: threshold as number },
    ]))!.conditions[0];
    expect(at(10)).not.toEqual(at(50));
    expect(at('50')).toEqual(at(50));
    expect(at(50)).toEqual({ field: 'productShare', operator: 'equals', value: 'NRPS', threshold: 50 });
    expect(at(null)).toEqual({ field: 'productShare', operator: 'equals', value: 'NRPS' });
    // The server never reads it on another field, so it must not split the form.
    expect(at(50, 'name')).toEqual({ field: 'name', operator: 'equals', value: 'NRPS' });
  });

  it('the summary names the threshold', () => {
    const read = deserializeFilterGroup(serializeFilterGroup(group([
      { field: 'productShare', operator: 'equals', value: 'NRPS', threshold: 50 },
      { field: 'ecoShareL3', operator: 'equals', value: 'Marine', threshold: 90 },
      { field: 'productClass', operator: 'equals', value: 'terpene' },
    ])));
    expect(summarizeFilterGroup(read, gcfFilterFields)).toEqual([
      'Product = NRPS (≥ 50 % of members)',
      'Ecosystem share (L3) = Marine (≥ 90 % of members with an L3 ecosystem)',
      'Product = terpene (any member)',
    ]);
  });
});
