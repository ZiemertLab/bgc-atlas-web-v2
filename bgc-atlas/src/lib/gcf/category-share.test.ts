import { describe, expect, it } from 'vitest';

import {
  CategoryShareFilterError,
  canonicalCategory,
  categoryForShareSort,
  categoryShareField,
  parseCategoryFilter,
  splitCombination,
} from './category-share';

const params = (q: Record<string, string>) => new URLSearchParams(q);

describe('parseCategoryFilter', () => {
  it('is null without a category', () => {
    expect(parseCategoryFilter(params({}))).toBeNull();
  });

  it('keeps the old any-member text match for a link with no threshold', () => {
    // ?category=NRPS is in shared links, so its meaning must not change.
    expect(parseCategoryFilter(params({ category: 'NRPS' })))
      .toEqual({ kind: 'contains', text: 'NRPS' });
    expect(parseCategoryFilter(params({ productType: 'nrp' })))
      .toEqual({ kind: 'contains', text: 'nrp' });
  });

  it('reads a threshold as a share of members of the exact category', () => {
    expect(parseCategoryFilter(params({ category: 'nrps', categoryMinShare: '50' })))
      .toEqual({ kind: 'share', category: 'NRPS', minShare: 50 });
    expect(parseCategoryFilter(params({ category: 'terpene', categoryMinShare: '0' })))
      .toEqual({ kind: 'share', category: 'terpene', minShare: 0 });
  });

  it('prefers ?category= over the older ?productType=', () => {
    expect(parseCategoryFilter(params({ category: 'PKS', productType: 'RiPP', categoryMinShare: '10' })))
      .toEqual({ kind: 'share', category: 'PKS', minShare: 10 });
  });

  it.each([
    ['a threshold with no category', { categoryMinShare: '50' }, 'categoryMinShare'],
    ['a threshold on text that names no category', { category: 'PK', categoryMinShare: '50' }, 'category'],
    ['a threshold that is not a number', { category: 'PKS', categoryMinShare: 'most' }, 'categoryMinShare'],
    ['a threshold above 100', { category: 'PKS', categoryMinShare: '150' }, 'categoryMinShare'],
    ['a negative threshold', { category: 'PKS', categoryMinShare: '-1' }, 'categoryMinShare'],
  ])('refuses %s rather than dropping the filter', (_label, q, rejected) => {
    let error: unknown;
    try {
      parseCategoryFilter(params(q));
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(CategoryShareFilterError);
    expect((error as CategoryShareFilterError).rejected).toEqual([rejected]);
  });
});

describe('splitCombination', () => {
  it('splits a combination of known categories', () => {
    expect(splitCombination('NRPS+PKS')).toEqual(['NRPS', 'PKS']);
    expect(splitCombination('NRPS+PKS+other')).toEqual(['NRPS', 'PKS', 'other']);
  });

  it('leaves single categories and anything that is not a category alone', () => {
    expect(splitCombination('NRPS')).toBeNull();
    expect(splitCombination('NRPS-like')).toBeNull();
    expect(splitCombination('NRPS+lanthipeptide')).toBeNull();
    expect(splitCombination('+')).toBeNull();
  });
});

describe('category helpers', () => {
  it('matches categories case-insensitively onto the stored spelling', () => {
    expect(canonicalCategory('ripp')).toBe('RiPP');
    expect(canonicalCategory(' Terpene ')).toBe('terpene');
    expect(canonicalCategory('hybrid')).toBeNull();
  });

  it('names one index field per category', () => {
    expect(categoryShareField('RiPP')).toBe('category_share_ripp');
  });

  it('sorts by the filtered category only when it names exactly one', () => {
    expect(categoryForShareSort(params({ category: 'NRPS', categoryMinShare: '50' }))).toBe('NRPS');
    expect(categoryForShareSort(params({ category: 'nr' }))).toBeNull();
    expect(categoryForShareSort(params({}))).toBeNull();
  });
});
