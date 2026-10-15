// Family-level conditions for Property Search ("Return: GCFs"), which document filters
// cannot express: co-occurrence (a member above +66.5 AND one below -66.5) and
// exclusivity (the members the filter removed). Cohorts each must match at least once,
// plus a purity floor over their union, evaluated with bucket_selector in two passes.
import type { FilterGroup } from '@/lib/filters/types';
import { hasFilterRules } from '@/lib/filters/types';
import { bgcPropertyFilterFields } from '@/lib/filters/bgc-property-fields';
import { collectQueryFields } from '@/lib/opensearch/query';
import {
  buildQuery, hydrateEntities, osFetch, type EntityRow,
} from '@/lib/opensearch/client';
import {
  CANDIDATE_CAP, CANDIDATE_LIMIT, ENTITY_CAP, MAX_COHORTS, pageIsCapped, slicePage,
} from '@/lib/opensearch/entity-paging';

const INDEX = process.env.OPENSEARCH_INDEX || 'bgc_facets';
const GCF_BROWSE_INDEX = process.env.OPENSEARCH_GCF_BROWSE_INDEX || 'gcf_browse';

// Caps live in entity-paging so the client can quote them without bundling this module.
export { CANDIDATE_CAP, CANDIDATE_LIMIT, MAX_COHORTS } from '@/lib/opensearch/entity-paging';

export interface FamilyScopeRow extends EntityRow {
  /** Matching members per cohort, in the order the cohorts were given. */
  cohortCounts: number[];
  /** Members inside the cohorts' union — what `bgcCount` reports, ordered by. */
  inside: number;
  /** The purity denominator: members carrying a value for every field the cohorts query. */
  located: number;
  /** inside / located, 0..1. */
  purity: number;
  /** Every member, located or not, so the row can state "235 of 245". */
  members: number;
}

export interface FamilyScopeResult {
  entity: 'gcfs';
  /** Exact: survivors are enumerated, not estimated by a cardinality agg. */
  total: number;
  approximate: false;
  capped: boolean;
  /** Pass 1 hit CANDIDATE_CAP: families were dropped before purity was measured. Never
   *  present this as a complete answer. */
  truncated: boolean;
  /** Families matching every cohort, before the purity floor. */
  candidates: number;
  rows: FamilyScopeRow[];
}

export class FamilyScopeError extends Error {}

const cohortKey = (i: number) => `c${i}`;

/**
 * Restate the cluster's bucket-limit refusal as "your cohorts match too much":
 * `search.max_buckets` is a cluster setting, so CANDIDATE_CAP cannot be proven safe.
 */
async function tooBroad<T>(p: Promise<T>): Promise<T> {
  try {
    return await p;
  } catch (err) {
    if (err instanceof Error && err.message.includes('too_many_buckets_exception')) {
      throw new FamilyScopeError(
        'The cohorts match too much of the atlas to group family by family. Narrow them '
        + '(a deeper GOLD path, a tighter latitude band) or add conditions to the base filter.',
      );
    }
    throw err;
  }
}

/** `exists` clauses for the fields the cohorts query — the purity denominator. */
export const buildDefinedScope = (cohorts: FilterGroup[]): Record<string, unknown> => {
  const fields = new Set<string>();
  for (const cohort of cohorts) {
    for (const f of collectQueryFields(cohort, bgcPropertyFilterFields)) fields.add(f);
  }
  // No resolvable field: the denominator is every member.
  if (!fields.size) return { match_all: {} };
  return { bool: { filter: [...fields].sort().map((field) => ({ exists: { field } })) } };
};

/** Pass 1: families with at least one member in EVERY cohort. */
export const buildCandidateAggs = (
  cohortQueries: Record<string, unknown>[],
  size: number,
): Record<string, unknown> => {
  const sub: Record<string, unknown> = {};
  cohortQueries.forEach((q, i) => { sub[cohortKey(i)] = { filter: q }; });
  const paths: Record<string, string> = {};
  cohortQueries.forEach((_, i) => { paths[cohortKey(i)] = `${cohortKey(i)}._count`; });
  sub.present = {
    bucket_selector: {
      buckets_path: paths,
      script: cohortQueries.map((_, i) => `params.${cohortKey(i)} > 0`).join(' && '),
    },
  };
  return {
    fam: {
      terms: {
        field: 'gcf_id',
        size,
        order: { _count: 'desc' },
        // Satisfying every cohort takes at least `cohorts` members in the union, so this
        // prune is exact; it drops the single-member tail.
        min_doc_count: cohortQueries.length,
      },
      aggs: sub,
    },
  };
};

/** Pass 2: of those, the ones whose members are (almost) all inside the union. */
export const buildPurityAggs = (
  cohortQueries: Record<string, unknown>[],
  definedScope: Record<string, unknown>,
  minPurity: number,
  size: number,
): Record<string, unknown> => {
  const sub: Record<string, unknown> = {
    located: { filter: definedScope },
    inside: {
      filter: cohortQueries.length === 1
        ? cohortQueries[0]
        : { bool: { should: cohortQueries, minimum_should_match: 1 } },
    },
  };
  cohortQueries.forEach((q, i) => { sub[cohortKey(i)] = { filter: q }; });
  sub.keep = {
    bucket_selector: {
      buckets_path: { inside: 'inside._count', located: 'located._count' },
      // `located > 0` first, or a family with no located member divides by zero.
      script: `params.located > 0 && params.inside >= ${minPurity} * params.located`,
    },
  };
  return { fam: { terms: { field: 'gcf_id', size, order: { _count: 'desc' } }, aggs: sub } };
};

interface RawBucket {
  key: unknown;
  doc_count: number;
  located?: { doc_count: number };
  inside?: { doc_count: number };
  [k: string]: unknown;
}

/** A survivor before hydration: the measurements, no browse document yet. */
export interface FamilyScopeSurvivor {
  id: string;
  members: number;
  inside: number;
  located: number;
  purity: number;
  cohortCounts: number[];
}

export interface FamilyScopeSurvivors {
  survivors: FamilyScopeSurvivor[];
  truncated: boolean;
  candidates: number;
}

/** The two aggregation passes, without paging or hydration, so the export can take
 *  every survivor from one run. */
export async function familyScopeSurvivors(params: {
  group: FilterGroup | null;
  cohorts: FilterGroup[];
  minPurity?: number;
}): Promise<FamilyScopeSurvivors> {
  const cohorts = params.cohorts.filter((c) => hasFilterRules(c));
  if (cohorts.length < 2) {
    throw new FamilyScopeError('Family scope needs at least two cohorts with rules.');
  }
  if (cohorts.length > MAX_COHORTS) {
    throw new FamilyScopeError(`At most ${MAX_COHORTS} cohorts.`);
  }
  const minPurity = Math.min(1, Math.max(0, params.minPurity ?? 1));

  const base = await buildQuery(params.group);
  const cohortQueries = await Promise.all(cohorts.map((c) => buildQuery(c)));
  const union = cohortQueries.length === 1
    ? cohortQueries[0]
    : { bool: { should: cohortQueries, minimum_should_match: 1 } };

  const pass1 = await tooBroad(osFetch(INDEX, {
    size: 0,
    query: { bool: { filter: [base, union] } },
    aggs: buildCandidateAggs(cohortQueries, CANDIDATE_CAP),
  })) as { aggregations?: { fam?: { buckets?: RawBucket[]; sum_other_doc_count?: number } } };

  const candidateIds = (pass1.aggregations?.fam?.buckets ?? []).map((b) => String(b.key));
  const truncated = (pass1.aggregations?.fam?.sum_other_doc_count ?? 0) > 0;

  if (!candidateIds.length) return { survivors: [], truncated, candidates: 0 };
  if (candidateIds.length > CANDIDATE_LIMIT) {
    throw new FamilyScopeError(
      `${candidateIds.length.toLocaleString()} families match every cohort — too many to measure `
      + `exclusivity for. Narrow the cohorts or the base filter to under `
      + `${CANDIDATE_LIMIT.toLocaleString()}.`,
    );
  }

  const pass2 = await tooBroad(osFetch(INDEX, {
    size: 0,
    query: { bool: { filter: [base, { terms: { gcf_id: candidateIds } }] } },
    aggs: buildPurityAggs(
      cohortQueries, buildDefinedScope(cohorts), minPurity, candidateIds.length,
    ),
  })) as { aggregations?: { fam?: { buckets?: RawBucket[] } } };

  const survivors = (pass2.aggregations?.fam?.buckets ?? []).map((b) => {
    const inside = b.inside?.doc_count ?? 0;
    const located = b.located?.doc_count ?? 0;
    return {
      id: String(b.key),
      members: b.doc_count,
      inside,
      located,
      purity: located > 0 ? inside / located : 0,
      cohortCounts: cohorts.map((_, i) => {
        const c = b[cohortKey(i)] as { doc_count?: number } | undefined;
        return c?.doc_count ?? 0;
      }),
    };
  });
  // bucket_selector keeps pass 2's "most members" order; re-sort on `inside`, which
  // differs below purity 1.0.
  survivors.sort((a, b) => b.inside - a.inside || a.id.localeCompare(b.id));

  return { survivors, truncated, candidates: candidateIds.length };
}

/** One page of GCFs for a family-scope query, ordered by members inside the cohorts. */
export async function searchFamilyScope(params: {
  group: FilterGroup | null;
  cohorts: FilterGroup[];
  minPurity?: number;
  page?: number;
  size?: number;
}): Promise<FamilyScopeResult> {
  const page = Math.max(1, params.page ?? 1);
  const size = Math.min(100, Math.max(1, params.size ?? 25));
  const { survivors, truncated, candidates: candidateCount } = await familyScopeSurvivors(params);

  if (!survivors.length) {
    return {
      entity: 'gcfs', total: 0, approximate: false, capped: false,
      truncated, candidates: candidateCount, rows: [],
    };
  }

  if (pageIsCapped(page, size)) {
    return {
      entity: 'gcfs', total: survivors.length, approximate: false, capped: true,
      truncated, candidates: candidateCount, rows: [],
    };
  }

  const pageRows = slicePage(
    survivors.slice(0, ENTITY_CAP).map((s) => ({ key: s.id, doc_count: s.inside })),
    page, size,
  );
  const byId = new Map(survivors.map((s) => [s.id, s]));
  const hydrated = await hydrateEntities(GCF_BROWSE_INDEX, pageRows.map((b) => b.key));

  return {
    entity: 'gcfs',
    total: survivors.length,
    approximate: false,
    capped: false,
    truncated,
    candidates: candidateCount,
    rows: pageRows.map((b) => {
      const s = byId.get(b.key)!;
      return {
        id: s.id,
        bgcCount: s.inside,
        source: hydrated.get(b.key) ?? {},
        cohortCounts: s.cohortCounts,
        inside: s.inside,
        located: s.located,
        purity: s.purity,
        members: s.members,
      };
    }),
  };
}
