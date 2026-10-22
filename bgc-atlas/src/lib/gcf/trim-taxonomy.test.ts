import { describe, expect, it } from 'vitest';
import { trimTaxonomyByRank, TAXONOMY_TOP_N } from './trim-taxonomy';

describe('trimTaxonomyByRank', () => {
  it('keeps the top N per rank and reports the full taxon count', () => {
    const species = Object.fromEntries(
      Array.from({ length: 50 }, (_, i) => [`s__t${i}`, 50 - i]),
    );
    const { distributions, taxaCounts } = trimTaxonomyByRank({ species, phylum: { p__A: 100 } });
    expect(Object.keys(distributions.species)).toHaveLength(TAXONOMY_TOP_N);
    expect(distributions.species['s__t0']).toBe(50);       // largest kept
    expect(distributions.species['s__t49']).toBeUndefined(); // tail dropped
    expect(distributions.phylum).toEqual({ p__A: 100 });   // short rank untouched
    expect(taxaCounts).toEqual({ species: 50, phylum: 1 });
  });

  it('breaks ties by name so the cut is deterministic', () => {
    const dist = Object.fromEntries(Array.from({ length: 25 }, (_, i) => [`g__${String.fromCharCode(97 + i)}`, 1]));
    const { distributions } = trimTaxonomyByRank({ genus: dist });
    expect(Object.keys(distributions.genus).sort()[0]).toBe('g__a');
    expect(distributions.genus['g__y']).toBeUndefined();
  });

  it('drops non-finite shares and does not count them', () => {
    const genus = { g__a: 5, g__b: Number.NaN, g__c: Number.POSITIVE_INFINITY, g__d: 'x' as unknown as number };
    const { distributions, taxaCounts } = trimTaxonomyByRank({ genus });
    expect(distributions.genus).toEqual({ g__a: 5 });
    expect(taxaCounts.genus).toBe(1);
  });

  it('passes an empty or missing map through', () => {
    expect(trimTaxonomyByRank({})).toEqual({ distributions: {}, taxaCounts: {} });
  });
});
