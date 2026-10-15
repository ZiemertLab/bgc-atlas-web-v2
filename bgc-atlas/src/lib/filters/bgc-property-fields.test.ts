import { describe, it, expect } from 'vitest';
import {
  bgcPropertyFilterFields,
  booleanFacetFields,
  booleanFacetLabel,
  defaultFacetFields,
  facetValueCondition,
  keywordFacetFields,
  MAX_DISTRIBUTION_FIELDS,
  plottableFields,
} from '@/lib/filters/bgc-property-fields';
import { makeResolver, type UnhonouredCondition } from '@/lib/opensearch/query';

const byId = (id: string) => bgcPropertyFilterFields.find((f) => f.id === id);

// Numeric and sequence `detailed_info` keys have their own typed fields; only categorical
// annotations stay in the `ripp_modifications` facet.
describe('RiPP detailed_info split', () => {
  it.each([
    'ripp_cut_mass',
    'ripp_cut_weight',
    'ripp_mature_weight',
    'ripp_num_bridges',
  ])('%s is a numeric field supporting range queries', (id) => {
    const f = byId(id);
    expect(f).toBeDefined();
    expect(f!.os).toBe('number');
    expect(f!.allowedOperators).toContain('gte');
    expect(f!.allowedOperators).toContain('between');
  });

  it('ripp_macrolactam is a sequence field, like core_seq and leader_seq', () => {
    const f = byId('ripp_macrolactam');
    expect(f).toBeDefined();
    expect(f!.os).toBe('wildcard');
    expect(f!.os).toBe(byId('core_seq')!.os);
  });

  it('the split fields are not offered as value pickers', () => {
    for (const id of ['ripp_cut_mass', 'ripp_cut_weight', 'ripp_mature_weight',
      'ripp_num_bridges', 'ripp_macrolactam']) {
      expect(keywordFacetFields).not.toContain(id);
    }
  });

  it('the numeric split fields are plottable as histograms', () => {
    for (const id of ['ripp_cut_mass', 'ripp_cut_weight', 'ripp_mature_weight',
      'ripp_num_bridges']) {
      expect(plottableFields).toContain(id);
    }
    // wildcard fields have no bounded value set to aggregate
    expect(plottableFields).not.toContain('ripp_macrolactam');
  });

  it('ripp_modifications stays a dynamic keyword facet', () => {
    const f = byId('ripp_modifications');
    expect(f!.os).toBe('keyword');
    expect(f!.dynamic).toBe(true);
  });

  it('ripp_mass is labelled to distinguish it from the new mass fields', () => {
    expect(byId('ripp_mass')!.label).toMatch(/monoisotopic/i);
  });
});

// Composite strings ("Condensation_LCL-AMP-binding-PCP", "DVWHFSLVDK") where exact
// match alone can't express "any module containing a PCP domain".
describe('substring matching on composite keyword facets', () => {
  it.each(['module_signatures', 'stachelhaus_codes'])('%s supports contains', (id) => {
    const f = byId(id);
    expect(f!.allowedOperators).toContain('contains');
    expect(f!.allowedOperators).toContain('not_contains');
  });

  it('keeps them as keyword facets, so exact selection still works', () => {
    for (const id of ['module_signatures', 'stachelhaus_codes']) {
      expect(byId(id)!.os).toBe('keyword');
      expect(byId(id)!.allowedOperators).toContain('in');
      expect(keywordFacetFields).toContain(id);
    }
  });
});

// The UI's drill-down conditions must be ones the server answers: boolean fields (`is_complete`,
// `pks_trans_at`) take `equals`, never `in`.
describe('facetValueCondition', () => {
  const resolver = makeResolver(bgcPropertyFilterFields);
  const resolve = (field: string, value: string) => {
    const rejected: UnhonouredCondition[] = [];
    const clause = resolver(facetValueCondition(field, value), (u) => rejected.push(u));
    return { clause, rejected };
  };

  // A terms chart is drawn for keyword and boolean fields; a numeric field draws a
  // histogram, whose "+" emits `between` instead (see the histogram case below).
  const termFields = bgcPropertyFilterFields
    .filter((f) => plottableFields.includes(f.id) && (f.os === 'keyword' || f.os === 'boolean'))
    .map((f) => f.id);

  it('emits an operator the server honours for EVERY field that draws a terms chart', () => {
    expect(termFields.length).toBeGreaterThan(50);
    const broken: string[] = [];
    for (const field of termFields) {
      for (const value of ['1', '0', 'true', 'false', 'T1PKS']) {
        const { clause, rejected } = resolve(field, value);
        if (!clause || rejected.length) {
          broken.push(`${field}=${value} (${rejected[0]?.reason ?? 'no clause'})`);
        }
      }
    }
    expect(broken).toEqual([]);
  });

  it('the histogram drill-down (between) is honoured by every numeric plottable field', () => {
    const broken: string[] = [];
    for (const def of bgcPropertyFilterFields) {
      if (def.os !== 'number' || !plottableFields.includes(def.id)) continue;
      const rejected: UnhonouredCondition[] = [];
      const clause = resolver(
        { id: 'c', field: def.id, operator: 'between', value: ['10', '20'] },
        (u) => rejected.push(u),
      );
      if (!clause || rejected.length) broken.push(def.id);
    }
    expect(broken).toEqual([]);
  });

  it('emits an operator the server honours for every default facet field', () => {
    const broken: string[] = [];
    for (const field of defaultFacetFields) {
      const { clause, rejected } = resolve(field, '1');
      if (!clause || rejected.length) broken.push(field);
    }
    expect(broken).toEqual([]);
  });

  it('uses equals for a boolean field and in for the rest', () => {
    expect([...booleanFacetFields].sort()).toEqual(['is_complete', 'pks_trans_at']);
    expect(facetValueCondition('pks_trans_at', '1')).toMatchObject({
      field: 'pks_trans_at', operator: 'equals', value: 'true',
    });
    expect(facetValueCondition('is_complete', '0')).toMatchObject({
      field: 'is_complete', operator: 'equals', value: 'false',
    });
    expect(facetValueCondition('product', 'T1PKS')).toMatchObject({
      field: 'product', operator: 'in', value: ['T1PKS'],
    });
  });
});

describe('booleanFacetLabel', () => {
  it('never renders the raw 1/0 the index aggregates to', () => {
    for (const field of booleanFacetFields) {
      for (const value of ['1', '0', 'true', 'false']) {
        expect(booleanFacetLabel(field, value)).not.toMatch(/^[01]$/);
      }
    }
  });

  it('says what is_complete means, Yes/No for the rest', () => {
    expect(booleanFacetLabel('is_complete', '1')).toBe('Complete');
    expect(booleanFacetLabel('is_complete', '0')).toBe('Partial (contig edge)');
    expect(booleanFacetLabel('pks_trans_at', '1')).toBe('Yes');
    expect(booleanFacetLabel('pks_trans_at', '0')).toBe('No');
  });
});

describe('MAX_DISTRIBUTION_FIELDS', () => {
  it('is one number, shared by the panel and the aggregate route', () => {
    // With two independent caps the panel could ask for a chart the route drops,
    // and it renders that absence as a spinner that never stops.
    expect(MAX_DISTRIBUTION_FIELDS).toBe(12);
  });
});

describe('operator declarations', () => {
  it('every field declares a defaultOperator inside its own allowedOperators', () => {
    // A default outside the field's own operators would be unrepresentable in the dropdown.
    const bad: string[] = [];
    for (const def of bgcPropertyFilterFields) {
      if (!def.allowedOperators?.length) bad.push(`${def.id}: no allowedOperators`);
      else if (!def.defaultOperator) bad.push(`${def.id}: no defaultOperator`);
      else if (!def.allowedOperators.includes(def.defaultOperator)) {
        bad.push(`${def.id}: default ${def.defaultOperator} not in [${def.allowedOperators.join(', ')}]`);
      }
    }
    expect(bad).toEqual([]);
  });
});

describe('legacy field ids', () => {
  it('still resolves the pre-rename product_type id', () => {
    // Saved queries and shared links carry the legacy id; an unknown field is a 400.
    const resolve = makeResolver(bgcPropertyFilterFields);
    const legacy = resolve({ id: 'c', field: 'product_type', operator: 'in', value: ['T1PKS'] }, undefined);
    const current = resolve({ id: 'c', field: 'product', operator: 'in', value: ['T1PKS'] }, undefined);
    // The legacy id names the stored product_type; `product` is a mapping alias onto it.
    expect(legacy).toEqual({ terms: { product_type: ['T1PKS'] } });
    expect(current).toEqual({ terms: { product: ['T1PKS'] } });
  });
});
