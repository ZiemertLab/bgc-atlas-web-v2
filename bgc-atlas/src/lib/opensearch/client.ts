// OpenSearch client for the BGC-property search, over ./http (which adds credentials).
import type { FilterGroup } from '@/lib/filters/types';
import { osRequest } from './http';
import { aggregatableFacetFields, bgcPropertyFilterFields, keywordFacetFields } from '@/lib/filters/bgc-property-fields';
import {
  buildAggregations, buildHistogramAgg, buildOpenSearchQuery, buildStatsAgg,
  buildTermsAgg, makeResolver, niceInterval,
  type UnhonouredCondition,
} from '@/lib/opensearch/query';
import { UnhonourableQueryError } from '@/lib/filters/unhonourable-query';
import {
  coarserInterval, foldCell, geoColorField, goldLegendKeys, goldTermLists,
  intervalForZoom, normalizeBbox, GEO_LEGEND_SIZE, GEO_MAX_CELLS, GEO_OTHER_KEY,
} from '@/lib/opensearch/geo-grid';
import { resolveGcfNames } from '@/lib/opensearch/gcf-name-resolver';
import { aggSize, slicePage, pageIsCapped, type AggBucket } from '@/lib/opensearch/entity-paging';
import { demotePlaceholders } from '@/lib/opensearch/facet-placeholders';
import { KNOWNCLUSTER_MIN_FAMILY_COVERAGE, KNOWNCLUSTER_MIN_SIMILARITY } from '@/lib/known-cluster-thresholds';

import { countResolvedPageBody, isPastTheEnd, planCountResolvedPage } from './deep-paging';

const INDEX = process.env.OPENSEARCH_INDEX || 'bgc_facets';
/** Default window: at ~16.5M documents a deeper `from + size` priority queue is too large. */
const FACETS_RESULT_WINDOW = 10_000;
const VOCAB_INDEX = process.env.OPENSEARCH_VOCAB_INDEX || 'bgc_facet_vocab';
// bgc_facets.gcf_id is a UUID; gcf_browse backs the gcf_id autocomplete and name -> UUID resolution.
const GCF_BROWSE_INDEX = process.env.OPENSEARCH_GCF_BROWSE_INDEX || 'gcf_browse';
const SAMPLE_BROWSE_INDEX = process.env.OPENSEARCH_SAMPLE_BROWSE_INDEX || 'sample_browse';

const resolver = makeResolver(bgcPropertyFilterFields);
const facetSet = new Set(keywordFacetFields);       // autocomplete-eligible (keyword)
const aggSet = new Set(aggregatableFacetFields);     // terms-aggregation-eligible (keyword + boolean)

// How each field is charted in the Distributions panel: keyword/boolean -> a
// terms (bar) distribution; number -> a histogram. Anything else is not plottable.
const distKind = new Map<string, 'terms' | 'histogram'>(
  bgcPropertyFilterFields
    .map((f) => [f.id, f.os === 'number' ? 'histogram' : (f.os === 'keyword' || f.os === 'boolean') ? 'terms' : null] as const)
    .filter((e): e is readonly [string, 'terms' | 'histogram'] => e[1] !== null),
);

/** `label` is secondary picker text (GCF pet name); the filter value is always `value`. */
export interface FacetBucket { value: string; count: number; label?: string; }
export interface SearchResult {
  total: number;
  hits: Record<string, unknown>[];
  facets: Record<string, FacetBucket[]>;
}

export async function osFetch(index: string, body: unknown): Promise<Record<string, unknown>> {
  const res = await osRequest(`/${index}/_search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    // Cap so a hung backend surfaces instead of hanging the route.
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) {
    throw new Error(`OpenSearch ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
  return res.json();
}

/**
 * antiSMASH's MIBiG comparison for one region (KnownClusterBLAST homology). A different
 * signal from `gcf_mibig_anchor` (BiG-SLiCE co-membership); never summed with it.
 * A keyed `_doc` GET; null on a miss, which is the common case.
 */
export interface BgcMibigHomology {
  /** Versioned MIBiG accession, e.g. BGC0001615.3 — 4.x 404s without the version. */
  knownClusterTop: string | null;
  knownClusterCompound: string | null;
  /** KnownClusterBLAST similarity, 0-100; >= KNOWNCLUSTER_MIN_SIMILARITY when set. */
  knownClusterSimilarity: number | null;
  /** ClusterCompare's separate best MIBiG hit; scored 0-1, NOT the same scale. */
  comparisonTop: string | null;
  comparisonScore: number | null;
}

// The cutoffs live in their own module so client components can read them
// without bundling this file; re-exported for the server-side callers.
export { KNOWNCLUSTER_MIN_FAMILY_COVERAGE, KNOWNCLUSTER_MIN_SIMILARITY };

export interface KnownClusterHit {
  accession: string | null;
  compound: string | null;
  /** KnownClusterBLAST similarity, 0-100; always >= KNOWNCLUSTER_MIN_SIMILARITY. */
  similarity: number;
}

/**
 * KnownClusterBLAST hits for one page of BGC rows, keyed by bgc id. Read at request time
 * from bgc_facets: the fields are not in Postgres, so bgc_browse could only get them via a
 * patch the next corpus rebuild would undo. Hence the column cannot be sorted or filtered.
 */
export async function bgcKnownClusterHits(bgcIds: string[]): Promise<Map<string, KnownClusterHit>> {
  const out = new Map<string, KnownClusterHit>();
  if (bgcIds.length === 0) return out;

  const fields = 'knowncluster_top,knowncluster_top_compound,knowncluster_top_similarity';
  const res = await osRequest(`/${INDEX}/_mget?_source=${fields}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids: bgcIds }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    throw new Error(`OpenSearch ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
  const body = (await res.json()) as { docs?: { _id: string; found?: boolean; _source?: Record<string, unknown> }[] };
  for (const doc of body.docs ?? []) {
    if (!doc.found || !doc._source) continue;
    const sim = doc._source.knowncluster_top_similarity;
    if (typeof sim !== 'number' || sim < KNOWNCLUSTER_MIN_SIMILARITY) continue;
    out.set(doc._id, {
      accession: typeof doc._source.knowncluster_top === 'string' ? doc._source.knowncluster_top : null,
      compound: typeof doc._source.knowncluster_top_compound === 'string'
        ? doc._source.knowncluster_top_compound : null,
      similarity: sim,
    });
  }
  return out;
}

export interface GcfKnownClusterRollup extends KnownClusterHit {
  /** Members whose qualifying hit is THIS compound -- not every qualifying hit. */
  hitCount: number;
}

/**
 * The dominant qualifying KnownClusterBLAST compound per family, for one page of GCF rows.
 * A weaker claim than gcf_mibig_anchor and never combined with it. The caller applies
 * KNOWNCLUSTER_MIN_FAMILY_COVERAGE, since only it knows member counts.
 */
export async function gcfKnownClusterRollup(gcfIds: string[]): Promise<Map<string, GcfKnownClusterRollup>> {
  const out = new Map<string, GcfKnownClusterRollup>();
  if (gcfIds.length === 0) return out;

  const body = {
    size: 0,
    query: {
      bool: {
        filter: [
          { terms: { gcf_id: gcfIds } },
          { range: { knowncluster_top_similarity: { gte: KNOWNCLUSTER_MIN_SIMILARITY } } },
        ],
      },
    },
    aggs: {
      fams: {
        terms: { field: 'gcf_id', size: gcfIds.length },
        aggs: {
          // Count, accession and best similarity all nest under the top compound.
          // Taken at family level they mixed compounds: a family split between
          // pseudopaline (18.2%) and yersinopine (11.7%) read "pseudopaline 32.5%",
          // and the accession could be the other compound's.
          top: {
            terms: { field: 'knowncluster_top_compound', size: 1 },
            aggs: {
              acc: { terms: { field: 'knowncluster_top', size: 1 } },
              maxsim: { max: { field: 'knowncluster_top_similarity' } },
            },
          },
        },
      },
    },
  };
  const raw = await osFetch(INDEX, body);
  const buckets = ((raw.aggregations as Record<string, { buckets?: unknown[] }> | undefined)
    ?.fams?.buckets ?? []) as {
      key: string;
      top?: { buckets?: {
        key: string; doc_count: number;
        acc?: { buckets?: { key: string }[] };
        maxsim?: { value?: number };
      }[] };
    }[];

  for (const b of buckets) {
    const top = b.top?.buckets?.[0];
    if (!top) continue;
    out.set(b.key, {
      compound: top.key,
      accession: top.acc?.buckets?.[0]?.key ?? null,
      similarity: Math.round(top.maxsim?.value ?? 0),
      hitCount: top.doc_count,
    });
  }
  return out;
}

export async function bgcMibigHomology(bgcId: string): Promise<BgcMibigHomology | null> {
  const fields = [
    'knowncluster_top', 'knowncluster_top_compound', 'knowncluster_top_similarity',
    'mibig_comparison_top', 'mibig_comparison_top_score',
  ];
  const url = `/${INDEX}/_doc/${encodeURIComponent(bgcId)}?_source=${fields.join(',')}`;
  const res = await osRequest(url, { signal: AbortSignal.timeout(10_000) });
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(`OpenSearch ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
  const doc = (await res.json()) as { _source?: Record<string, unknown> };
  const src = doc._source;
  if (!src) return null;

  const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const str = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null);

  const out: BgcMibigHomology = {
    knownClusterTop: str(src.knowncluster_top),
    knownClusterCompound: str(src.knowncluster_top_compound),
    knownClusterSimilarity: num(src.knowncluster_top_similarity),
    comparisonTop: str(src.mibig_comparison_top),
    comparisonScore: num(src.mibig_comparison_top_score),
  };
  // A KnownClusterBLAST hit under the cutoff suppresses the whole line rather than
  // falling back to ClusterCompare: nearly every such region has a ClusterCompare
  // hit too (median score 0.55 vs 0.77 for qualifying hits, ranges overlapping), so
  // the fallback would swap one chance match for another on ~2M pages.
  if (out.knownClusterTop
    && (out.knownClusterSimilarity === null || out.knownClusterSimilarity < KNOWNCLUSTER_MIN_SIMILARITY)) {
    return null;
  }
  if (!out.knownClusterTop && !out.comparisonTop) return null;
  return out;
}

function extractFacets(aggs: unknown): Record<string, FacetBucket[]> {
  const out: Record<string, FacetBucket[]> = {};
  if (!aggs || typeof aggs !== 'object') return out;
  for (const [key, agg] of Object.entries(aggs as Record<string, { buckets?: { key: unknown; doc_count: number }[] }>)) {
    out[key] = (agg.buckets ?? []).map((b) => ({ value: String(b.key), count: b.doc_count }));
  }
  return out;
}

export interface SearchParams {
  group: FilterGroup | null;
  page?: number;
  size?: number;
  facetFields?: string[];
  sort?: { field: string; order: 'asc' | 'desc' };
}

/** `_count` and sort-keys-only `_search` against the facets index, for the rank resolver. */
async function facetsCount(query: Record<string, unknown>): Promise<number> {
  const res = await osRequest(`/${INDEX}/_count`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`OpenSearch ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return ((await res.json()) as { count?: number }).count ?? 0;
}

const facetsSortKeys = async (body: Record<string, unknown>): Promise<unknown[][]> => {
  const r = await osFetch(INDEX, body) as { hits?: { hits?: Array<{ sort?: unknown[] }> } };
  return (r.hits?.hits ?? []).flatMap((h) => (h.sort ? [h.sort] : []));
};

export async function searchProperties(params: SearchParams): Promise<SearchResult> {
  const page = Math.max(1, params.page ?? 1);
  const size = Math.min(100, Math.max(1, params.size ?? 25));
  // Collect what the builder could not honour rather than run a broader query.
  const { query, unhonoured } = await collectQuery(params.group);
  const facets = params.facetFields ?? [];
  const badFacets = facets.filter((f) => !aggSet.has(f));
  if (unhonoured.length || badFacets.length) {
    throw new UnhonourableQueryError(unhonoured, badFacets);
  }

  const body: Record<string, unknown> = {
    query,
    from: (page - 1) * size,
    size,
    track_total_hits: true,
  };
  // Always sorted, with `bgc_id` last: paging needs a total order, and _score or a
  // single key ties constantly, so a segment merge could show a row twice or never.
  // unmapped_type keeps sort safe on fields not present in every doc/index version.
  const tiebreak = { bgc_id: { order: 'asc' as const } };
  body.sort = params.sort?.field
    ? [{
      [params.sort.field]: { order: params.sort.order === 'asc' ? 'asc' : 'desc', unmapped_type: 'keyword' },
    }, tiebreak]
    : [tiebreak];
  if (facets.length) body.aggs = buildAggregations(facets, 20);

  // Past from + size = 10,000 the index refuses the request, so deep ranks are resolved
  // by counting (as /bgcs does); the `bgc_id` tiebreak makes a rank well defined.
  if ((body.from as number) + size > FACETS_RESULT_WINDOW) {
    const resolved = await planCountResolvedPage(
      { from: body.from as number, size, sort: body.sort, query: query as Record<string, unknown> },
      facetsCount, facetsSortKeys,
      (aggBody) => osFetch(INDEX, aggBody),
    );
    // Past the last match: no rows, but still the facets and total.
    if (isPastTheEnd(resolved)) {
      const r = await osFetch(INDEX, {
        ...body, from: 0, size: 0, track_total_hits: true,
      }) as { aggregations?: unknown };
      return { total: resolved.total, hits: [], facets: extractFacets(r.aggregations) };
    }
    if (resolved) {
      const page = await osFetch(INDEX, {
        ...countResolvedPageBody(resolved),
        ...(facets.length ? { aggs: buildAggregations(facets, 20) } : {}),
      }) as { hits?: { hits?: { _source?: Record<string, unknown> }[] }; aggregations?: unknown };
      return {
        // The resolver's total is the unnarrowed one; the narrowed body's own
        // hit count covers only documents from the boundary on.
        total: resolved.total,
        // sliceFrom is non-zero only when the remainder had to be over-fetched.
        hits: (page.hits?.hits ?? []).slice(resolved.sliceFrom).map((h) => h._source ?? {}),
        facets: extractFacets(page.aggregations),
      };
    }
  }

  const r = await osFetch(INDEX, body) as {
    hits?: { total?: { value?: number }; hits?: { _source?: Record<string, unknown> }[] };
    aggregations?: unknown;
  };
  return {
    total: r.hits?.total?.value ?? 0,
    hits: (r.hits?.hits ?? []).map((h) => h._source ?? {}),
    facets: extractFacets(r.aggregations),
  };
}

export interface DistBucket { key: string; count: number; label?: string; }
export interface DistResult {
  field: string;
  kind: 'terms' | 'histogram';
  total: number;            // total docs in the matched set
  missing: number;          // docs lacking the field
  other: number;            // terms: docs beyond the top-N buckets; histogram: 0
  interval?: number;        // histogram bin width
  buckets: DistBucket[];    // terms: value+count; histogram: bin lower-bound (as string) + count
}

type OSAgg = {
  buckets?: { key: unknown; doc_count: number }[];
  sum_other_doc_count?: number;
  doc_count?: number;
  min?: number | null;
  max?: number | null;
  count?: number;
  values?: Record<string, number | null>; // percentiles: { "1.0": .., "99.0": .. }
};

/** Distributions for several fields in at most two round-trips: terms aggs and numeric
 *  stats, then histograms sized from those stats. Results follow the requested order. */
export async function aggregateFields(
  group: FilterGroup | null,
  fields: string[],
  termsSize = 20,
): Promise<DistResult[]> {
  const query = await buildQuery(group);
  const seen = new Set<string>();
  const wanted = fields
    .filter((f) => { if (seen.has(f)) return false; seen.add(f); return true; })
    .map((f) => ({ field: f, kind: distKind.get(f) }))
    .filter((x): x is { field: string; kind: 'terms' | 'histogram' } => !!x.kind);
  if (!wanted.length) return [];

  const termsFields = wanted.filter((w) => w.kind === 'terms').map((w) => w.field);
  const numFields = wanted.filter((w) => w.kind === 'histogram').map((w) => w.field);

  const aggsA: Record<string, unknown> = {};
  for (const f of termsFields) Object.assign(aggsA, buildTermsAgg(f, termsSize));
  for (const f of numFields) Object.assign(aggsA, buildStatsAgg(f));
  const rA = await osFetch(INDEX, { query, size: 0, track_total_hits: true, aggs: aggsA }) as {
    hits?: { total?: { value?: number } };
    aggregations?: Record<string, OSAgg>;
  };
  const total = rA.hits?.total?.value ?? 0;
  const aggsResA = rA.aggregations ?? {};

  const byField = new Map<string, DistResult>();
  for (const f of termsFields) {
    const agg = aggsResA[f];
    byField.set(f, {
      field: f, kind: 'terms', total,
      missing: aggsResA[`${f}__missing`]?.doc_count ?? 0,
      other: agg?.sum_other_doc_count ?? 0,
      buckets: (agg?.buckets ?? []).map((b) => ({ key: String(b.key), count: b.doc_count })),
    });
  }

  // Histogram range is p1..p99 (clamped to min/max) so outliers do not flatten the bulk.
  const numMeta = numFields.map((f) => {
    const s = aggsResA[`${f}__stats`];
    const pct = aggsResA[`${f}__pct`]?.values ?? {};
    const min = s?.min ?? null;
    const max = s?.max ?? null;
    let lo = pct['1.0'] ?? min;
    let hi = pct['99.0'] ?? max;
    // Fall back to full range if percentiles are missing or collapse to a point.
    if (lo == null || hi == null || !(hi > lo)) { lo = min; hi = max; }
    return {
      field: f, min, max, lo, hi,
      count: s?.count ?? 0,
      missing: aggsResA[`${f}__missing`]?.doc_count ?? 0,
    };
  });
  const withData = numMeta.filter((m) => m.count > 0 && m.lo != null && m.hi != null);
  if (withData.length) {
    const aggsB: Record<string, unknown> = {};
    const intervals = new Map<string, number>();
    for (const m of withData) {
      const lo = m.lo as number;
      const hi = m.hi as number;
      const interval = niceInterval(lo, hi);
      // Snap to interval multiples: hard_bounds would otherwise drop a whole edge bucket.
      const alignedLo = Math.floor(lo / interval) * interval;
      const alignedHi = Math.ceil(hi / interval) * interval;
      intervals.set(m.field, interval);
      Object.assign(aggsB, buildHistogramAgg(m.field, interval, alignedLo, alignedHi));
    }
    const rB = await osFetch(INDEX, { query, size: 0, aggs: aggsB }) as {
      aggregations?: Record<string, OSAgg>;
    };
    const aggsResB = rB.aggregations ?? {};
    for (const m of withData) {
      const agg = aggsResB[m.field];
      byField.set(m.field, {
        field: m.field, kind: 'histogram', total,
        missing: m.missing, other: 0, interval: intervals.get(m.field),
        buckets: (agg?.buckets ?? []).map((b) => ({ key: String(b.key), count: b.doc_count })),
      });
    }
  }
  for (const m of numMeta.filter((m) => !(m.count > 0))) {
    byField.set(m.field, { field: m.field, kind: 'histogram', total, missing: m.missing, other: 0, buckets: [] });
  }

  return wanted.map((w) => byField.get(w.field)).filter((r): r is DistResult => !!r);
}

/** Autocomplete for `gcf_id` from gcf_browse (the vocab index skips UUIDs). Pet names
 *  match anywhere, being two hyphenated words; the value is always the GCF name. */
async function gcfFacetValues(prefix: string, size: number): Promise<FacetBucket[]> {
  const query = prefix
    ? {
        bool: {
          should: [
            { prefix: { gcf_name: { value: prefix, case_insensitive: true } } },
            { prefix: { pet_name: { value: prefix, case_insensitive: true } } },
            { wildcard: { pet_name: { value: `*${prefix}*`, case_insensitive: true } } },
          ],
          minimum_should_match: 1,
        },
      }
    : { match_all: {} };
  const r = await osFetch(GCF_BROWSE_INDEX, {
    size: Math.min(200, Math.max(1, size)),
    query,
    sort: [{ member_bgc_count: 'desc' }],
    _source: ['gcf_name', 'pet_name', 'member_bgc_count'],
  }) as { hits?: { hits?: { _source?: { gcf_name?: string; pet_name?: string; member_bgc_count?: number } }[] } };
  return (r.hits?.hits ?? [])
    .filter((h) => h._source?.gcf_name)
    .map((h) => ({
      value: String(h._source!.gcf_name),
      count: h._source!.member_bgc_count ?? 0,
      label: h._source!.pet_name,
    }));
}

/** GCF name (or pet name) -> gcf_id. Cached per process: names are immutable once assigned. */
const GCF_NAME_TTL_MS = 60 * 60 * 1000;
const gcfNameCache = new Map<string, { id: string; at: number }>();

export const gcfNameLookup = async (names: string[]): Promise<Map<string, string>> => {
  const now = Date.now();
  const out = new Map<string, string>();
  const missing: string[] = [];
  for (const n of names) {
    const hit = gcfNameCache.get(n);
    if (hit && now - hit.at < GCF_NAME_TTL_MS) out.set(n, hit.id);
    else missing.push(n);
  }
  if (!missing.length) return out;

  // GCF names are uppercase, pet names lowercase; try both so a hand-typed value resolves.
  const r = await osFetch(GCF_BROWSE_INDEX, {
    size: Math.min(1000, missing.length * 2),
    _source: ['gcf_id', 'gcf_name', 'pet_name'],
    query: {
      bool: {
        should: [
          { terms: { gcf_name: missing.map((n) => n.toUpperCase()) } },
          { terms: { pet_name: missing.map((n) => n.toLowerCase()) } },
        ],
        minimum_should_match: 1,
      },
    },
  }) as { hits?: { hits?: { _source?: { gcf_id?: string; gcf_name?: string; pet_name?: string } }[] } };

  const byName = new Map<string, string>();
  for (const h of r.hits?.hits ?? []) {
    const s = h._source;
    if (!s?.gcf_id) continue;
    if (s.gcf_name) byName.set(s.gcf_name.toUpperCase(), s.gcf_id);
    if (s.pet_name) byName.set(s.pet_name.toLowerCase(), s.gcf_id);
  }
  for (const n of missing) {
    const id = byName.get(n.toUpperCase()) ?? byName.get(n.toLowerCase());
    if (id) {
      out.set(n, id);
      gcfNameCache.set(n, { id, at: now });
    }
  }
  return out;
};

/**
 * The query plus what could not be honoured, without raising. Resolves GCF names to
 * UUIDs first; every query path goes through here. Module-private because it does not
 * fail closed; searchProperties folds its rejections into one 400.
 */
async function collectQuery(group: FilterGroup | null) {
  const unhonoured: UnhonouredCondition[] = [];
  const query = buildOpenSearchQuery(
    await resolveGcfNames(group, gcfNameLookup), resolver, (u) => unhonoured.push(u),
  );
  return { query, unhonoured };
}

/**
 * Fails closed: an unhonourable condition raises UnhonourableQueryError here, in the one
 * function every route calls, rather than widening the answer. Routes translate it to 400.
 */
export async function buildQuery(group: FilterGroup | null) {
  const { query, unhonoured } = await collectQuery(group);
  if (unhonoured.length) throw new UnhonourableQueryError(unhonoured);
  return query;
}

/** How many BGCs a property search matches -- what scrollHits would page through.
 *  Throws UnhonourableQueryError, like buildQuery, for a search the index cannot answer. */
export async function countMatches(group: FilterGroup | null): Promise<number> {
  return facetsCount(await buildQuery(group));
}

export async function facetValues(field: string, prefix = '', size = 20): Promise<FacetBucket[]> {
  if (field === 'gcf_id') return gcfFacetValues(prefix, size);
  if (!facetSet.has(field)) throw new Error(`not a facet field: ${field}`);
  const filter: unknown[] = [{ term: { field } }];
  // Edge-ngram `match` finds a prefix of any word but ignores single characters
  // (min_gram 2); the case-insensitive keyword `prefix` covers those.
  const query = prefix
    ? {
        bool: {
          filter,
          should: [
            { match: { 'value.prefix': { query: prefix, operator: 'and' } } },
            { prefix: { value: { value: prefix, case_insensitive: true } } },
          ],
          minimum_should_match: 1,
        },
      }
    : { bool: { filter } };
  const body = {
    size: Math.min(5000, Math.max(1, size)),
    query,
    sort: [{ count: 'desc' }],
    _source: ['value', 'count'],
  };
  const r = await osFetch(VOCAB_INDEX, body) as {
    hits?: { hits?: { _source?: { value?: unknown; count?: number } }[] };
  };
  return demotePlaceholders(field, (r.hits?.hits ?? []).map((h) => ({
    value: String(h._source?.value ?? ''),
    count: h._source?.count ?? 0,
  })));
}

/** What a Property Search returns. 'bgcs' is the document path (searchProperties). */
export type ReturnEntity = 'bgcs' | 'gcfs' | 'samples';

const ENTITY_FIELD: Record<'gcfs' | 'samples', string> = {
  gcfs: 'gcf_id',
  samples: 'sample_id',
};
const ENTITY_INDEX: Record<'gcfs' | 'samples', string> = {
  gcfs: GCF_BROWSE_INDEX,
  samples: SAMPLE_BROWSE_INDEX,
};

export interface EntityRow {
  id: string;
  /** BGCs in the matched set belonging to this entity — not its total size. */
  bgcCount: number;
  source: Record<string, unknown>;
}
export interface EntityResult {
  entity: 'gcfs' | 'samples';
  /** Distinct entities in the matched set. Approximate above the cardinality
   *  precision threshold — the UI must not present it as exact. */
  total: number;
  approximate: boolean;
  /** The requested page lies past ENTITY_CAP; narrow the query instead. */
  capped: boolean;
  rows: EntityRow[];
}

/** Hydrate ids into their browse-index documents, preserving the given order. */
export async function hydrateEntities(index: string, ids: string[]): Promise<Map<string, Record<string, unknown>>> {
  if (!ids.length) return new Map();
  const r = await osFetch(index, {
    size: ids.length,
    query: { ids: { values: ids } },
  }) as { hits?: { hits?: { _id: string; _source?: Record<string, unknown> }[] } };
  const byId = new Map((r.hits?.hits ?? []).map((h) => [h._id, h._source ?? {}]));

  // gcf_browse holds listed families only; unlisted ones from bgc_facets are filled from Postgres.
  if (index === GCF_BROWSE_INDEX) {
    const missing = ids.filter((id) => !byId.has(id));
    if (missing.length > 0) {
      try {
        const { fetchGcfDocumentsFromPostgres } = await import('@/lib/gcf/postgres-documents');
        for (const document of await fetchGcfDocumentsFromPostgres(missing)) {
          const id = document.gcf_id;
          if (typeof id === 'string') byId.set(id, document);
        }
      } catch (error) {
        // Enrichment: a row with a bgcCount is still a result worth showing.
        console.error('Postgres fallback for unindexed GCF entities failed:', error);
      }
    }
  }

  return byId;
}

/**
 * Filter BGC documents, then group the matching set by GCF or sample, by matching-BGC
 * count descending (the only order a terms aggregation can page through).
 */
export async function searchEntities(params: {
  group: FilterGroup | null;
  entity: 'gcfs' | 'samples';
  page?: number;
  size?: number;
}): Promise<EntityResult> {
  const page = Math.max(1, params.page ?? 1);
  const size = Math.min(100, Math.max(1, params.size ?? 25));
  const field = ENTITY_FIELD[params.entity];
  const query = await buildQuery(params.group);

  if (pageIsCapped(page, size)) {
    const only = await osFetch(INDEX, {
      size: 0, query,
      aggs: { total: { cardinality: { field, precision_threshold: 40000 } } },
    }) as { aggregations?: Record<string, { value?: number }> };
    return {
      entity: params.entity,
      total: only.aggregations?.total?.value ?? 0,
      approximate: true, capped: true, rows: [],
    };
  }

  const r = await osFetch(INDEX, {
    size: 0,
    query,
    aggs: {
      total: { cardinality: { field, precision_threshold: 40000 } },
      page: { terms: { field, size: aggSize(page, size), order: { _count: 'desc' } } },
    },
  }) as {
    aggregations?: {
      total?: { value?: number };
      page?: { buckets?: { key: unknown; doc_count: number }[]; sum_other_doc_count?: number };
    };
  };

  const buckets: AggBucket[] = (r.aggregations?.page?.buckets ?? [])
    .map((b) => ({ key: String(b.key), doc_count: b.doc_count }));
  const pageBuckets = slicePage(buckets, page, size);
  const byId = await hydrateEntities(ENTITY_INDEX[params.entity], pageBuckets.map((b) => b.key));

  // `sum_other_doc_count: 0` means every entity got a bucket, so the bucket count is
  // exact; cardinality only estimates above its precision threshold.
  const enumerated = (r.aggregations?.page?.sum_other_doc_count ?? 0) === 0;

  return {
    entity: params.entity,
    total: enumerated ? buckets.length : (r.aggregations?.total?.value ?? 0),
    // Cardinality may be an estimate, so say "about" unless the buckets counted it.
    approximate: !enumerated,
    capped: false,
    rows: pageBuckets.map((b) => ({
      id: b.key,
      bgcCount: b.doc_count,
      source: byId.get(b.key) ?? {},
    })),
  };
}

export interface GeoBbox { latMin?: number; latMax?: number; lonMin?: number; lonMax?: number }

/** One grid cell: [cell lower-edge lat, lower-edge lon, BGC count, dominant
 *  legend index (-1 when uncoloured), sparse [legendIndex, count] breakdown]. */
export type GeoCell = [number, number, number, number, [number, number][]];

export interface GeoGridResult {
  interval: number;
  /** BGCs matching the query that carry coordinates (and fall inside the bbox). */
  hits: number;
  colorField: string | null;
  legendKeys: string[];
  cells: GeoCell[];
  /** True when the requested resolution produced too many cells and the grid was
   *  served one ladder step coarser. */
  coarsened: boolean;
}

export interface GeoGridParams {
  group: FilterGroup | null;
  colorField?: string | null;
  zoom?: number;
  bbox?: GeoBbox | null;
}

// The GOLD vocabulary changes only on re-ingest; cache per process.
const GOLD_VOCAB_TTL_MS = 60 * 60 * 1000;
let goldVocabCache: { paths: string[]; at: number } | null = null;

async function goldVocabPaths(): Promise<string[]> {
  const now = Date.now();
  if (goldVocabCache && now - goldVocabCache.at < GOLD_VOCAB_TTL_MS) return goldVocabCache.paths;
  const r = await osFetch(INDEX, {
    size: 0,
    aggs: { g: { terms: { field: 'gold_ecosystem', size: 2000 } } },
  }) as { aggregations?: Record<string, OSAgg> };
  const agg = r.aggregations?.g;
  // A non-zero tail would silently colour paths as "unknown".
  if (agg?.sum_other_doc_count) {
    console.warn('[opensearch] gold_ecosystem vocabulary truncated — some paths will colour as unknown');
  }
  const paths = (agg?.buckets ?? []).map((b) => String(b.key));
  goldVocabCache = { paths, at: now };
  return paths;
}

/** Matching BGCs with coordinates; separate from the grid so coverage stays whole-result
 *  while the map is zoomed in. */
export async function geoCount(group: FilterGroup | null): Promise<number> {
  const query = await buildQuery(group);
  const r = await osFetch(INDEX, {
    size: 0,
    track_total_hits: true,
    query: {
      bool: {
        filter: [
          query,
          { exists: { field: 'latitude' } },
          { exists: { field: 'longitude' } },
        ],
      },
    },
  }) as { hits?: { total?: { value?: number } } };
  return r.hits?.total?.value ?? 0;
}

/** Nested lat/lon histogram; `min_doc_count: 1` keeps a global 0.25° grid at ~12k cells. */
function gridAgg(interval: number, colorAgg: Record<string, unknown> | null) {
  const lon: Record<string, unknown> = {
    histogram: { field: 'longitude', interval, min_doc_count: 1 },
  };
  if (colorAgg) lon.aggs = { c: colorAgg };
  return {
    lat: {
      histogram: { field: 'latitude', interval, min_doc_count: 1 },
      aggs: { lon },
    },
  };
}

/**
 * Aggregate the matched BGCs onto a lat/lon grid (floats, no geo_point). `terms` fields get
 * a global legend agg and per-cell terms; `gold_ecosystem` uses a per-cell `filters` agg
 * with one terms list per GOLD bucket, faster than prefix queries.
 */
export async function geoGrid(params: GeoGridParams): Promise<GeoGridResult> {
  const color = geoColorField(params.colorField);
  const bbox = normalizeBbox(params.bbox);

  const filter: unknown[] = [
    await buildQuery(params.group),
    { exists: { field: 'latitude' } },
    { exists: { field: 'longitude' } },
  ];
  if (bbox?.latMin !== undefined) filter.push({ range: { latitude: { gte: bbox.latMin, lte: bbox.latMax } } });
  if (bbox?.lonMin !== undefined) filter.push({ range: { longitude: { gte: bbox.lonMin, lte: bbox.lonMax } } });
  const query = { bool: { filter } };

  // Legend keys are global so a colour means the same in every cell and zoom level.
  let legendKeys: string[] = [];
  let colorAgg: Record<string, unknown> | null = null;
  let extraAggs: Record<string, unknown> = {};

  if (color?.kind === 'gold') {
    const lists = goldTermLists(await goldVocabPaths());
    legendKeys = goldLegendKeys();
    colorAgg = {
      filters: {
        other_bucket_key: 'unknown', // unset + anything outside the vocabulary
        filters: Object.fromEntries(
          Object.entries(lists).map(([bucket, paths]) => [bucket, { terms: { gold_ecosystem: paths } }]),
        ),
      },
    };
  } else if (color?.kind === 'terms') {
    colorAgg = { terms: { field: color.id, size: GEO_LEGEND_SIZE } };
    extraAggs = { legend: { terms: { field: color.id, size: GEO_LEGEND_SIZE } } };
  }

  const run = async (interval: number) => {
    const r = await osFetch(INDEX, {
      size: 0,
      track_total_hits: true,
      query,
      aggs: { ...gridAgg(interval, colorAgg), ...extraAggs },
    }) as {
      hits?: { total?: { value?: number } };
      aggregations?: Record<string, OSAgg>;
    };
    return r;
  };

  let interval = intervalForZoom(params.zoom ?? 0);
  let raw = await run(interval);
  let coarsened = false;

  const countCells = (r: { aggregations?: Record<string, OSAgg> }) =>
    (r.aggregations?.lat?.buckets ?? []).reduce(
      (n, b) => n + ((b as unknown as { lon?: OSAgg }).lon?.buckets?.length ?? 0), 0,
    );

  if (countCells(raw) > GEO_MAX_CELLS) {
    const next = coarserInterval(interval);
    if (next) {
      interval = next;
      raw = await run(interval);
      coarsened = true;
    }
  }

  // The legend is only known after the query for terms colouring; GOLD's is fixed.
  if (color?.kind === 'terms') {
    legendKeys = (raw.aggregations?.legend?.buckets ?? []).map((b) => String(b.key));
  }
  const legendIndex = new Map(legendKeys.map((k, i) => [k, i]));
  // GOLD's other-bucket is already one of the nine display buckets.
  const otherIndex = color?.kind === 'terms' ? legendKeys.length : legendIndex.get('unknown') ?? -1;
  const keysOut = color?.kind === 'terms' ? [...legendKeys, GEO_OTHER_KEY] : legendKeys;

  const cells: GeoCell[] = [];
  for (const latBucket of raw.aggregations?.lat?.buckets ?? []) {
    const lat = Number(latBucket.key);
    const lonBuckets = (latBucket as unknown as { lon?: OSAgg }).lon?.buckets ?? [];
    for (const lonBucket of lonBuckets) {
      const lon = Number(lonBucket.key);
      const n = lonBucket.doc_count;
      if (!color) { cells.push([lat, lon, n, -1, []]); continue; }

      const c = (lonBucket as unknown as { c?: OSAgg & { buckets?: unknown } }).c;
      const entries: [string, number][] = Array.isArray(c?.buckets)
        // terms agg: [{ key, doc_count }, ...]
        ? (c.buckets as { key: unknown; doc_count: number }[]).map((b) => [String(b.key), b.doc_count])
        // named filters agg: { marine: { doc_count }, ... }
        : Object.entries((c?.buckets ?? {}) as Record<string, { doc_count: number }>)
          .map(([k, v]) => [k, v.doc_count]);

      const { dom, pairs } = foldCell(n, entries, legendIndex, otherIndex);
      cells.push([lat, lon, n, dom, pairs]);
    }
  }

  return {
    interval,
    hits: raw.hits?.total?.value ?? 0,
    colorField: color?.id ?? null,
    legendKeys: keysOut,
    cells,
    coarsened,
  };
}

/** Fetch up to `cap` matching hits (for exports) via search_after paging, which
 *  works past the 10k from+size window. Returns the _source of each hit. */
export async function scrollHits(
  group: FilterGroup | null,
  sort: { field: string; order: 'asc' | 'desc' } | null,
  cap: number,
  /** Only these _source fields; whole facet documents are ~5.6 KB each. */
  sourceFields?: string[],
): Promise<Record<string, unknown>[]> {
  const query = await buildQuery(group);
  const BATCH = 5000;
  const sortSpec = sort?.field
    ? [{ [sort.field]: { order: sort.order, unmapped_type: 'keyword' } }, { bgc_id: 'asc' as const }]
    : [{ bgc_id: 'asc' as const }];

  const out: Record<string, unknown>[] = [];
  let searchAfter: unknown[] | undefined;
  while (out.length < cap) {
    const body: Record<string, unknown> = {
      query, sort: sortSpec, size: Math.min(BATCH, cap - out.length), track_total_hits: false,
      ...(sourceFields ? { _source: sourceFields } : {}),
    };
    if (searchAfter) body.search_after = searchAfter;
    const r = await osFetch(INDEX, body) as {
      hits?: { hits?: { _source?: Record<string, unknown>; sort?: unknown[] }[] };
    };
    const hits = r.hits?.hits ?? [];
    if (!hits.length) break;
    for (const h of hits) out.push(h._source ?? {});
    searchAfter = hits[hits.length - 1].sort;
    if (hits.length < BATCH || !searchAfter) break;
  }
  return out;
}
