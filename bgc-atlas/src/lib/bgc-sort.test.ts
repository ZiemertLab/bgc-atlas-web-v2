import { describe, it, expect } from 'vitest';
import {
  applySortFieldGuard,
  hasAnyActiveFilter,
  isScanHeavySort,
  SCAN_HEAVY_SORT_FIELDS,
} from './bgc-sort';

describe('hasAnyActiveFilter', () => {
  it('is false for nothing at all', () => {
    expect(hasAnyActiveFilter()).toBe(false);
    expect(hasAnyActiveFilter(undefined, null, {})).toBe(false);
  });

  it('ignores the shapes that mean "no selection"', () => {
    expect(hasAnyActiveFilter({ search: '', productType: 'all', ids: [] })).toBe(false);
    expect(hasAnyActiveFilter({ search: '   ' })).toBe(false);
    expect(hasAnyActiveFilter({ flag: false, missing: null })).toBe(false);
  });

  it('detects a pre-applied filter such as a GCF page', () => {
    expect(hasAnyActiveFilter({ gcf: '000014b6-7669-5baa-b338-3a22bdff33c0' })).toBe(true);
  });

  it('detects a user-entered filter in any of several sources', () => {
    expect(hasAnyActiveFilter({}, { search: 'lasso' })).toBe(true);
    expect(hasAnyActiveFilter({ gcf: '' }, { ids: ['a'] })).toBe(true);
    expect(hasAnyActiveFilter({ complete: true })).toBe(true);
  });

  it('treats numbers, including 0, as a real selection', () => {
    // a range bound of 0 is a genuine filter, unlike an empty string
    expect(hasAnyActiveFilter({ minLength: 0 })).toBe(true);
  });
});

describe('scan-heavy sort guard', () => {
  it('flags taxonomy as scan-heavy and index-backed sorts as not', () => {
    expect(isScanHeavySort('taxonomy')).toBe(true);
    for (const f of ['length', 'genes', 'gcf', 'distance', 'completeness', 'name']) {
      expect(isScanHeavySort(f)).toBe(false);
    }
  });

  it('keeps every sort untouched when a narrowing filter is present', () => {
    const r = applySortFieldGuard(['taxonomy'], ['asc'], true);
    expect(r).toEqual({ fields: ['taxonomy'], orders: ['asc'], dropped: [] });
  });

  it('drops taxonomy when nothing narrows the set', () => {
    const r = applySortFieldGuard(['taxonomy'], ['asc'], false);
    expect(r.fields).toEqual([]);
    expect(r.dropped).toEqual(['taxonomy']);
  });

  it('drops only the scan-heavy field and keeps its neighbours paired', () => {
    const r = applySortFieldGuard(
      ['length', 'taxonomy', 'genes'],
      ['desc', 'asc', 'asc'],
      false,
    );
    expect(r.fields).toEqual(['length', 'genes']);
    // the surviving orders must still line up with their own fields, not shift
    expect(r.orders).toEqual(['desc', 'asc']);
    expect(r.dropped).toEqual(['taxonomy']);
  });

  it('leaves an all-safe sort list alone either way', () => {
    for (const narrowed of [true, false]) {
      const r = applySortFieldGuard(['length', 'genes'], ['desc', 'asc'], narrowed);
      expect(r.fields).toEqual(['length', 'genes']);
      expect(r.orders).toEqual(['desc', 'asc']);
      expect(r.dropped).toEqual([]);
    }
  });

  it('does not mutate its inputs', () => {
    const fields = ['taxonomy', 'length'];
    const orders = ['asc', 'desc'];
    applySortFieldGuard(fields, orders, false);
    expect(fields).toEqual(['taxonomy', 'length']);
    expect(orders).toEqual(['asc', 'desc']);
  });

  it('exposes the scan-heavy set so callers can gate UI on the same source', () => {
    expect(SCAN_HEAVY_SORT_FIELDS).toContain('taxonomy');
  });
});
