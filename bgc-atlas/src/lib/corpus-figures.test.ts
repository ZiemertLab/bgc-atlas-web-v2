import { describe, expect, it, vi } from 'vitest';

// The module imports prisma; nothing here may reach the live database.
vi.mock('@/lib/prisma', () => ({ default: {} }));
vi.mock('@/lib/api/studies-query', () => ({}));

import { fillFigures, fillFiguresDeep, millions, type CorpusFigures } from './corpus-figures';
import { API_ENDPOINTS } from './api-catalog';

const F: CorpusFigures = { bgcs: 16_109_198, families: 629_872, samples: 817_969, studies: 44_268, dataSources: 19 };

describe('fillFigures', () => {
  it('fills the five totals with thousands separators', () => {
    expect(fillFigures('{families} families, {bgcs} clusters, {dataSources} sources', F))
      .toBe('629,872 families, 16,109,198 clusters, 19 sources');
  });

  it('leaves other braces alone', () => {
    expect(fillFigures('{ success, data } and {unknown}', F)).toBe('{ success, data } and {unknown}');
  });

  it('fills every string in a nested value', () => {
    expect(fillFiguresDeep({ a: ['{studies}'], b: { c: '{samples}' }, n: 3 }, F))
      .toEqual({ a: ['44,268'], b: { c: '817,969' }, n: 3 });
  });

  it('rounds to one decimal in millions', () => {
    expect(millions(16_109_198)).toBe('16.1 million');
  });
});

describe('the API catalog', () => {
  // The catalog stated 614,215 families and 15,985,022 BGCs long after both had
  // moved. A corpus total belongs in a {token}; a hard-coded one goes stale.
  it('writes no corpus-sized number by hand', () => {
    const text = JSON.stringify(API_ENDPOINTS);
    expect(text.match(/\b\d{1,3}(,\d{3}){2,}\b|\b\d{3},\d{3}\b/g) ?? []).toEqual([]);
  });

  it('uses each total it names', () => {
    const filled = JSON.stringify(fillFiguresDeep(API_ENDPOINTS, F));
    for (const value of ['629,872 families', '16,109,198 clusters', '817,969 samples', '44,268 studies', 'The 19 repositories']) {
      expect(filled).toContain(value);
    }
  });
});
