import { FamilyClassFilterError } from '@/lib/gcf/family-class';
import { describe, expect, it } from 'vitest';
import {
  MalformedFilterPayloadError, serializeFilterGroup, type FilterCondition, type FilterGroup,
  type FilterOperator,
} from '@/lib/filters/types';
import { UnhonourableQueryError } from '@/lib/filters/unhonourable-query';
import {
  buildBrowseFilters, buildBrowseSearchRequest, PRODUCT_CATEGORY_VALUES, supportsBrowseSearch,
  type BrowseEntity,
} from './browse-query';

describe('buildBrowseSearchRequest', () => {
  it('builds sample keyword, range, and deterministic sort clauses', () => {
    const request = buildBrowseSearchRequest('samples', new URLSearchParams({
      search: 'marine',
      latMin: '10',
      latMax: '20',
      sourceType: 'environmental',
      sortField: 'bgcs',
      sortOrder: 'desc',
      limit: '50',
      offset: '100',
    }));

    expect(request).toMatchObject({
      from: 100,
      size: 50,
      sort: [
        { bgc_count: { order: 'desc' } },
        { sample_id: { order: 'asc' } },
      ],
      query: {
        bool: {
          filter: expect.arrayContaining([
            { range: { latitude: { gte: 10, lte: 20 } } },
            { terms: { source_types: ['environmental'] } },
          ]),
        },
      },
    });
  });

  it('sorts and ranges samples on the per-sample GCF count', () => {
    const request = buildBrowseSearchRequest('samples', new URLSearchParams({
      gcfsMin: '1000',
      sortField: 'gcfs',
      sortOrder: 'desc',
    }));

    expect(request).toMatchObject({
      sort: [
        { gcf_count: { order: 'desc' } },
        { sample_id: { order: 'asc' } },
      ],
      query: {
        bool: {
          filter: expect.arrayContaining([
            { range: { gcf_count: { gte: 1000 } } },
          ]),
        },
      },
    });
  });

  it('sorts and ranges genomes on their CheckM2 values and filters the MIMAG label', () => {
    const request = buildBrowseSearchRequest('samples', new URLSearchParams({
      completenessMin: '90',
      contaminationMax: '2.5',
      genomeQuality: 'high',
      sortField: 'contamination',
      sortOrder: 'asc',
    }));

    expect(request).toMatchObject({
      sort: [
        { checkm_contamination: { order: 'asc' } },
        { sample_id: { order: 'asc' } },
      ],
      query: {
        bool: {
          filter: expect.arrayContaining([
            { range: { checkm_completeness: { gte: 90 } } },
            { range: { checkm_contamination: { lte: 2.5 } } },
            { term: { genome_quality: 'high' } },
          ]),
        },
      },
    });
  });

  it('uses wildcard clauses for existing ILIKE-style BGC filters', () => {
    const request = buildBrowseSearchRequest('bgcs', new URLSearchParams({
      class: 'NRPS',
      sample: 'MGYS',
    }));

    expect(request.query).toMatchObject({
      bool: {
        filter: expect.arrayContaining([
          { term: { product_category: 'NRPS' } },
          { wildcard: { sample_labels: { value: '*MGYS*', case_insensitive: true } } },
        ]),
      },
    });
  });

  it('keeps unsupported sample semantics on PostgreSQL', () => {
    expect(supportsBrowseSearch('samples', new URLSearchParams({ host: 'Homo sapiens' }))).toBe(false);
    expect(supportsBrowseSearch('samples', new URLSearchParams({ environmentText: 'soil' }))).toBe(false);
    expect(supportsBrowseSearch('samples', new URLSearchParams({ environment: 'marine' }))).toBe(true);
  });

  it('serves the per-row decorations from the index', () => {
    for (const key of ['includeGtdbAccession', 'includeTaxonomy', 'includeStudyLinks']) {
      expect(supportsBrowseSearch('samples', new URLSearchParams({ [key]: '1' })), key).toBe(true);
    }
  });

  it('searches pet_name alongside the other GCF text fields', () => {
    const request = buildBrowseSearchRequest('gcfs', new URLSearchParams({ search: 'otter' }));

    // The alias must be a real OR branch of the search clause, not merely present
    // somewhere in the serialised request.
    expect(request.query).toMatchObject({
      bool: {
        filter: expect.arrayContaining([
          {
            bool: {
              minimum_should_match: 1,
              should: expect.arrayContaining([
                { wildcard: { pet_name: { value: '*otter*', case_insensitive: true } } },
                { wildcard: { gcf_name: { value: '*otter*', case_insensitive: true } } },
              ]),
            },
          },
        ]),
      },
    });
  });

  it('uses OR semantics for multiple sample source types', () => {
    const request = buildBrowseSearchRequest('samples', new URLSearchParams([
      ['sourceType', 'environmental'],
      ['sourceType', 'cultured'],
    ]));
    expect(request.query).toMatchObject({
      bool: { filter: expect.arrayContaining([{ terms: { source_types: ['environmental', 'cultured'] } }]) },
    });
  });

  it('matches a study exactly on studyKey and loosely on study', () => {
    const exact = buildBrowseSearchRequest('samples', new URLSearchParams({
      studyKey: 'Khdhiri_2017_soil',
    }));
    expect(exact.query).toMatchObject({
      bool: { filter: expect.arrayContaining([{ term: { study_keys: 'Khdhiri_2017_soil' } }]) },
    });

    const loose = buildBrowseSearchRequest('samples', new URLSearchParams({ study: 'soil' }));
    expect(JSON.stringify(loose.query)).toContain('study_titles');
    expect(JSON.stringify(loose.query)).not.toContain('study_keys');
  });

  it('keeps both study filters when given together', () => {
    const request = buildBrowseSearchRequest('samples', new URLSearchParams({
      study: 'soil',
      studyKey: 'Khdhiri_2017_soil',
    }));
    const filters = JSON.stringify(request.query);
    expect(filters).toContain('study_titles');
    expect(filters).toContain('study_keys');
  });
});

describe('sort names that are Object.prototype properties', () => {
  // `sortMap[name] ?? fallback` would answer `constructor` with Object itself.
  it.each(['samples', 'gcfs', 'bgcs'] as const)('%s: falls back like any unknown name', (entity) => {
    const sortOf = (sortField: string) =>
      buildBrowseSearchRequest(entity, new URLSearchParams({ sortField, sortOrder: 'desc' })).sort;
    for (const name of ['constructor', '__proto__', 'toString', 'hasOwnProperty']) {
      expect(sortOf(name)).toEqual(sortOf('notARealField'));
    }
  });
});

describe('supportsBrowseSearch', () => {
  it('forces the browse path for studyKey', () => {
    expect(supportsBrowseSearch('samples', new URLSearchParams({ studyKey: 'X' }))).toBe(true);
  });

  it('forces browse for studyKey even alongside an otherwise unsupported parameter', () => {
    // `host` alone drops to SQL, so the studyKey check has to come first.
    const params = new URLSearchParams({ studyKey: 'X', host: 'Homo sapiens' });
    expect(supportsBrowseSearch('samples', params)).toBe(true);
    expect(supportsBrowseSearch('samples', new URLSearchParams({ host: 'Homo sapiens' }))).toBe(false);
  });
});

describe('bgcs multi-field sort', () => {
  // The /bgcs table's default ordering; on SQL it can time out.
  const defaultSort = () =>
    new URLSearchParams({ sortFields: 'length,completeness', sortOrders: 'desc,desc' });

  it('routes the default multi-sort to OpenSearch', () => {
    expect(supportsBrowseSearch('bgcs', defaultSort())).toBe(true);
  });

  it('still routes it to OpenSearch alongside a sample filter', () => {
    const params = defaultSort();
    params.set('sampleId', '2c709c2f-8507-5a02-8778-bed54e2296b3');
    expect(supportsBrowseSearch('bgcs', params)).toBe(true);
  });

  it('maps each field through bgcSort and appends the id tiebreaker', () => {
    expect(buildBrowseSearchRequest('bgcs', defaultSort()).sort).toEqual([
      { length: { order: 'desc' } },
      { is_complete: { order: 'desc' } },
      { bgc_id: { order: 'asc' } },
    ]);
  });

  it('honours per-field order and defaults a missing one to desc', () => {
    const params = new URLSearchParams({ sortFields: 'length,genes', sortOrders: 'asc' });
    expect(buildBrowseSearchRequest('bgcs', params).sort).toEqual([
      { length: { order: 'asc' } },
      { num_cds_features: { order: 'desc' } },
      { bgc_id: { order: 'asc' } },
    ]);
  });

  it('keeps the per-field bans, so a banned key in a MULTI sort still falls back', () => {
    // Banned fields must not sneak through via sortFields.
    for (const banned of ['productType', 'productCategory']) {
      const params = new URLSearchParams({ sortFields: `length,${banned}`, sortOrders: 'desc,desc' });
      expect(supportsBrowseSearch('bgcs', params)).toBe(false);
    }
  });

  it('sorts taxonomy by the precomputed coalesced key, not by species', () => {
    expect(buildBrowseSearchRequest('bgcs', new URLSearchParams({ sortField: 'taxonomy' })).sort)
      .toEqual([{ taxonomy_sort: { order: 'desc' } }, { bgc_id: { order: 'asc' } }]);
    expect(supportsBrowseSearch('bgcs', new URLSearchParams({ sortField: 'taxonomy' }))).toBe(true);
  });

  it('serves biome, whose COALESCE is a no-op on this corpus', () => {
    // Equivalent only while documents lacking resolved_biome_level_1 carry none of the
    // COALESCE fallbacks; if that changes, this sort must be banned again.
    for (const params of [
      new URLSearchParams({ sortField: 'biome' }),
      new URLSearchParams({ sortFields: 'length,biome', sortOrders: 'desc,desc' }),
    ]) {
      expect(supportsBrowseSearch('bgcs', params)).toBe(true);
    }
  });

  it('falls back to the single-sort shape when sortFields is empty', () => {
    const params = new URLSearchParams({ sortFields: '', sortField: 'genes', sortOrder: 'asc' });
    expect(buildBrowseSearchRequest('bgcs', params).sort).toEqual([
      { num_cds_features: { order: 'asc' } },
      { bgc_id: { order: 'asc' } },
    ]);
  });
});

describe('bgcs ?gcf= matches the family name, not only the id', () => {
  const filtersFor = (gcf: string) => {
    const req = buildBrowseSearchRequest('bgcs', new URLSearchParams({ gcf })) as {
      query: { bool?: { filter: unknown[] } };
    };
    // No filter at all is a bare match_all, with no bool to read.
    return req.query.bool?.filter ?? [];
  };

  it('ORs the term across gcf_id and gcf_name', () => {
    expect(filtersFor('GCF-000080')).toContainEqual({
      bool: {
        should: [
          { wildcard: { gcf_id: { value: '*GCF-000080*', case_insensitive: true } } },
          { wildcard: { gcf_name: { value: '*GCF-000080*', case_insensitive: true } } },
        ],
        minimum_should_match: 1,
      },
    });
  });

  it('works the same for a fragmented-tier name', () => {
    const should = (filtersFor('GCF-F-415858')[1] as { bool: { should: unknown[] } })?.bool?.should
      ?? (filtersFor('GCF-F-415858')[0] as { bool: { should: unknown[] } }).bool.should;
    expect(should).toContainEqual(
      { wildcard: { gcf_name: { value: '*GCF-F-415858*', case_insensitive: true } } }
    );
  });

  it('adds no gcf clause when the parameter is absent or blank', () => {
    const j = JSON.stringify(filtersFor('   '));
    expect(j).not.toContain('gcf_name');
  });
});

describe('samples ?goldBucket= is served by OpenSearch', () => {
  it('routes to the index and filters by the same path prefix as bgcs', () => {
    expect(supportsBrowseSearch('samples', new URLSearchParams({ goldBucket: 'marine' }))).toBe(true);
    const req = buildBrowseSearchRequest('samples', new URLSearchParams({ goldBucket: 'marine' })) as {
      query: { bool: { filter: unknown[] } };
    };
    expect(req.query.bool.filter).toContainEqual(
      { prefix: { gold_ecosystem_path: 'Environmental:Aquatic:Marine' } },
    );
  });
});

describe('bgcs ?goldBucket= is served by OpenSearch', () => {
  const filtersFor = (params: Record<string, string>) => {
    const req = buildBrowseSearchRequest('bgcs', new URLSearchParams(params)) as {
      query: { bool: { filter: unknown[] } };
    };
    return req.query.bool.filter;
  };

  it('no longer forces the SQL fallback', () => {
    expect(supportsBrowseSearch('bgcs', new URLSearchParams({ goldBucket: 'marine' }))).toBe(true);
    expect(supportsBrowseSearch('bgcs', new URLSearchParams({ goldBucket: 'marine', gcf: 'GCF-000080' }))).toBe(true);
  });

  it('neither does a lat-lon box: bgc_browse carries the sample coordinates', () => {
    expect(supportsBrowseSearch('bgcs', new URLSearchParams({ latMin: '-10' }))).toBe(true);
    expect(supportsBrowseSearch('bgcs', new URLSearchParams({
      latMin: '47.3', latMax: '55.1', lonMin: '5.9', lonMax: '15', goldBucket: 'soil-terrestrial',
    }))).toBe(true);
  });

  it('turns a box into inclusive ranges on the one sample point', () => {
    expect(filtersFor({ latMin: '47.3', latMax: '55.1', lonMin: '5.9', lonMax: '15' })).toEqual(
      expect.arrayContaining([
        { range: { latitude: { gte: 47.3, lte: 55.1 } } },
        { range: { longitude: { gte: 5.9, lte: 15 } } },
      ]),
    );
  });

  it('keeps each bound on its own, as the SQL route parses them', () => {
    // An unreadable bound is dropped (as SQL's parseNumber) while the readable one applies.
    const filters = filtersFor({ latMin: '54', lonMin: 'west', lonMax: '10' });
    expect(filters).toContainEqual({ range: { latitude: { gte: 54 } } });
    expect(filters).toContainEqual({ range: { longitude: { lte: 10 } } });
    // Out-of-range longitudes are compared as given, as SQL compares them.
    expect(filtersFor({ lonMin: '-200', lonMax: '200' }))
      .toContainEqual({ range: { longitude: { gte: -200, lte: 200 } } });
  });

  it('maps a simple bucket to a path prefix', () => {
    expect(filtersFor({ goldBucket: 'marine' })).toContainEqual(
      { prefix: { gold_ecosystem_path: 'Environmental:Aquatic:Marine' } }
    );
    expect(filtersFor({ goldBucket: 'engineered' })).toContainEqual(
      { prefix: { gold_ecosystem_path: 'Engineered' } }
    );
  });

  it('host-animal is Host-associated minus Plants, as in SQL', () => {
    expect(filtersFor({ goldBucket: 'host-animal' })).toContainEqual({
      bool: {
        must: [{ prefix: { gold_ecosystem_path: 'Host-associated' } }],
        must_not: [{ prefix: { gold_ecosystem_path: 'Host-associated:Plants' } }],
      },
    });
  });

  it('other-environmental excludes the three specific environmental buckets', () => {
    const f = filtersFor({ goldBucket: 'other-environmental' }).find(
      (x): x is { bool: { must: unknown[]; must_not: unknown[] } } =>
        Array.isArray((x as { bool?: { must_not?: unknown[] } })?.bool?.must_not)
        && ((x as { bool: { must_not: unknown[] } }).bool.must_not.length === 3)
    )!;
    expect(f.bool.must).toEqual([{ prefix: { gold_ecosystem_path: 'Environmental' } }]);
    expect(f.bool.must_not).toEqual([
      { prefix: { gold_ecosystem_path: 'Environmental:Aquatic:Marine' } },
      { prefix: { gold_ecosystem_path: 'Environmental:Aquatic:Freshwater' } },
      { prefix: { gold_ecosystem_path: 'Environmental:Terrestrial' } },
    ]);
  });

  it('unknown means missing or empty, matching `IS NULL OR = \'\'`', () => {
    expect(filtersFor({ goldBucket: 'unknown' })).toContainEqual({
      bool: {
        should: [
          { bool: { must_not: [{ exists: { field: 'gold_ecosystem_path' } }] } },
          { term: { gold_ecosystem_path: '' } },
        ],
        minimum_should_match: 1,
      },
    });
  });

  it('an unrecognised bucket matches nothing rather than everything', () => {
    expect(filtersFor({ goldBucket: 'not-a-bucket' })).toContainEqual(
      { bool: { must_not: [{ match_all: {} }] } }
    );
  });
});

describe('product vocabulary: ?category= / ?product= and their old names', () => {
  const filtersOf = (entity: 'bgcs' | 'gcfs', params: Record<string, string>) => {
    const request = buildBrowseSearchRequest(entity, new URLSearchParams(params)) as {
      query: { bool: { filter: unknown[] } };
    };
    return request.query.bool.filter;
  };

  it('accepts ?category= and the older ?class= identically on /bgcs', () => {
    expect(filtersOf('bgcs', { category: 'NRPS' }))
      .toEqual(filtersOf('bgcs', { class: 'NRPS' }));
    expect(filtersOf('bgcs', { category: 'NRPS' }))
      .toContainEqual({ term: { product_category: 'NRPS' } });
  });

  it('accepts ?category= and the older ?productType= identically on /gcfs', () => {
    // Both match product_categories; ?productType= is the older name.
    expect(filtersOf('gcfs', { category: 'terpene' }))
      .toEqual(filtersOf('gcfs', { productType: 'terpene' }));
  });

  it('prefers the new name when a caller sends both', () => {
    expect(filtersOf('bgcs', { category: 'PKS', class: 'RiPP' }))
      .toContainEqual({ term: { product_category: 'PKS' } });
  });

  it('searches product_type ALONE for ?product=, never product_category', () => {
    const filters = filtersOf('bgcs', { product: 'lassopeptide' });
    expect(filters).toContainEqual({
      wildcard: { product_type: { value: '*lassopeptide*', case_insensitive: true } },
    });
    expect(JSON.stringify(filters)).not.toContain('product_category');
  });

  it('still accepts the older ?typeText=, with the same narrowed meaning', () => {
    expect(filtersOf('bgcs', { typeText: 'T1PKS' }))
      .toEqual(filtersOf('bgcs', { product: 'T1PKS' }));
  });
});

describe('?class= on /bgcs', () => {
  const filtersOf = (params: Record<string, string>) => {
    const request = buildBrowseSearchRequest('bgcs', new URLSearchParams(params)) as {
      query: { bool: { filter: unknown[] } };
    };
    return request.query.bool.filter;
  };

  it('matches one of the six stored categories with a term query', () => {
    expect(filtersOf({ class: 'RiPP' })).toContainEqual({ term: { product_category: 'RiPP' } });
  });

  it('turns Hybrid into "at least two distinct categories"', () => {
    expect(filtersOf({ class: 'Hybrid' })).toContainEqual({
      bool: {
        should: PRODUCT_CATEGORY_VALUES.map((c) => ({ term: { product_category: c } })),
        minimum_should_match: 2,
      },
    });
  });

  it('never emits a term query for the derived Hybrid label', () => {
    expect(filtersOf({ class: 'Hybrid' }))
      .not.toContainEqual({ term: { product_category: 'Hybrid' } });
  });
});
describe('?advancedFilters= is served from the index', () => {
  // Pins the wiring, not the mapping (browse-advanced.test.ts owns that).
  let seq = 0;
  const cond = (
    field: string, operator: FilterOperator, value: FilterCondition['value'],
  ): FilterCondition => ({ id: `c${seq += 1}`, field, operator, value });
  const encode = (...conditions: FilterCondition[]): string => serializeFilterGroup({
    id: `g${seq += 1}`, operator: 'AND', conditions, groups: [],
  } satisfies FilterGroup);
  const params = (extra: Record<string, string>, ...conditions: FilterCondition[]) =>
    new URLSearchParams({ ...extra, advancedFilters: encode(...conditions) });

  it('admits a condition the index can answer', () => {
    expect(supportsBrowseSearch('bgcs', params({}, cond('length', 'gte', 10000)))).toBe(true);
  });

  it('serves every multi-valued GCF negative: "no value matches" on both backends', () => {
    for (const [field, value] of [
      ['taxonomy', 'Streptomyces'], ['biome', 'Marine'], ['productType', 'NRPS'], ['productClass', 'T1PKS'],
    ]) {
      expect(supportsBrowseSearch('gcfs', params({}, cond(field, 'not_contains', value)))).toBe(true);
    }
  });

  it('refuses a negative operator, where the two backends genuinely disagree', () => {
    expect(supportsBrowseSearch('bgcs', params({}, cond('productType', 'not_contains', 'PKS')))).toBe(false);
  });

  it('refuses an unreadable payload WITHOUT throwing', () => {
    // A throwing gate is a 500; on the SQL path parseAdvancedFilterParam answers 400.
    const bad = new URLSearchParams({ advancedFilters: 'not-base64!!' });
    expect(() => supportsBrowseSearch('bgcs', bad)).not.toThrow();
    expect(supportsBrowseSearch('bgcs', bad)).toBe(false);
    expect(supportsBrowseSearch('samples', bad)).toBe(false);
    expect(supportsBrowseSearch('gcfs', bad)).toBe(false);
    const notAGroup = new URLSearchParams({
      advancedFilters: Buffer.from(JSON.stringify({ hello: 1 })).toString('base64'),
    });
    expect(() => supportsBrowseSearch('bgcs', notAGroup)).not.toThrow();
    expect(supportsBrowseSearch('bgcs', notAGroup)).toBe(false);
    expect(() => supportsBrowseSearch('bgcs', params({}, cond('nonsense', 'contains', 'x')))).not.toThrow();
  });

  it('puts the clause in the request the table runs', () => {
    const request = buildBrowseSearchRequest('bgcs', params({}, cond('length', 'gte', 10000)));
    expect(request.query).toMatchObject({
      bool: { filter: expect.arrayContaining([{ range: { length: { gte: 10000 } } }]) },
    });
  });

  it('serves a lat-lon box alongside a servable advanced filter', () => {
    expect(supportsBrowseSearch('bgcs', params({ latMin: '-10' }, cond('length', 'gte', 10000)))).toBe(true);
  });

  it('keeps the studyKey and study force-trues ahead of the advanced check', () => {
    // These parameters have no SQL equivalent, so a fallback would list everything.
    expect(supportsBrowseSearch('samples', params({ studyKey: 'X' }, cond('host', 'contains', 'Homo')))).toBe(true);
    expect(supportsBrowseSearch('gcfs', params({ study: 'X' }, cond('taxonomy', 'not_contains', 'Streptomyces')))).toBe(true);
    // Without the study parameter the same filter falls back.
    expect(supportsBrowseSearch('samples', params({}, cond('host', 'contains', 'Homo')))).toBe(false);
  });

  it('refuses the unservable filter the force-true admitted, at the builder', () => {
    // Known conflict: forced to the index, the builder raises a 400, which beats
    // listing every sample as one study's at HTTP 200.
    expect(() => buildBrowseFilters('samples', params({ studyKey: 'X' }, cond('host', 'contains', 'Homo'))))
      .toThrow(UnhonourableQueryError);
  });

  it('raises on a malformed payload from the BUILDER, the opposite of the gate', () => {
    expect(() => buildBrowseFilters('bgcs', new URLSearchParams({ advancedFilters: 'not-base64!!' })))
      .toThrow(MalformedFilterPayloadError);
  });

  it('ignores a blank-valued condition on both sides', () => {
    // Emitted the moment a field is picked, before any value is typed.
    const blank = params({}, cond('length', 'gte', ''));
    expect(supportsBrowseSearch('bgcs', blank)).toBe(true);
    expect(JSON.stringify(buildBrowseFilters('bgcs', blank))).not.toContain('"length"');
    expect(buildBrowseFilters('bgcs', new URLSearchParams()))
      .toEqual(buildBrowseFilters('bgcs', new URLSearchParams({ advancedFilters: '' })));
  });

  it('is the clause the aggregation panels get, since they build from buildBrowseFilters', () => {
    // The aggregation routes gate on supportsBrowseSearch, then call buildBrowseFilters.
    const bgcs = params({}, cond('length', 'gte', 10000));
    expect(supportsBrowseSearch('bgcs', bgcs)).toBe(true);
    expect(buildBrowseFilters('bgcs', bgcs)).toContainEqual({ range: { length: { gte: 10000 } } });

    const gcfs = params({}, cond('memberBgcCount', 'gte', 5));
    expect(supportsBrowseSearch('gcfs', gcfs)).toBe(true);
    expect(buildBrowseFilters('gcfs', gcfs)).toContainEqual({ range: { member_bgc_count: { gte: 5 } } });
  });
});

describe('gcfs ?biome= is served from biome_terms', () => {
  it('admits the parameter', () => {
    expect(supportsBrowseSearch('gcfs', new URLSearchParams({ biome: 'marine' }))).toBe(true);
  });

  it('matches the member biome terms, not the GOLD distribution fields', () => {
    const { query } = buildBrowseSearchRequest('gcfs', new URLSearchParams({ biome: 'marine' }));
    const filters = (query as { bool: { filter: unknown[] } }).bool.filter;
    expect(filters).toContainEqual({
      wildcard: { biome_terms: { value: '*marine*', case_insensitive: true } },
    });
    expect(JSON.stringify(filters)).not.toContain('biome_distribution');
  });

  it('adds nothing for a blank value', () => {
    const { query } = buildBrowseSearchRequest('gcfs', new URLSearchParams({ biome: '  ' }));
    expect(JSON.stringify(query)).not.toContain('biome_terms');
  });
});

describe('gcfs biomeDistribution / dominantBiome sorts are served', () => {
  const sortOf = (params: Record<string, string>) =>
    (buildBrowseSearchRequest('gcfs', new URLSearchParams(params)) as { sort: unknown[] }).sort;

  it.each(['biomeDistribution', 'dominantBiome'])('admits %s', (sortField) => {
    expect(supportsBrowseSearch('gcfs', new URLSearchParams({ sortField }))).toBe(true);
  });

  it.each(['biomeDistribution', 'dominantBiome'])('%s orders by max_pct_l1 by default', (sortField) => {
    expect(sortOf({ sortField })).toEqual([
      { max_pct_l1: { order: 'asc', missing: '_last' } },
      { gcf_id: { order: 'asc' } },
    ]);
  });

  it.each([1, 2, 3, 4, 5])('follows ?ecosystemLevel=%s onto its own column', (level) => {
    expect(sortOf({ sortField: 'dominantBiome', ecosystemLevel: String(level) })).toEqual([
      { [`max_pct_l${level}`]: { order: 'asc', missing: '_last' } },
      { gcf_id: { order: 'asc' } },
    ]);
  });

  it('clamps ?ecosystemLevel exactly as api/gcfs/route.ts does', () => {
    for (const [raw, level] of [['0', 1], ['-3', 1], ['9', 5], ['', 1], ['abc', 1]] as const) {
      expect(sortOf({ sortField: 'dominantBiome', ecosystemLevel: raw })).toEqual([
        { [`max_pct_l${level}`]: { order: 'asc', missing: '_last' } },
        { gcf_id: { order: 'asc' } },
      ]);
    }
  });

  it('keeps missing:_last on DESC too', () => {
    expect(sortOf({ sortField: 'biomeDistribution', sortOrder: 'desc' })).toEqual([
      { max_pct_l1: { order: 'desc', missing: '_last' } },
      { gcf_id: { order: 'asc' } },
    ]);
  });

  it('refuses a level SQL itself cannot interpolate', () => {
    expect(supportsBrowseSearch('gcfs', new URLSearchParams({
      sortField: 'dominantBiome', ecosystemLevel: '2.5',
    }))).toBe(false);
    expect(supportsBrowseSearch('gcfs', new URLSearchParams({
      sortField: 'name', ecosystemLevel: '2.5',
    }))).toBe(true);
  });

  it('resolves the same way inside ?sortFields', () => {
    expect(sortOf({ sortFields: 'dominantBiome', sortOrders: 'desc', ecosystemLevel: '3' })).toEqual([
      { max_pct_l3: { order: 'desc', missing: '_last' } },
      { gcf_id: { order: 'asc' } },
    ]);
  });

  it('leaves every other gcfs sort field untouched', () => {
    expect(sortOf({ sortField: 'memberCount', ecosystemLevel: '4' })).toEqual([
      { member_bgc_count: { order: 'asc' } },
      { gcf_id: { order: 'asc' } },
    ]);
  });
});

describe('the no-sort default must match the SQL path', () => {
  const sortOf = (entity: BrowseEntity, params: Record<string, string>) =>
    (buildBrowseSearchRequest(entity, new URLSearchParams(params)) as { sort: unknown[] }).sort;

  it('orders bgcs by length then completeness, like PostgreSQL does', () => {
    expect(sortOf('bgcs', {})).toEqual([
      { length: { order: 'desc' } },
      { is_complete: { order: 'desc' } },
      { bgc_id: { order: 'asc' } },
    ]);
  });

  it('still lets an explicit single sort win', () => {
    expect(sortOf('bgcs', { sortField: 'genes', sortOrder: 'asc' })).toEqual([
      { num_cds_features: { order: 'asc' } },
      { bgc_id: { order: 'asc' } },
    ]);
  });

  it('still lets an explicit multi sort win', () => {
    expect(sortOf('bgcs', { sortFields: 'genes', sortOrders: 'asc' })).toEqual([
      { num_cds_features: { order: 'asc' } },
      { bgc_id: { order: 'asc' } },
    ]);
  });

  it('orders unsorted gcfs ASCENDING, like /api/gcfs does', () => {
    expect(sortOf('gcfs', {})).toEqual([
      { gcf_name: { order: 'asc' } }, { gcf_id: { order: 'asc' } },
    ]);
  });

  it('still honours an explicit desc on gcfs', () => {
    expect(sortOf('gcfs', { sortOrder: 'desc' })).toEqual([
      { gcf_name: { order: 'desc' } }, { gcf_id: { order: 'asc' } },
    ]);
  });

  it('leaves the samples default alone', () => {
    // Only bgcs has a two-field SQL default to match.
    expect(sortOf('samples', {})).toEqual([
      { bgc_count: { order: 'desc' } }, { sample_id: { order: 'asc' } },
    ]);
  });
});

describe('?familyClass= on /gcfs', () => {
  const filtersOf = (params: Record<string, string>) =>
    (buildBrowseSearchRequest('gcfs', new URLSearchParams(params)) as {
      query: { bool: { filter: unknown[] } };
    }).query.bool.filter;

  it.each(['seed', 'fragmented'])('filters %s families by a keyword term', (value) => {
    expect(filtersOf({ familyClass: value })).toContainEqual({ term: { family_class: value } });
  });

  it('is case-insensitive in the URL and adds nothing when absent', () => {
    expect(filtersOf({ familyClass: 'Seed' })).toContainEqual({ term: { family_class: 'seed' } });
    expect(JSON.stringify(filtersOf({}))).not.toContain('family_class');
  });

  it('refuses an unknown tier rather than listing every family', () => {
    expect(() => filtersOf({ familyClass: 'novel' })).toThrow(FamilyClassFilterError);
  });

  it('sorts on the keyword field, ending on the gcf_id tiebreaker', () => {
    const sort = buildBrowseSearchRequest('gcfs', new URLSearchParams({ sortField: 'familyClass', sortOrder: 'asc' })).sort;
    expect(JSON.stringify(sort)).toContain('"family_class"');
    expect(sort).not.toEqual(
      buildBrowseSearchRequest('gcfs', new URLSearchParams({ sortField: 'notARealField', sortOrder: 'asc' })).sort,
    );
  });
});
