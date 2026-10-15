import { describe, expect, it, vi } from 'vitest';
import {
  advancedFilterRequires,
  advancedFilterTouches,
} from './advanced-filter-touches';
import { bgcFilterFields } from '@/lib/filters/field-definitions';
import type { FilterCondition, FilterGroup, FilterOperator, FilterValue } from '@/lib/filters/types';

// The mock must return more than SAMPLE_ASSEMBLY_INLINE_CAP (3,000) rows: only
// the over-cap EXISTS fallback embeds the caller's predicate, so fewer rows would
// alias-check a bare literal and prove nothing.
const { overInlineCap } = vi.hoisted(() => ({
  overInlineCap: Array.from(
    { length: 3001 },
    () => ({ assembly_id: '00000000-0000-0000-0000-000000000000' }),
  ),
}));
vi.mock('@/lib/prisma', () => ({
  default: { $queryRaw: vi.fn(async () => overInlineCap) },
}));

const group = (fields: string[], operator: 'AND' | 'OR' = 'AND'): FilterGroup => ({
  id: 'g', operator, groups: [],
  conditions: fields.map((field, i) => ({ id: `c${i}`, field, operator: 'gte', value: 1 })),
});

const groupOf = (
  operator: 'AND' | 'OR',
  conditions: Array<{ field: string; value?: FilterValue }>,
  groups: FilterGroup[] = [],
): FilterGroup => ({
  id: 'g', operator, groups,
  conditions: conditions.map((c, i) => ({
    id: `c${i}`, field: c.field, operator: 'gte' as FilterOperator,
    value: c.value === undefined ? 1 : c.value,
  })),
});

describe('advancedFilterTouches', () => {
  it('touches nothing for a filter that lives on bgcs alone', () => {
    // With the biome/taxonomy joins the COUNT takes ~145s (past the 120s timeout)
    // vs ~15s, and INNER joins drop BGCs with no row in those tables.
    expect(advancedFilterTouches(group(['length', 'genes', 'completeness'])))
      .toEqual({ bbs: false, t: false, asm: false });
  });

  it('touches bbs only for a biome condition', () => {
    expect(advancedFilterTouches(group(['biome']))).toEqual({ bbs: true, t: false, asm: false });
  });

  it('touches t only for a taxonomy condition', () => {
    expect(advancedFilterTouches(group(['taxonomy']))).toEqual({ bbs: false, t: true, asm: false });
  });

  it('touches asm only for a goldEcosystem condition', () => {
    // Different vocabularies on different tables; the wrong join is a 500.
    expect(advancedFilterTouches(group(['goldEcosystem'])))
      .toEqual({ bbs: false, t: false, asm: true });
  });

  it('walks nested groups', () => {
    expect(advancedFilterTouches({
      id: 'g', operator: 'OR', conditions: [],
      groups: [group(['length']), group(['taxonomy'])],
    })).toEqual({ bbs: false, t: true, asm: false });
  });

  it('does not touch a table named only by a blank condition', () => {
    // buildAdvancedWhere silently drops a valueless condition.
    expect(advancedFilterTouches(groupOf('AND', [
      { field: 'length' }, { field: 'biome', value: '' }, { field: 'taxonomy', value: [' '] },
    ]))).toEqual({ bbs: false, t: false, asm: false });
  });

  it('touches nothing for a null group', () => {
    expect(advancedFilterTouches(null)).toEqual({ bbs: false, t: false, asm: false });
  });
});

describe('advancedFilterRequires', () => {
  it('requires nothing for a filter that lives on bgcs alone', () => {
    expect(advancedFilterRequires(group(['length', 'genes'])))
      .toEqual({ bbs: false, t: false, asm: false });
  });

  it('requires the table when ANY conjunct names it', () => {
    expect(advancedFilterRequires(group(['length', 'biome'])))
      .toEqual({ bbs: true, t: false, asm: false });
  });

  it('does NOT require the table when only SOME disjunct names it', () => {
    // With INNER, BGCs matching `length` with no biome row vanish at HTTP 200.
    expect(advancedFilterRequires(group(['length', 'biome'], 'OR')))
      .toEqual({ bbs: false, t: false, asm: false });
  });

  it('requires the table when EVERY disjunct names it', () => {
    expect(advancedFilterRequires(group(['biome', 'biome'], 'OR')))
      .toEqual({ bbs: true, t: false, asm: false });
  });

  it('recurses into subgroups under an AND parent', () => {
    expect(advancedFilterRequires({
      id: 'g', operator: 'AND', conditions: [],
      groups: [group(['length']), group(['taxonomy'])],
    })).toEqual({ bbs: false, t: true, asm: false });
  });

  it('requires asm for a conjunctive goldEcosystem filter and not under an OR', () => {
    // A few assemblies have no assembly_samples_mv row, so INNER under an OR
    // would drop their BGCs.
    expect(advancedFilterRequires(groupOf('AND', [
      { field: 'goldEcosystem', value: 'Host-associated' }, { field: 'length', value: 1000 },
    ]))).toEqual({ bbs: false, t: false, asm: true });

    expect(advancedFilterRequires(groupOf('OR', [
      { field: 'goldEcosystem', value: 'Host-associated' }, { field: 'length', value: 1000 },
    ]))).toEqual({ bbs: false, t: false, asm: false });
  });

  it('recurses into subgroups under an OR parent', () => {
    expect(advancedFilterRequires({
      id: 'g', operator: 'OR', conditions: [],
      groups: [group(['length']), group(['taxonomy'])],
    })).toEqual({ bbs: false, t: false, asm: false });
  });

  it('ignores a blank condition in the EVERY computation', () => {
    // A blank condition is not in the SQL, so `biome OR <nothing>` is `biome`.
    expect(advancedFilterRequires(groupOf('OR', [
      { field: 'biome' }, { field: 'length', value: '' },
    ]))).toEqual({ bbs: true, t: false, asm: false });
  });

  it('ignores a subgroup whose every condition is blank', () => {
    expect(advancedFilterRequires({
      id: 'g', operator: 'OR', conditions: [{ id: 'c', field: 'biome', operator: 'contains', value: 'soil' }],
      groups: [groupOf('AND', [{ field: 'length', value: '' }])],
    })).toEqual({ bbs: true, t: false, asm: false });
  });

  it('requires nothing for a group with no effective children', () => {
    expect(advancedFilterRequires(groupOf('AND', [{ field: 'biome', value: '' }])))
      .toEqual({ bbs: false, t: false, asm: false });
    expect(advancedFilterRequires({ id: 'g', operator: 'OR', conditions: [], groups: [] }))
      .toEqual({ bbs: false, t: false, asm: false });
    expect(advancedFilterRequires(null)).toEqual({ bbs: false, t: false, asm: false });
  });

  it('applies the rule at every level of a 3-deep nesting', () => {
    // AND[ taxonomy, OR[ biome, AND[ biome, length ] ] ]
    //   - the inner AND requires bbs (one conjunct does)
    //   - the OR requires bbs (both disjuncts do)
    //   - the root requires t (one conjunct does) and bbs (the OR does)
    const uniform: FilterGroup = groupOf('AND', [{ field: 'taxonomy' }], [
      groupOf('OR', [{ field: 'biome' }], [groupOf('AND', [{ field: 'biome' }, { field: 'length' }])]),
    ]);
    expect(advancedFilterRequires(uniform)).toEqual({ bbs: true, t: true, asm: false });

    // An innermost OR lets `length` match a BGC with no biome row.
    const leaky: FilterGroup = groupOf('AND', [{ field: 'taxonomy' }], [
      groupOf('OR', [{ field: 'biome' }], [groupOf('OR', [{ field: 'biome' }, { field: 'length' }])]),
    ]);
    expect(advancedFilterRequires(leaky)).toEqual({ bbs: false, t: true, asm: false });
    // ...while the join is still needed, as a LEFT.
    expect(advancedFilterTouches(leaky)).toEqual({ bbs: true, t: true, asm: false });
  });

  it('treats an operator that is neither AND nor OR as AND', () => {
    // Unvalidated client payload; buildAdvancedWhere coerces it to AND.
    const bogus = { ...group(['length', 'biome'], 'AND'), operator: 'NAND' as unknown as 'AND' };
    expect(advancedFilterRequires(bogus)).toEqual({ bbs: true, t: false, asm: false });
  });
});

describe('the alias map agrees with buildBgcAdvancedCondition', () => {
  // A resolver case emitting a `bbs.`/`t.`/`asm.` column with no aliasForField
  // entry would reference an un-joined alias and 500.
  const expectedAliases: Record<string, Array<'bbs' | 't' | 'asm'>> = {
    id: [],
    assembly: [],
    sampleId: [],
    sample: [],
    gcf: [],
    productCategory: [],
    productType: [],
    completeness: [],
    biome: ['bbs'],
    goldEcosystem: ['asm'],
    taxonomy: ['t'],
    length: [],
    genes: [],
    distance: [],
  };

  const plausibleCondition = (fieldId: string): FilterCondition => {
    const def = bgcFilterFields.find((f) => f.id === fieldId);
    if (!def) throw new Error(`no such field: ${fieldId}`);
    const operator = def.defaultOperator ?? 'equals';
    if (def.type === 'number') return { id: 'c', field: fieldId, operator, value: 10000 };
    if (def.type === 'select') {
      return { id: 'c', field: fieldId, operator, value: def.options?.[0]?.value ?? 'complete' };
    }
    return { id: 'c', field: fieldId, operator, value: 'soil' };
  };

  it('covers every field in bgcFilterFields', () => {
    expect(Object.keys(expectedAliases).sort()).toEqual(bgcFilterFields.map((f) => f.id).sort());
  });

  it.each(bgcFilterFields.map((f) => f.id))('compiles %s to the aliases it declares', async (fieldId) => {
    const { buildBgcAdvancedCondition } = await import('./advanced-condition');
    const condition = plausibleCondition(fieldId);
    const fragment = await buildBgcAdvancedCondition(condition);
    expect(fragment, `${fieldId} compiled to nothing`).not.toBeNull();

    // `strings` excludes bound values. `\b` keeps `bt.`, `pt.`, `bgf.` and `::text` out.
    const sql = fragment!.strings.join(' ');
    const found: Array<'bbs' | 't' | 'asm'> = [];
    if (/\bbbs\./.test(sql)) found.push('bbs');
    if (/\bt\./.test(sql)) found.push('t');
    if (/\basm\./.test(sql)) found.push('asm');

    expect(found.sort()).toEqual([...expectedAliases[fieldId]!].sort());

    const touched = advancedFilterTouches(groupOf('AND', [{ field: fieldId, value: 'soil' }]));
    expect({
      bbs: found.includes('bbs'),
      t: found.includes('t'),
      asm: found.includes('asm'),
    }).toEqual(touched);
  });
});
