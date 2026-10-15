import { describe, it, expect } from 'vitest';
import type { FilterFieldDefinition, FilterGroup } from '@/lib/filters/types';
import {
  buildOpenSearchQuery, makeResolver, buildAggregations,
  niceInterval, buildTermsAgg, buildStatsAgg, buildHistogramAgg,
  type UnhonouredCondition,
} from '@/lib/opensearch/query';
import { bgcPropertyFilterFields } from '@/lib/filters/bgc-property-fields';
import type { FilterOperator, FilterValue } from '@/lib/filters/types';

const FIELDS: FilterFieldDefinition[] = [
  { id: 'pfam', label: 'PFAM', type: 'select', os: 'keyword' },
  { id: 'product_category', label: 'Category', type: 'select', os: 'keyword' },
  { id: 'length', label: 'Length', type: 'number', os: 'number' },
  { id: 'is_complete', label: 'Complete', type: 'select', os: 'boolean' },
  { id: 'core_seq', label: 'Core seq', type: 'text', os: 'wildcard' },
  { id: 'gold_ecosystem', label: 'GOLD ecosystem', type: 'select', os: 'keyword', hierarchical: true },
];
const resolver = makeResolver(FIELDS);

const group = (partial: Partial<FilterGroup>): FilterGroup => ({
  id: 'g', operator: 'AND', conditions: [], groups: [], ...partial,
});
const cond = (field: string, operator: string, value: unknown) =>
  ({ id: `c-${field}`, field, operator: operator as never, value: value as never });

const build = (g: FilterGroup) => buildOpenSearchQuery(g, resolver);

describe('keyword facets', () => {
  it('in -> terms', () => {
    expect(build(group({ conditions: [cond('pfam', 'in', ['PF00109', 'PF00668'])] })))
      .toEqual({ terms: { pfam: ['PF00109', 'PF00668'] } });
  });
  it('equals -> term', () => {
    expect(build(group({ conditions: [cond('product_category', 'equals', 'NRPS')] })))
      .toEqual({ term: { product_category: 'NRPS' } });
  });
  it('not_in -> must_not terms', () => {
    expect(build(group({ conditions: [cond('pfam', 'not_in', ['PF00109'])] })))
      .toEqual({ bool: { must_not: [{ terms: { pfam: ['PF00109'] } }] } });
  });
});

describe('hierarchical keyword (GOLD ecosystem subtree)', () => {
  const subtree = (v: string) => ({
    bool: {
      should: [{ term: { gold_ecosystem: v } }, { prefix: { gold_ecosystem: { value: `${v}:` } } }],
      minimum_should_match: 1,
    },
  });
  it('in (single) -> node OR descendants', () => {
    expect(build(group({ conditions: [cond('gold_ecosystem', 'in', ['Environmental:Aquatic'])] })))
      .toEqual(subtree('Environmental:Aquatic'));
  });
  it('in (multi) -> should over each subtree', () => {
    expect(build(group({ conditions: [cond('gold_ecosystem', 'in', ['Environmental:Aquatic', 'Host-associated'])] })))
      .toEqual({
        bool: {
          should: [subtree('Environmental:Aquatic'), subtree('Host-associated')],
          minimum_should_match: 1,
        },
      });
  });
  it('not_in -> must_not subtree', () => {
    expect(build(group({ conditions: [cond('gold_ecosystem', 'not_in', ['Environmental:Aquatic'])] })))
      .toEqual({ bool: { must_not: [subtree('Environmental:Aquatic')] } });
  });
  it('equals stays an exact-path match (no descendants)', () => {
    expect(build(group({ conditions: [cond('gold_ecosystem', 'equals', 'Environmental:Aquatic')] })))
      .toEqual({ term: { gold_ecosystem: 'Environmental:Aquatic' } });
  });
  it('not_equals stays exact', () => {
    expect(build(group({ conditions: [cond('gold_ecosystem', 'not_equals', 'Environmental:Aquatic')] })))
      .toEqual({ bool: { must_not: [{ term: { gold_ecosystem: 'Environmental:Aquatic' } }] } });
  });
  it('contains still runs a substring wildcard', () => {
    expect(build(group({ conditions: [cond('gold_ecosystem', 'contains', 'Marine')] })))
      .toEqual({ wildcard: { gold_ecosystem: { value: '*Marine*', case_insensitive: true } } });
  });
});

describe('numbers', () => {
  it('gt -> range', () => {
    expect(build(group({ conditions: [cond('length', 'gt', 20000)] })))
      .toEqual({ range: { length: { gt: 20000 } } });
  });
  it('between -> range gte/lte', () => {
    expect(build(group({ conditions: [cond('length', 'between', [1000, 5000])] })))
      .toEqual({ range: { length: { gte: 1000, lte: 5000 } } });
  });
});

describe('boolean + wildcard text', () => {
  it('boolean equals -> term true', () => {
    expect(build(group({ conditions: [cond('is_complete', 'equals', 'true')] })))
      .toEqual({ term: { is_complete: true } });
  });
  it('contains -> case-insensitive wildcard', () => {
    expect(build(group({ conditions: [cond('core_seq', 'contains', 'LLFC')] })))
      .toEqual({ wildcard: { core_seq: { value: '*LLFC*', case_insensitive: true } } });
  });
  it('not_contains -> must_not wildcard', () => {
    expect(build(group({ conditions: [cond('core_seq', 'not_contains', 'LLFC')] })))
      .toEqual({ bool: { must_not: [{ wildcard: { core_seq: { value: '*LLFC*', case_insensitive: true } } }] } });
  });
});

describe('boolean composition', () => {
  it('AND group -> bool.filter', () => {
    expect(build(group({
      operator: 'AND',
      conditions: [cond('product_category', 'equals', 'NRPS'), cond('pfam', 'in', ['PF00668'])],
    }))).toEqual({
      bool: { filter: [{ term: { product_category: 'NRPS' } }, { terms: { pfam: ['PF00668'] } }] },
    });
  });
  it('OR group -> bool.should + minimum_should_match', () => {
    expect(build(group({
      operator: 'OR',
      conditions: [cond('product_category', 'equals', 'NRPS'), cond('product_category', 'equals', 'PKS')],
    }))).toEqual({
      bool: {
        should: [{ term: { product_category: 'NRPS' } }, { term: { product_category: 'PKS' } }],
        minimum_should_match: 1,
      },
    });
  });
  it('nested groups compose (A AND (B OR C))', () => {
    const q = build(group({
      operator: 'AND',
      conditions: [cond('product_category', 'equals', 'NRPS')],
      groups: [group({
        operator: 'OR',
        conditions: [cond('pfam', 'equals', 'PF1'), cond('pfam', 'equals', 'PF2')],
      })],
    }));
    expect(q).toEqual({
      bool: {
        filter: [
          { term: { product_category: 'NRPS' } },
          { bool: { should: [{ term: { pfam: 'PF1' } }, { term: { pfam: 'PF2' } }], minimum_should_match: 1 } },
        ],
      },
    });
  });
});

describe('edge cases', () => {
  it('empty group -> match_all', () => {
    expect(build(group({}))).toEqual({ match_all: {} });
  });
  // Still dropped from the query, but reported to the sink so the route refuses it.
  it('unknown field is skipped', () => {
    expect(build(group({ conditions: [cond('nope', 'equals', 'x')] }))).toEqual({ match_all: {} });
  });
  it('blank value is skipped', () => {
    expect(build(group({ conditions: [cond('pfam', 'in', [])] }))).toEqual({ match_all: {} });
  });
});

/** Every drop other than an empty value must reach the caller: a dropped condition widens the result. */
describe('unhonourable conditions are reported', () => {
  const collect = (g: FilterGroup) => {
    const rejected: UnhonouredCondition[] = [];
    const query = buildOpenSearchQuery(g, resolver, (u) => rejected.push(u));
    return { query, rejected };
  };

  it('boolean field with `in` is reported (is_complete)', () => {
    const { rejected } = collect(group({ conditions: [cond('is_complete', 'in', ['true'])] }));
    expect(rejected).toHaveLength(1);
    expect(rejected[0].field).toBe('is_complete');
    expect(rejected[0].operator).toBe('in');
    expect(rejected[0].reason).toBe('unsupported_operator');
    // Repair guidance: what this field CAN be asked.
    expect(rejected[0].supportedOperators).toContain('equals');
  });

  it('unknown field id is reported and names itself', () => {
    const { rejected } = collect(group({ conditions: [cond('nope', 'equals', 'x')] }));
    expect(rejected).toEqual([
      expect.objectContaining({ field: 'nope', operator: 'equals', reason: 'unknown_field' }),
    ]);
  });

  it('reports every bad condition, including in nested groups', () => {
    const { rejected } = collect(group({
      conditions: [cond('is_complete', 'in', ['true']), cond('length', 'contains', '5')],
      groups: [group({ operator: 'OR', conditions: [cond('nope', 'equals', 'x')] })],
    }));
    expect(rejected.map((r) => `${r.field} ${r.operator}`)).toEqual([
      'is_complete in', 'length contains', 'nope equals',
    ]);
  });

  it('keeps an empty value a silent drop (the builder emits half-built conditions)', () => {
    const filled = cond('pfam', 'in', ['PF00109']);
    for (const value of ['', [], [''], ['', '']] as FilterValue[]) {
      // Alone, the group-level hasFilterRules short-circuit already covers it...
      expect(collect(group({ conditions: [cond('is_complete', 'in', value)] })).rejected).toEqual([]);
      // ...but not beside a filled condition, which is what the UI produces; only the
      // resolver's own blank check keeps that from reporting.
      const { query, rejected } = collect(group({
        conditions: [filled, cond('is_complete', 'in', value)],
      }));
      expect(rejected).toEqual([]);
      expect(query).toEqual({ terms: { pfam: ['PF00109'] } });
    }
    // Same for a field that does not exist at all, with or without a sibling.
    expect(collect(group({ conditions: [cond('nope', 'equals', '')] })).rejected).toEqual([]);
    expect(collect(group({ conditions: [filled, cond('nope', 'equals', '')] })).rejected).toEqual([]);
  });

  it('reports a value the field cannot use', () => {
    const { rejected } = collect(group({ conditions: [cond('length', 'gte', 'abc')] }));
    expect(rejected).toEqual([
      expect.objectContaining({ field: 'length', operator: 'gte', reason: 'unusable_value' }),
    ]);
  });

  it('reports nothing for conditions it honours', () => {
    const { query, rejected } = collect(group({
      conditions: [
        cond('is_complete', 'equals', 'true'),
        cond('pfam', 'in', ['PF00109']),
        cond('length', 'between', [1000, 5000]),
        cond('product_category', 'contains', 'RiPP'),
        cond('core_seq', 'ends_with', 'CC'),
      ],
    }));
    expect(rejected).toEqual([]);
    expect(query).toHaveProperty('bool.filter');
  });

  it('is opt-in: no sink means the old signature still builds the same query', () => {
    expect(build(group({ conditions: [cond('is_complete', 'in', ['true'])] })))
      .toEqual({ match_all: {} });
  });
});

/**
 * Drift guard over the real field catalog, both directions: a kind-valid value must
 * never be `unusable_value` (the table promising an operator the switch lacks), and
 * every `allowedOperators` entry must build a clause.
 */
describe('operator support table matches the clause builders', () => {
  const ALL_OPERATORS: FilterOperator[] = [
    'equals', 'not_equals', 'contains', 'not_contains', 'starts_with', 'ends_with',
    'gt', 'gte', 'lt', 'lte', 'between', 'in', 'not_in',
  ];
  const realResolver = makeResolver(bgcPropertyFilterFields);
  /** A value the kind can definitely use, so a null clause isolates table/switch
   *  disagreement from "this value was unusable". */
  const validValue = (numeric: boolean, op: FilterOperator): FilterValue => {
    if (op === 'between') return numeric ? [1, 2] : ['x', 'y'];
    if (op === 'in' || op === 'not_in') return numeric ? [1] : ['x'];
    return numeric ? 1 : 'x';
  };
  const resolve = (field: string, operator: FilterOperator, value: FilterValue) => {
    const rejected: UnhonouredCondition[] = [];
    const clause = realResolver({ id: 'c', field, operator, value }, (u) => rejected.push(u));
    return { clause, rejected };
  };

  it('never lists an operator its clause builder cannot build', () => {
    const drift: string[] = [];
    const silent: string[] = [];
    for (const def of bgcPropertyFilterFields) {
      for (const op of ALL_OPERATORS) {
        const { clause, rejected } = resolve(def.id, op, validValue(def.os === 'number', op));
        // A kind-valid value reported as unusable = the table promised an operator
        // the switch has no case for.
        if (rejected.some((r) => r.reason === 'unusable_value')) drift.push(`${def.id} ${op}`);
        if (!clause && !rejected.length) silent.push(`${def.id} ${op}`);
      }
    }
    expect(drift).toEqual([]);
    expect(silent).toEqual([]);
  });

  it('honours every operator the catalog declares (allowedOperators ⊆ honourable)', () => {
    const unhonoured: string[] = [];
    for (const def of bgcPropertyFilterFields) {
      for (const op of def.allowedOperators ?? []) {
        const { clause, rejected } = resolve(def.id, op, validValue(def.os === 'number', op));
        if (!clause || rejected.length) unhonoured.push(`${def.id} ${op} (${rejected[0]?.reason ?? 'no clause'})`);
      }
    }
    expect(unhonoured).toEqual([]);
  });

  /**
   * A pair is rejected when the field's OS kind cannot answer it, not when the UI does
   * not offer it: the results table's column filters send pairs outside allowedOperators.
   * "Honoured" means the clause is built, not that it is useful (`gcf_id contains`).
   */
  it("honours the pairs the results table's column filters send", () => {
    const columnFilters: [string, FilterOperator, FilterValue][] = [
      ['contig', 'contains', 'NODE_1'],
      ['product_category', 'in', ['NRPS']],
      ['product', 'contains', 'pks'],            // outside KW_OPS
      ['length', 'between', [1000, '']],
      ['is_complete', 'equals', 'true'],
      ['sample_name', 'contains', 'ERR'],
      ['sample_type', 'in', ['MAG']],
      ['gold_ecosystem', 'contains', 'Marine'],
      ['gcf_id', 'contains', 'GCF-000336'],           // outside KW_OPS
      ['tax_genus', 'contains', 'Streptomyces'],
    ];
    const rejected: UnhonouredCondition[] = [];
    const built: string[] = [];
    for (const [field, operator, value] of columnFilters) {
      const clause = realResolver({ id: 'c', field, operator, value }, (u) => rejected.push(u));
      if (clause) built.push(field);
    }
    expect(rejected).toEqual([]);
    expect(built).toHaveLength(columnFilters.length);
  });

  it('reports the operator mismatches the catalog actually contains', () => {
    const rejected: UnhonouredCondition[] = [];
    // `in` on the two boolean fields is the mismatch that matters.
    for (const field of ['is_complete', 'pks_trans_at']) {
      realResolver({ id: 'c', field, operator: 'in', value: ['true'] }, (u) => rejected.push(u));
    }
    expect(rejected.map((r) => r.field)).toEqual(['is_complete', 'pks_trans_at']);
  });
});

describe('aggregations', () => {
  it('builds terms aggs per field', () => {
    expect(buildAggregations(['pfam', 'product_category'], 25)).toEqual({
      pfam: { terms: { field: 'pfam', size: 25 } },
      product_category: { terms: { field: 'product_category', size: 25 } },
    });
  });
});

describe('niceInterval', () => {
  it('picks ~1/2/2.5/5 * 10^n step for the span', () => {
    expect(niceInterval(0, 100000, 30)).toBe(5000);   // 3333 -> 5000
    expect(niceInterval(0, 0.5, 30)).toBe(0.02);       // 0.0166 -> 0.02
    expect(niceInterval(2000, 2025, 30)).toBe(1);      // 0.83 -> 1 (year)
    expect(niceInterval(0, 60, 30)).toBe(2);           // 2 -> 2
    expect(niceInterval(0, 75, 30)).toBe(2.5);         // 2.5 -> 2.5
  });
  it('never returns a non-positive interval for a flat or inverted range', () => {
    expect(niceInterval(5, 5, 30)).toBe(1);
    expect(niceInterval(10, 0, 30)).toBe(1);
  });
});

describe('distribution agg builders', () => {
  it('terms agg carries a companion missing count', () => {
    expect(buildTermsAgg('pfam', 20)).toEqual({
      pfam: { terms: { field: 'pfam', size: 20 } },
      pfam__missing: { missing: { field: 'pfam' } },
    });
  });
  it('stats agg carries min/max, a p1/p99 spread, and a missing count', () => {
    expect(buildStatsAgg('length')).toEqual({
      length__stats: { stats: { field: 'length' } },
      length__pct: { percentiles: { field: 'length', percents: [1, 99] } },
      length__missing: { missing: { field: 'length' } },
    });
  });
  it('histogram agg clips outliers with hard_bounds and fills empty interior bins', () => {
    expect(buildHistogramAgg('length', 5000, 0, 100000)).toEqual({
      length: {
        histogram: {
          field: 'length', interval: 5000, min_doc_count: 0,
          extended_bounds: { min: 0, max: 100000 },
          hard_bounds: { min: 0, max: 100000 },
        },
      },
    });
  });
});

describe('makeResolver caseInsensitive option', () => {
  const fields = [
    { id: 'cat', label: 'Category', type: 'select' as const, os: 'keyword' as const },
  ];

  it('defaults to a case-SENSITIVE term, as Property Search expects', () => {
    const r = makeResolver(fields);
    expect(r({ id: 'c', field: 'cat', operator: 'equals', value: 'PKS' }))
      .toEqual({ term: { cat: 'PKS' } });
  });

  it('emits a case-insensitive term when asked', () => {
    // SQL matches with ILIKE; a plain term for "pks" misses the PKS regions.
    const r = makeResolver(fields, { caseInsensitive: true });
    expect(r({ id: 'c', field: 'cat', operator: 'equals', value: 'pks' }))
      .toEqual({ term: { cat: { value: 'pks', case_insensitive: true } } });
  });

  it('expands `in` to a should of terms, because `terms` has no case_insensitive', () => {
    const r = makeResolver(fields, { caseInsensitive: true });
    expect(r({ id: 'c', field: 'cat', operator: 'in', value: ['pks', 'nrps'] })).toEqual({
      bool: {
        should: [
          { term: { cat: { value: 'pks', case_insensitive: true } } },
          { term: { cat: { value: 'nrps', case_insensitive: true } } },
        ],
        minimum_should_match: 1,
      },
    });
  });
});

// Uses the module-level FIELDS fixture so every OS kind is exercised by the same flag.
describe('caseInsensitive across every field kind', () => {
  const ciResolver = makeResolver(FIELDS, { caseInsensitive: true });
  const ci = (field: string, operator: string, value: unknown) =>
    ciResolver(cond(field, operator, value));
  const off = (field: string, operator: string, value: unknown) =>
    resolver(cond(field, operator, value));

  describe('wildcard kind', () => {
    it('equals -> ci term', () => {
      expect(ci('core_seq', 'equals', 'llfc'))
        .toEqual({ term: { core_seq: { value: 'llfc', case_insensitive: true } } });
    });
    it('not_equals -> must_not around a ci term', () => {
      expect(ci('core_seq', 'not_equals', 'llfc')).toEqual({
        bool: { must_not: [{ term: { core_seq: { value: 'llfc', case_insensitive: true } } }] },
      });
    });
  });

  describe('keyword kind', () => {
    // anyTerm's middle branch: one value needs no `should` wrapper at all.
    it('single-value `in` collapses to a bare ci term', () => {
      expect(ci('pfam', 'in', ['pf00109']))
        .toEqual({ term: { pfam: { value: 'pf00109', case_insensitive: true } } });
    });
    it('not_in wraps the ci should in must_not', () => {
      expect(ci('pfam', 'not_in', ['pf00109', 'pf00668'])).toEqual({
        bool: {
          must_not: [{
            bool: {
              should: [
                { term: { pfam: { value: 'pf00109', case_insensitive: true } } },
                { term: { pfam: { value: 'pf00668', case_insensitive: true } } },
              ],
              minimum_should_match: 1,
            },
          }],
        },
      });
    });
    it('not_equals wraps the ci term in must_not', () => {
      expect(ci('product_category', 'not_equals', 'nrps')).toEqual({
        bool: { must_not: [{ term: { product_category: { value: 'nrps', case_insensitive: true } } }] },
      });
    });
    it('default-off `in` still emits one plain `terms`', () => {
      expect(off('pfam', 'in', ['PF00109', 'PF00668']))
        .toEqual({ terms: { pfam: ['PF00109', 'PF00668'] } });
    });
  });

  describe('hierarchical keyword', () => {
    const ciSubtree = (v: string) => ({
      bool: {
        should: [
          { term: { gold_ecosystem: { value: v, case_insensitive: true } } },
          { prefix: { gold_ecosystem: { value: `${v}:`, case_insensitive: true } } },
        ],
        minimum_should_match: 1,
      },
    });
    // `prefix` accepts case_insensitive, so both halves of the subtree clause carry it.
    it('in (single) -> ci term OR ci prefix', () => {
      expect(ci('gold_ecosystem', 'in', ['environmental:aquatic']))
        .toEqual(ciSubtree('environmental:aquatic'));
    });
    it('in (multi) -> should over ci subtrees', () => {
      expect(ci('gold_ecosystem', 'in', ['environmental:aquatic', 'host-associated'])).toEqual({
        bool: {
          should: [ciSubtree('environmental:aquatic'), ciSubtree('host-associated')],
          minimum_should_match: 1,
        },
      });
    });
    it('not_in -> must_not around the ci subtree', () => {
      expect(ci('gold_ecosystem', 'not_in', ['environmental:aquatic']))
        .toEqual({ bool: { must_not: [ciSubtree('environmental:aquatic')] } });
    });

    // Threading `ci` through subtreeClause must not change the flag-OFF shape:
    // a bare `term` value and a `prefix` with nothing but `value`.
    it('default-off subtree shape is unchanged (no case_insensitive anywhere)', () => {
      const plain = {
        bool: {
          should: [
            { term: { gold_ecosystem: 'Environmental:Aquatic' } },
            { prefix: { gold_ecosystem: { value: 'Environmental:Aquatic:' } } },
          ],
          minimum_should_match: 1,
        },
      };
      expect(off('gold_ecosystem', 'in', ['Environmental:Aquatic'])).toEqual(plain);
      expect(off('gold_ecosystem', 'not_in', ['Environmental:Aquatic']))
        .toEqual({ bool: { must_not: [plain] } });
      expect(JSON.stringify(off('gold_ecosystem', 'in', ['Environmental:Aquatic'])))
        .not.toContain('case_insensitive');
    });
  });

  // case_insensitive on a numerically-mapped field is a 400, so numberClause and
  // booleanClause must never route through `term()`.
  describe('number and boolean never take the flag', () => {
    it('number equals -> bare term', () => {
      expect(ci('length', 'equals', '5000')).toEqual({ term: { length: 5000 } });
    });
    it('number not_equals -> must_not bare term', () => {
      expect(ci('length', 'not_equals', '5000'))
        .toEqual({ bool: { must_not: [{ term: { length: 5000 } }] } });
    });
    it('boolean equals -> bare term', () => {
      expect(ci('is_complete', 'equals', 'true')).toEqual({ term: { is_complete: true } });
    });
    it('boolean not_equals -> must_not bare term', () => {
      expect(ci('is_complete', 'not_equals', 'true'))
        .toEqual({ bool: { must_not: [{ term: { is_complete: true } }] } });
    });
    it('emits no case_insensitive key for either kind', () => {
      for (const clause of [
        ci('length', 'equals', '5000'),
        ci('length', 'not_equals', '5000'),
        ci('length', 'between', ['1', '2']),
        ci('is_complete', 'equals', 'false'),
        ci('is_complete', 'not_equals', 'true'),
      ]) {
        expect(JSON.stringify(clause)).not.toContain('case_insensitive');
      }
    });
  });
});
