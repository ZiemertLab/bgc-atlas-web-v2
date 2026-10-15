import { describe, expect, it } from 'vitest';
import type { FilterCondition, FilterGroup, FilterOperator } from '@/lib/filters/types';
import { bgcFilterFields, gcfFilterFields, sampleFilterFields } from '@/lib/filters/field-definitions';
import { UnhonourableQueryError } from '@/lib/filters/unhonourable-query';
import type { BrowseEntity } from './browse-query';
import {
  browseAdvancedFields,
  buildAdvancedBrowseFilter,
  supportsAdvancedBrowse,
} from './browse-advanced';

let seq = 0;
const cond = (field: string, operator: FilterOperator, value: FilterCondition['value']): FilterCondition =>
  ({ id: `c${seq += 1}`, field, operator, value });

const group = (
  conditions: FilterCondition[],
  operator: 'AND' | 'OR' = 'AND',
  groups: FilterGroup[] = [],
): FilterGroup => ({ id: `g${seq += 1}`, operator, conditions, groups });

describe('supportsAdvancedBrowse', () => {
  it('admits a positive numeric condition', () => {
    expect(supportsAdvancedBrowse('bgcs', group([cond('genes', 'gte', 100)]))).toBe(true);
  });

  it('admits a null group -- there is nothing to refuse', () => {
    expect(supportsAdvancedBrowse('bgcs', null)).toBe(true);
  });

  it.each([
    ['samples' as BrowseEntity, 'host'],
    ['bgcs' as BrowseEntity, 'sample'],
  ])('refuses %s.%s, which the index cannot answer faithfully', (entity, field) => {
    expect(supportsAdvancedBrowse(entity, group([cond(field, 'contains', 'x')]))).toBe(false);
  });

  it.each<FilterOperator>(['not_contains', 'not_equals', 'not_in'])('refuses %s', (operator) => {
    expect(supportsAdvancedBrowse('bgcs', group([cond('productType', operator, 'PKS')]))).toBe(false);
  });

  it('refuses when a condition in a NESTED group is unsupported', () => {
    const nested = group([cond('genes', 'gte', 10)], 'AND', [
      group([cond('taxonomy', 'contains', 'Bacillus')], 'OR'),
    ]);
    expect(supportsAdvancedBrowse('bgcs', nested)).toBe(true);
    const bad = group([cond('genes', 'gte', 10)], 'AND', [
      group([cond('nonsense', 'contains', 'x')], 'OR'),
    ]);
    expect(supportsAdvancedBrowse('bgcs', bad)).toBe(false);
  });

  it('ignores a blank-valued condition, however broken it is', () => {
    // Emitted the moment a user picks a field; it must not decide which backend runs.
    expect(supportsAdvancedBrowse('bgcs', group([cond('nonsense', 'not_in', '')]))).toBe(true);
    expect(supportsAdvancedBrowse('bgcs', group([cond('genes', 'gte', ['', ''])]))).toBe(true);
  });

  it('refuses an operator the field KIND cannot build, so the gate cannot promise a throw', () => {
    // `in` is positive, but booleanClause handles equals only.
    expect(supportsAdvancedBrowse('bgcs', group([cond('completeness', 'in', ['complete'])]))).toBe(false);
    expect(() => buildAdvancedBrowseFilter('bgcs', group([cond('completeness', 'in', ['complete'])])))
      .toThrow(UnhonourableQueryError);
  });
});

describe('buildAdvancedBrowseFilter', () => {
  it('maps a numeric field onto its index field', () => {
    expect(buildAdvancedBrowseFilter('bgcs', group([cond('genes', 'gte', 100)])))
      .toEqual({ range: { num_cds_features: { gte: 100 } } });
  });

  it('rewrites completeness onto the is_complete boolean', () => {
    expect(buildAdvancedBrowseFilter('bgcs', group([cond('completeness', 'equals', 'complete')])))
      .toEqual({ term: { is_complete: true } });
    expect(buildAdvancedBrowseFilter('bgcs', group([cond('completeness', 'equals', 'partial')])))
      .toEqual({ term: { is_complete: false } });
  });

  it('refuses a completeness value the rewrite map has no entry for', () => {
    // booleanClause reads anything but "true"/"1" as false.
    expect(() => buildAdvancedBrowseFilter('bgcs', group([cond('completeness', 'equals', 'unknown')])))
      .toThrow(/cannot use value/);
  });

  it('matches gcf on gcf_id OR gcf_name', () => {
    expect(buildAdvancedBrowseFilter('bgcs', group([cond('gcf', 'equals', 'GCF-04-000042')])))
      .toEqual({
        bool: {
          should: [
            { term: { gcf_id: { value: 'GCF-04-000042', case_insensitive: true } } },
            { term: { gcf_name: { value: 'GCF-04-000042', case_insensitive: true } } },
          ],
          minimum_should_match: 1,
        },
      });
  });

  it('ORs biome across all 7 fields and taxonomy across all 8', () => {
    const biome = buildAdvancedBrowseFilter('bgcs', group([cond('biome', 'contains', 'soil')])) as
      { bool: { should: Record<string, { wildcard: Record<string, unknown> }>[] } };
    expect(biome.bool.should).toHaveLength(7);
    expect(biome.bool.should.map((c) => Object.keys(c.wildcard)[0])).toEqual([
      'resolved_biome_level_1', 'resolved_biome_level_2', 'resolved_biome_level_3',
      'resolved_biome_level_4', 'environment_biome', 'environment_feature',
      'environment_material',
    ]);

    const taxonomy = buildAdvancedBrowseFilter('bgcs', group([cond('taxonomy', 'contains', 'Bacillus')])) as
      { bool: { should: Record<string, { wildcard: Record<string, unknown> }>[] } };
    expect(taxonomy.bool.should).toHaveLength(8);
    expect(taxonomy.bool.should.map((c) => Object.keys(c.wildcard)[0])).toEqual([
      'tax_domain', 'tax_phylum', 'tax_class', 'tax_order', 'tax_family',
      'tax_genus', 'tax_species', 'gtdb_lineage',
    ]);
  });

  it('matches samples.id across external_id, sample_id and name', () => {
    const q = buildAdvancedBrowseFilter('samples', group([cond('id', 'contains', 'SRS110')])) as
      { bool: { should: Record<string, { wildcard: Record<string, unknown> }>[] } };
    expect(q.bool.should.map((c) => Object.keys(c.wildcard)[0]))
      .toEqual(['external_id', 'sample_id', 'name']);
  });

  it('joins an AND group with filter and an OR group with should', () => {
    const conditions = [cond('genes', 'gte', 10), cond('length', 'lte', 5000)];
    expect(buildAdvancedBrowseFilter('bgcs', group(conditions, 'AND'))).toEqual({
      bool: { filter: [{ range: { num_cds_features: { gte: 10 } } }, { range: { length: { lte: 5000 } } }] },
    });
    expect(buildAdvancedBrowseFilter('bgcs', group(conditions, 'OR'))).toEqual({
      bool: {
        should: [{ range: { num_cds_features: { gte: 10 } } }, { range: { length: { lte: 5000 } } }],
        minimum_should_match: 1,
      },
    });
  });

  it('returns null for an empty group, not match_all', () => {
    // As one entry in a `filter` array, match_all is pure noise.
    expect(buildAdvancedBrowseFilter('bgcs', null)).toBeNull();
    expect(buildAdvancedBrowseFilter('bgcs', group([]))).toBeNull();
    expect(buildAdvancedBrowseFilter('bgcs', group([cond('genes', 'gte', '')]))).toBeNull();
  });

  it('throws naming the offending field for an unknown one', () => {
    expect(() => buildAdvancedBrowseFilter('bgcs', group([cond('nonsense', 'contains', 'x')])))
      .toThrow(/unknown field "nonsense"/);
  });

  it('THROWS rather than serving the honourable half of a group', () => {
    let caught: unknown;
    try {
      buildAdvancedBrowseFilter('bgcs', group([
        cond('genes', 'gte', 100),
        cond('taxonomy', 'gt', 5),
      ]));
    } catch (error) { caught = error; }
    expect(caught).toBeInstanceOf(UnhonourableQueryError);
    expect((caught as UnhonourableQueryError).conditions).toHaveLength(1);
    expect((caught as UnhonourableQueryError).conditions[0].field).toBe('taxonomy');
  });

  it('reports EVERY offending condition in one error', () => {
    let caught: UnhonourableQueryError | undefined;
    try {
      buildAdvancedBrowseFilter('bgcs', group([cond('nope', 'contains', 'x')], 'AND', [
        group([cond('alsoNope', 'contains', 'y')]),
      ]));
    } catch (error) { caught = error as UnhonourableQueryError; }
    expect(caught?.conditions.map((c) => c.field)).toEqual(['nope', 'alsoNope']);
  });

  it('mirrors buildDataSourceCondition: a uuid value matches the id array exactly', () => {
    expect(buildAdvancedBrowseFilter('samples', group([cond('dataSource', 'contains', '9eedc1b2-5007-5481-a684-550f9b3892f7')])))
      .toEqual({ term: { data_source_ids: { value: '9eedc1b2-5007-5481-a684-550f9b3892f7', case_insensitive: true } } });
    expect(buildAdvancedBrowseFilter('samples', group([cond('dataSource', 'contains', 'GEM')])))
      .toEqual({ wildcard: { data_source_names: { value: '*GEM*', case_insensitive: true } } });
  });
});

/** Exactly which fields the index may answer a negative operator on (see negationTarget). */
const NEGATABLE: Record<BrowseEntity, string[]> = {
  bgcs: ['id', 'assembly', 'completeness', 'goldEcosystem', 'length', 'genes', 'distance'],
  samples: [
    'environment', 'biome', 'goldEcosystem', 'environmentFeature', 'environmentMaterial',
    'assemblies', 'bgcs', 'gcfCount', 'clusteredBgcCount', 'unclusteredBgcCount',
    'lat', 'lon', 'sourceType',
  ],
  gcfs: [
    'id', 'name', 'productType', 'biome', 'productClass', 'taxonomy', 'memberBgcCount', 'assemblyCount', 'completeBgcCount', 'taxaCount',
    'productCategoryCount', 'studyCount', 'ecosystemSpecificity',
    'domEcosystemPct', 'domPhylumPct', 'domEcosystem', 'domPhylum', 'mibigAnchored',
    'familyClass', 'avgScore', 'avgDistance',
  ],
};

/** Mapped fields whose negation stays on the SQL fallback, with the reason. */
const NOT_NEGATABLE: Record<BrowseEntity, string[]> = {
  // gcf/biome/taxonomy: several targets, so SQL negates as a conjunction over raw
  // columns. goldEcosystem is biome's negatable single-target counterpart.
  // productCategory/productType/sampleId: SQL negates one unnested ELEMENT.
  bgcs: ['gcf', 'biome', 'taxonomy', 'productCategory', 'productType', 'sampleId'],
  // id: three target fields. dataSource/study: unnest EXISTS.
  samples: ['id', 'dataSource', 'study'],
  // None: every multi-valued GCF field reads a negative as "no value matches" on
  // both backends (noneOrAny in api/gcfs/route.ts).
  gcfs: [],
};

describe.each(['bgcs', 'samples', 'gcfs'] as BrowseEntity[])('%s negative operators', (entity) => {
  it('admits a negative on exactly the fields whose SQL negation is whole-value', () => {
    const admitted = browseAdvancedFields(entity)
      .filter((def) => ['not_contains', 'not_equals', 'not_in']
        .some((op) => supportsAdvancedBrowse(entity, group([cond(def.id, op as FilterOperator, 'x')]))))
      .map((def) => def.id);
    expect(admitted).toEqual(NEGATABLE[entity]);
  });

  it('accounts for every mapped field, so a new one has to be decided', () => {
    expect(browseAdvancedFields(entity).map((f) => f.id).sort())
      .toEqual([...NEGATABLE[entity], ...NOT_NEGATABLE[entity]].sort());
  });

  it.each(['not_contains', 'not_equals', 'not_in'] as FilterOperator[])(
    'refuses %s on every non-negatable field',
    (operator) => {
      for (const id of NOT_NEGATABLE[entity]) {
        expect(
          supportsAdvancedBrowse(entity, group([cond(id, operator, 'x')])),
          `${entity}.${id} ${operator}`,
        ).toBe(false);
      }
    },
  );
});

describe('a negative clause is must_not PLUS exists', () => {
  it('guards a text negative with the field it negates', () => {
    // A bare must_not would also match documents with no tax_phylum, which SQL drops as NULL.
    expect(buildAdvancedBrowseFilter('bgcs', group([cond('assembly', 'not_contains', 'GCA_')])))
      .toEqual({
        bool: {
          must_not: [{ wildcard: { assembly_id: { value: '*GCA_*', case_insensitive: true } } }],
          filter: [{ exists: { field: 'assembly_id' } }],
        },
      });
  });

  it('guards a numeric negative too, where the column is nullable', () => {
    expect(buildAdvancedBrowseFilter('bgcs', group([cond('genes', 'not_equals', 5)])))
      .toEqual({
        bool: {
          must_not: [{ term: { num_cds_features: 5 } }],
          filter: [{ exists: { field: 'num_cds_features' } }],
        },
      });
  });

  it('serves bgcs.distance, whose SQL form is an EXISTS over bgc_gcf', () => {
    // bgc_gcf_one_primary is unique on (bgc_id) WHERE is_primary, so SQL's negative
    // is exactly must_not(term) + exists(distance).
    expect(buildAdvancedBrowseFilter('bgcs', group([cond('distance', 'not_equals', 0.4)])))
      .toEqual({
        bool: {
          must_not: [{ term: { distance: 0.4 } }],
          filter: [{ exists: { field: 'distance' } }],
        },
      });
  });

  it('negates completeness onto the boolean, matching buildCompletenessCondition', () => {
    // SQL answers `completeness not_equals complete` as `b.is_complete = false`,
    // which excludes NULL. must_not(term true) + exists(is_complete) is the same set.
    expect(buildAdvancedBrowseFilter('bgcs', group([cond('completeness', 'not_equals', 'complete')])))
      .toEqual({
        bool: {
          must_not: [{ term: { is_complete: true } }],
          filter: [{ exists: { field: 'is_complete' } }],
        },
      });
  });

  it('negates not_in as the must_not of the whole terms set', () => {
    expect(buildAdvancedBrowseFilter('samples', group([cond('biome', 'not_in', ['soil', 'marine'])])))
      .toEqual({
        bool: {
          must_not: [{
            bool: {
              should: [
                { term: { primary_biome: { value: 'soil', case_insensitive: true } } },
                { term: { primary_biome: { value: 'marine', case_insensitive: true } } },
              ],
              minimum_should_match: 1,
            },
          }],
          filter: [{ exists: { field: 'primary_biome' } }],
        },
      });
  });

  it('composes into a group beside a positive condition', () => {
    // `name` only has to be a negatable keyword field.
    expect(buildAdvancedBrowseFilter('gcfs', group([
      cond('memberBgcCount', 'gte', 10),
      cond('name', 'not_equals', 'GCF-000001'),
    ]))).toEqual({
      bool: {
        filter: [
          { range: { member_bgc_count: { gte: 10 } } },
          {
            bool: {
              must_not: [{ term: { gcf_name: { value: 'GCF-000001', case_insensitive: true } } }],
              filter: [{ exists: { field: 'gcf_name' } }],
            },
          },
        ],
      },
    });
  });
});

describe('sourceType stays case-SENSITIVE', () => {
  // SQL is an exact, case-sensitive `&&` overlap; a ci clause would answer a wider question.
  it('emits no case_insensitive key', () => {
    expect(buildAdvancedBrowseFilter('samples', group([cond('sourceType', 'equals', 'environmental')])))
      .toEqual({ term: { source_types: 'environmental' } });
    expect(buildAdvancedBrowseFilter('samples', group([cond('sourceType', 'in', ['environmental', 'host'])])))
      .toEqual({ terms: { source_types: ['environmental', 'host'] } });
  });

  it('while a sibling keyword field in the same entity does carry it', () => {
    expect(buildAdvancedBrowseFilter('samples', group([cond('biome', 'equals', 'soil')])))
      .toEqual({ term: { primary_biome: { value: 'soil', case_insensitive: true } } });
  });

  it('stays case-sensitive when NEGATED as well', () => {
    // SQL's negative is still an exact, case-sensitive overlap.
    expect(buildAdvancedBrowseFilter('samples', group([cond('sourceType', 'not_in', ['environmental', 'host'])])))
      .toEqual({ bool: { must_not: [{ terms: { source_types: ['environmental', 'host'] } }] } });
  });

  it('carries NO exists guard, unlike every other negative', () => {
    // SQL COALESCEs to an empty array and returns a sample with none, while OpenSearch
    // reports an empty array as missing, so an exists guard would drop it.
    const q = buildAdvancedBrowseFilter('samples', group([cond('sourceType', 'not_equals', 'environmental')]));
    expect(q).toEqual({ bool: { must_not: [{ term: { source_types: 'environmental' } }] } });
    expect(JSON.stringify(q)).not.toContain('exists');
  });

  it('refuses the substring operators, which `&&` cannot express', () => {
    // SQL answers `sourceType contains 'envir'` as an exact match on the literal
    // "envir" (no rows); a ci wildcard would match "environmental".
    expect(supportsAdvancedBrowse('samples', group([cond('sourceType', 'contains', 'envir')]))).toBe(false);
  });
});

/** UI fields the browse index cannot serve, with the reason. A new UI field must be listed here or mapped. */
const DELIBERATELY_UNMAPPED: Record<BrowseEntity, string[]> = {
  // sample_labels prefers external_id, so `name` is not indexed; serving this from
  // sample_labels would silently narrow the answer.
  bgcs: ['sample'],
  // SQL also matches host_taxid::text, and a wildcard cannot run on the index's
  // `host_taxid: long`. Matching only host_scientific_name would NARROW it.
  samples: ['host'],
  gcfs: [],
};

/** Browse entries with no UI field, kept because the SQL resolver honours them. */
const RESOLVER_ALIASES: Record<BrowseEntity, string[]> = {
  bgcs: [],
  samples: [],
  // `case 'avgScore': case 'avgDistance':` in buildGcfAdvancedCondition.
  gcfs: ['avgDistance'],
};

const UI_CATALOGS: Record<BrowseEntity, { id: string }[]> = {
  bgcs: bgcFilterFields,
  samples: sampleFilterFields,
  gcfs: gcfFilterFields,
};

const ENTITIES: BrowseEntity[] = ['bgcs', 'samples', 'gcfs'];

describe.each(ENTITIES)('%s catalog exhaustiveness', (entity) => {
  const browseIds = browseAdvancedFields(entity).map((f) => f.id);
  const uiIds = UI_CATALOGS[entity].map((f) => f.id);

  it('has no browse entry the UI cannot produce', () => {
    const orphans = browseIds.filter(
      (id) => !uiIds.includes(id) && !RESOLVER_ALIASES[entity].includes(id),
    );
    expect(orphans).toEqual([]);
  });

  it('maps every UI field, or names it deliberately unmapped', () => {
    const undecided = uiIds.filter(
      (id) => !browseIds.includes(id) && !DELIBERATELY_UNMAPPED[entity].includes(id),
    );
    expect(undecided).toEqual([]);
  });

  it('does not list a field as unmapped while also mapping it', () => {
    expect(DELIBERATELY_UNMAPPED[entity].filter((id) => browseIds.includes(id))).toEqual([]);
  });

  it('has no duplicate ids', () => {
    expect(new Set(browseIds).size).toBe(browseIds.length);
  });
});

/**
 * Index fields mapped as a number, read off the index mappings. `case_insensitive` on
 * a numerically-mapped field 400s the whole request, so the declared kinds must agree.
 */
const NUMERIC_INDEX_FIELDS: Record<BrowseEntity, string[]> = {
  bgcs: ['length', 'num_cds_features', 'distance'],
  samples: [
    'assembly_count', 'bgc_count', 'latitude', 'longitude',
    'gcf_count', 'clustered_bgc_count', 'unclustered_bgc_count',
  ],
  gcfs: [
    'member_bgc_count', 'assembly_count', 'avg_distance',
    'complete_bgc_count', 'unique_taxa_count', 'unique_product_categories',
    'study_count', 'max_pct_l1', 'max_pct_l3', 'dom_phylum_pct',
  ],
};

describe.each(ENTITIES)('%s catalog agrees with the index mapping', (entity) => {
  const targetsOf = (f: { id: string; queryField?: string; queryFields?: string[] }) =>
    f.queryFields ?? [f.queryField ?? f.id];

  it('declares os: number for exactly the numerically-mapped fields', () => {
    for (const field of browseAdvancedFields(entity)) {
      for (const target of targetsOf(field)) {
        const numeric = NUMERIC_INDEX_FIELDS[entity].includes(target);
        expect(
          field.os === 'number',
          `${entity}.${field.id} -> ${target} is os:${field.os} but the index maps it as `
          + `${numeric ? 'a number' : 'a string'}`,
        ).toBe(numeric);
      }
    }
  });

  it('every field declares an explicit os kind', () => {
    // Without one, kindOf() infers from the UI `type`: a `text` field becomes
    // `wildcard`, which cannot answer `in` at all.
    for (const field of browseAdvancedFields(entity)) {
      expect(field.os, `${entity}.${field.id}`).toBeDefined();
    }
  });

  it('sets `hierarchical` on nothing (D3a)', () => {
    // It routes in/not_in to a subtree match; the SQL forms are plain ILIKEs with
    // no subtree semantics.
    expect(browseAdvancedFields(entity).filter((f) => f.hierarchical)).toEqual([]);
  });
});

/** Snapshot of every mapped field x positive operator, so widening the gate cannot move a clause unnoticed. */
const CORPUS_OPERATORS: FilterOperator[] = [
  'equals', 'gt', 'gte', 'lt', 'lte', 'between', 'contains', 'starts_with', 'ends_with', 'in',
];

const corpusValue = (def: { id: string; os?: string }, operator: FilterOperator) => {
  if (def.id === 'completeness') return 'complete';
  // A whitelisted select: 'alpha' would record only its refusal, not the clause.
  if (def.id === 'familyClass') return operator === 'in' ? ['seed', 'fragmented'] : 'seed';
  if (def.os === 'number') return operator === 'between' ? [10, 20] : 42;
  return operator === 'in' ? ['alpha', 'beta'] : 'alpha';
};

describe('positive operators are byte-identical to d377936', () => {
  it('emits the same clause for every field x positive operator', () => {
    const corpus: Record<string, string> = {};
    for (const entity of ['bgcs', 'samples', 'gcfs'] as BrowseEntity[]) {
      for (const def of browseAdvancedFields(entity)) {
        for (const operator of CORPUS_OPERATORS) {
          const key = `${entity}.${def.id}.${operator}`;
          try {
            // One snapshot line per clause, so a diff names what moved.
            corpus[key] = JSON.stringify(buildAdvancedBrowseFilter(
              entity, group([cond(def.id, operator, corpusValue(def, operator) as never)]),
            ));
          } catch (error) {
            const reasons = (error as UnhonourableQueryError).conditions?.map((c) => c.reason);
            corpus[key] = `THROWS ${reasons?.join(',') ?? 'unknown'}`;
          }
        }
      }
    }
    expect(corpus).toMatchSnapshot();
  });
});
