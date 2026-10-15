import { describe, it, expect } from 'vitest';
import {
  buildCandidateAggs, buildDefinedScope, buildPurityAggs, CANDIDATE_CAP,
} from '@/lib/opensearch/family-scope';
import { collectQueryFields } from '@/lib/opensearch/query';
import type { FilterFieldDefinition, FilterGroup } from '@/lib/filters/types';

const group = (conditions: { field: string; operator: string; value: unknown }[], groups: FilterGroup[] = []): FilterGroup => ({
  id: 'g', operator: 'AND', groups,
  conditions: conditions.map((c, i) => ({ id: `c${i}`, ...c })) as FilterGroup['conditions'],
});

const ARCTIC = group([{ field: 'latitude', operator: 'gt', value: '66.5' }]);
const ANTARCTIC = group([{ field: 'latitude', operator: 'lt', value: '-66.5' }]);

const FIELDS: FilterFieldDefinition[] = [
  { id: 'latitude', label: 'Latitude', type: 'number' },
  { id: 'gold_ecosystem', label: 'GOLD', type: 'select' },
  { id: 'tailoring', label: 'Tailoring', type: 'select', queryField: 'pfam' },
];

describe('collectQueryFields', () => {
  it('maps a virtual field onto the index field it actually queries', () => {
    expect(collectQueryFields(group([{ field: 'tailoring', operator: 'in', value: ['x'] }]), FIELDS))
      .toEqual(['pfam']);
  });

  it('drops unknown fields rather than inventing an exists clause for them', () => {
    expect(collectQueryFields(group([{ field: 'not_a_field', operator: 'in', value: ['x'] }]), FIELDS))
      .toEqual([]);
  });

  it('descends into nested groups and deduplicates', () => {
    const nested = group(
      [{ field: 'latitude', operator: 'gt', value: '1' }],
      [group([{ field: 'latitude', operator: 'lt', value: '2' }, { field: 'gold_ecosystem', operator: 'in', value: ['a'] }])],
    );
    expect(collectQueryFields(nested, FIELDS)).toEqual(['gold_ecosystem', 'latitude']);
  });
});

// A member with no latitude can neither support nor contradict a latitude claim, so it
// is in neither numerator nor denominator.
describe('buildDefinedScope', () => {
  it('scopes purity to members carrying the field the cohorts ask about', () => {
    expect(buildDefinedScope([ARCTIC, ANTARCTIC])).toEqual({
      bool: { filter: [{ exists: { field: 'latitude' } }] },
    });
  });

  it('requires every field when cohorts span more than one', () => {
    const scope = buildDefinedScope([ARCTIC, group([{ field: 'gold_ecosystem', operator: 'in', value: ['Environmental'] }])]);
    expect(scope).toEqual({
      bool: { filter: [{ exists: { field: 'gold_ecosystem' } }, { exists: { field: 'latitude' } }] },
    });
  });

  it('falls back to every member when no condition resolves to a field', () => {
    expect(buildDefinedScope([group([])])).toEqual({ match_all: {} });
  });
});

describe('buildCandidateAggs', () => {
  const aggs = buildCandidateAggs([{ term: { a: 1 } }, { term: { b: 2 } }], CANDIDATE_CAP) as {
    fam: { terms: Record<string, unknown>; aggs: Record<string, { filter?: unknown; bucket_selector?: { script: string } }> };
  };

  it('requires at least one member per cohort, which bounds the bucket count', () => {
    // Exact, not a heuristic: matching N cohorts takes N members in their union.
    expect(aggs.fam.terms.min_doc_count).toBe(2);
  });

  it('keeps only families present in EVERY cohort', () => {
    expect(aggs.fam.aggs.present.bucket_selector?.script).toBe('params.c0 > 0 && params.c1 > 0');
    expect(aggs.fam.aggs.c0.filter).toEqual({ term: { a: 1 } });
    expect(aggs.fam.aggs.c1.filter).toEqual({ term: { b: 2 } });
  });
});

// A 503 reads as "the search is broken", so the cap must stay under the cluster limit.
describe('candidate cap', () => {
  it('stays under the cluster bucket limit', () => {
    // search.max_buckets is 65,535 here; the narrow polar union never reached an
    // oversized cap, a broad union (marine + soil) did.
    expect(CANDIDATE_CAP).toBeLessThan(65_535);
  });
});

describe('buildPurityAggs', () => {
  const cohorts = [{ term: { a: 1 } }, { term: { b: 2 } }];
  const scope = { bool: { filter: [{ exists: { field: 'latitude' } }] } };
  const aggs = buildPurityAggs(cohorts, scope, 1, 10) as {
    fam: { aggs: Record<string, { filter?: unknown; bucket_selector?: { script: string } }> };
  };

  it('measures the numerator over the cohorts’ union', () => {
    expect(aggs.fam.aggs.inside.filter).toEqual({ bool: { should: cohorts, minimum_should_match: 1 } });
  });

  it('measures the denominator over the defined scope, not every member', () => {
    expect(aggs.fam.aggs.located.filter).toEqual(scope);
  });

  it('guards the division so a family with no located member cannot survive', () => {
    expect(aggs.fam.aggs.keep.bucket_selector?.script)
      .toBe('params.located > 0 && params.inside >= 1 * params.located');
  });

  it('carries a purity floor below 1 into the selector', () => {
    const loose = buildPurityAggs(cohorts, scope, 0.9, 10) as typeof aggs;
    expect(loose.fam.aggs.keep.bucket_selector?.script)
      .toBe('params.located > 0 && params.inside >= 0.9 * params.located');
  });

  it('does not wrap a single cohort in a pointless bool', () => {
    const one = buildPurityAggs([cohorts[0]], scope, 1, 10) as typeof aggs;
    expect(one.fam.aggs.inside.filter).toEqual(cohorts[0]);
  });
});
