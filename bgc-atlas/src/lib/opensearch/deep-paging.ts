/**
 * Deep paging for /bgcs. `from + size` stops at max_result_window (10,000), which cannot
 * be raised for bgc_browse (~0.7 GB priority queue at ~16.5M documents), and the
 * PostgreSQL fallback times out on deep offsets. A rank is resolved by counting instead,
 * then the page is read from the browse index.
 */

/** bgc_browse's `index.max_result_window`, the default (see browse_index_mapping.py). */
export const BROWSE_RESULT_WINDOW = 10_000;

// Nothing is stored: a filter or a different sort moves every rank. "How many documents
// sort before v" is a count, so the boundary is found by searching the leading sort key,
// then the query is narrowed to "at or past the boundary", turning the position into a
// small `from`. Leading keys differ only in how a boundary value is proposed: numbers
// bisect their observed range, uuids the key space, booleans pick, enumerable keywords
// are listed, and high-cardinality keywords are walked with a composite aggregation.

/** Leading sort fields this resolver can bisect. */
const LEADING_KINDS: Record<string, 'number' | 'uuid' | 'boolean' | 'terms' | 'ordered'> = {
  // ~180,000 values, past max_buckets, so walked with a composite aggregation.
  taxonomy_sort: 'ordered',
  // Arrays: OpenSearch sorts by max (desc) or min (asc); "before v" and "the block at v"
  // are still countable, and both fields are enumerable (6 and ~100 values).
  product_category: 'terms',
  product_type: 'terms',
  // ~4,000 values, enumerable. A scalar is the degenerate array where min = max.
  resolved_biome_level_1: 'terms',
  // bgc_facets fields (property search); the names do not collide with the browse fields.
  product: 'terms',             // ~100 values
  sample_type: 'terms',         // 4
  gold_ecosystem: 'terms',      // several hundred
  sample_name: 'ordered',       // ~800,000 -- walked, not listed
  length: 'number',
  num_cds_features: 'number',
  distance: 'number',
  bgc_id: 'uuid',
  gcf_id: 'uuid',
  assembly_id: 'uuid',
  is_complete: 'boolean',
};

const FLOAT_FIELDS = new Set(['distance']);

/** The remainder a single request can consume: `from + size` must fit the window. */
const maxRemainder = (limit: number) => BROWSE_RESULT_WINDOW - limit;

/** Window-sized strides the walk may spend (~1s each); seekWithinBlock is preferred. */
const MAX_WALK_STRIDES = 4;

/** Distinct values a keyword sort may have and still be listed; biome (~4,000) sets it.
 *  A truncated list is refused rather than searched. */
const ENUMERABLE_VALUE_CEILING = 20_000;

/** Probes the id bisection may spend; uniform ids reach a window-sized remainder in ~8. */
const MAX_ID_PROBES = 24;

/** A UUID keyword from a 52-bit prefix (one safe integer, so no BigInt under ES2017),
 *  zero-filled. Dashes sit at fixed positions, so string order equals numeric order. */
const ID_PREFIX_BITS = 52;
const ID_PREFIX_HEX = ID_PREFIX_BITS / 4;
const ID_PREFIX_MAX = 2 ** ID_PREFIX_BITS - 1;

const uuidFrom = (prefix: number): string => {
  const hex = Math.max(0, Math.min(ID_PREFIX_MAX, Math.floor(prefix)))
    .toString(16)
    .padStart(ID_PREFIX_HEX, '0')
    .padEnd(32, '0');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};

interface LeadingKey {
  field: string;
  direction: 'asc' | 'desc';
  kind: 'number' | 'uuid' | 'boolean' | 'terms' | 'ordered';
  float: boolean;
}

/** Values per composite request and the request cap; the walk starts from the nearer end. */
const COMPOSITE_PAGE = 10_000;
const MAX_COMPOSITE_REQUESTS = 12;

/** The sort's leading key, if this resolver can bisect it. */
const leadingKey = (sort: unknown): LeadingKey | null => {
  if (!Array.isArray(sort) || sort.length === 0) return null;
  const first = sort[0] as Record<string, { order?: string }>;
  const field = Object.keys(first)[0];
  const kind = field ? LEADING_KINDS[field] : undefined;
  if (!field || !kind) return null;
  return {
    field,
    direction: first[field]?.order === 'asc' ? 'asc' : 'desc',
    kind,
    float: FLOAT_FIELDS.has(field),
  };
};

const and = (...clauses: unknown[]) => ({ bool: { filter: clauses } });
const anyOf = (base: Record<string, unknown>, ...clauses: unknown[]) =>
  ({ bool: { filter: [base], should: clauses, minimum_should_match: 1 } });
const missing = (field: string) => ({ bool: { must_not: [{ exists: { field } }] } });

export interface CountResolvedPage {
  /** The narrowed query: the caller's filters, plus the boundary. */
  query: Record<string, unknown>;
  /** The ordering to read it in -- the caller's own, not a fixed one. */
  sort: unknown;
  /** Seek key, when the remainder was too large to express as `from`. */
  after?: unknown[];
  /** Position within the narrowed query. Always within the result window. */
  from: number;
  size: number;
  /** Hits to drop from the front of the response. Non-zero only with `after`. */
  sliceFrom: number;
  /** Matching documents for the UNNARROWED query: what the pager must show. */
  total: number;
  /** Requests spent resolving, for the caller to log. */
  probes: number;
}

/**
 * The requested offset lies past the last match. Distinct from null ("cannot resolve",
 * answered with the deep-page refusal): this is an empty page and the real total.
 */
export interface PastTheEnd {
  pastEnd: true;
  /** Matching documents for the query: where the pager should snap back to. */
  total: number;
  probes: number;
}

export const isPastTheEnd = (
  resolved: CountResolvedPage | PastTheEnd | null,
): resolved is PastTheEnd => resolved !== null && 'pastEnd' in resolved;

interface BlockSeek { after: unknown[]; sliceFrom: number; probes: number }

interface IdBisection { id: string; remainder: number; probes: number }

/** Bisect `bgc_id` inside a block for the position `target` documents in; null past the probe budget. */
async function bisectId(
  block: (extra?: unknown[]) => Record<string, unknown>,
  prefix: unknown[],
  target: number,
  limit: number,
  count: (query: Record<string, unknown>) => Promise<number>,
): Promise<IdBisection | null> {
  let id = uuidFrom(0);
  let before = 0;
  let probes = 0;

  // Bracket from the small end: a count costs what it matches, so opening at the
  // midpoint of a large block is the most expensive probe there is.
  let lo = 0;
  let loCount = 0;
  let hi = Math.floor(ID_PREFIX_MAX / 1024);
  let hiCount = 0;

  while (probes < MAX_ID_PROBES) {
    probes += 1;
    hiCount = await count(block([...prefix, { range: { bgc_id: { lt: uuidFrom(hi) } } }]));
    if (hiCount >= target || hi >= ID_PREFIX_MAX) break;
    lo = hi;
    loCount = hiCount;
    hi = Math.min(ID_PREFIX_MAX, hi * 4);
  }

  if (loCount <= target) {
    id = uuidFrom(lo);
    before = loCount;
  }

  // Then interpolate inside the bracket: the counts at both ends are known, and
  // uniform ids make the rank almost linear in the key.
  while (lo <= hi && probes < MAX_ID_PROBES && target - before > maxRemainder(limit)) {
    const span = hiCount - loCount;
    const guess = span > 0
      ? lo + ((target - loCount) / span) * (hi - lo)
      : (lo + hi) / 2;
    const mid = Math.min(hi - 1, Math.max(lo + 1, Math.round(guess)));
    if (mid <= lo || mid >= hi) break;
    const candidate = uuidFrom(mid);
    probes += 1;
    const scanned = await count(block([...prefix, { range: { bgc_id: { lt: candidate } } }]));
    if (scanned <= target) {
      id = candidate;
      before = scanned;
      lo = mid;
      loCount = scanned;
    } else {
      hi = mid;
      hiCount = scanned;
    }
  }

  const remainder = target - before;
  if (remainder < 0 || remainder > maxRemainder(limit)) return null;
  return { id, remainder, probes };
}

/**
 * Find a position deep inside a tie block by bisecting the uniform uuid tiebreaker
 * (~8 counts, versus a request per 10,000 documents for the walk). Returns a synthetic
 * `search_after` tuple, which need not match any document.
 */
async function seekWithinBlock(
  block: (extra?: unknown[]) => Record<string, unknown>,
  sort: Array<Record<string, { order?: string }>>,
  leadingValue: number | string,
  skip: number,
  limit: number,
  count: (query: Record<string, unknown>) => Promise<number>,
): Promise<BlockSeek | null> {
  const tieKeys = sort.slice(1).map((entry) => Object.keys(entry)[0]);
  const idKey = tieKeys[tieKeys.length - 1];
  if (idKey !== 'bgc_id') return null;
  if (tieKeys.length === 2 && tieKeys[0] !== 'is_complete') return null;
  if (tieKeys.length > 2) return null;

  let probes = 0;

  // The boolean middle key splits the block into a run of true then false (desc);
  // bisect whichever run holds the target.
  const prefix: unknown[] = [];
  let flag: 0 | 1 | null = null;
  let within = skip;
  if (tieKeys.length === 2) {
    const ascending = sort[1].is_complete?.order === 'asc';
    const headValue = !ascending;                    // desc puts true first
    probes += 1;
    const headSize = await count(block([{ term: { is_complete: headValue } }]));
    if (within < headSize) {
      flag = headValue ? 1 : 0;
      prefix.push({ term: { is_complete: headValue } });
    } else {
      within -= headSize;
      flag = headValue ? 0 : 1;
      prefix.push({ term: { is_complete: !headValue } });
    }
  }

  const bisected = await bisectId(block, prefix, within, limit, count);
  if (!bisected) return null;
  probes += bisected.probes;
  const { id: boundary, remainder } = bisected;

  const after = flag === null ? [leadingValue, boundary] : [leadingValue, flag, boundary];
  return { after, sliceFrom: remainder, probes };
}

interface Boundary {
  /** Documents sharing the boundary's leading value: the tie block. */
  block: (extra?: unknown[]) => Record<string, unknown>;
  /** The block and everything sorting after it. */
  fromQuery: Record<string, unknown>;
  /** Documents sorting before the block. */
  rankBefore: number;
  /** The leading sort value, for a synthetic seek key. */
  value: number | string;
  /** The block of documents missing the sort field: no value to seek with, and nothing sorts after it. */
  isTail: boolean;
  probes: number;
}

/** Bisect the leading key for the block holding `offset`; null when the field's shape defeats the search. */
async function resolveLeadingBoundary(
  base: Record<string, unknown>,
  key: LeadingKey,
  offset: number,
  limit: number,
  count: (query: Record<string, unknown>) => Promise<number>,
  seek: (body: Record<string, unknown>) => Promise<unknown[][]>,
  /** Runs an aggregation: how the enumerable keyword fields list their values. */
  aggregate?: (body: Record<string, unknown>) => Promise<unknown>,
): Promise<Boundary | null> {
  let probes = 0;

  /** Documents sorting BEFORE the block at `v`. A range excludes documents
   *  missing the field, which is correct: OpenSearch sorts those last. */
  const before = (v: number | string) => ({
    range: { [key.field]: key.direction === 'desc' ? { gt: v } : { lt: v } },
  });
  const fromRange = (v: number | string) => ({
    range: { [key.field]: key.direction === 'desc' ? { lte: v } : { gte: v } },
  });
  // `boolean` included: is_complete's block is a term on true/false, while its
  // SEEK value is the 0/1 OpenSearch puts in sort tuples.
  const blockAt = (v: number | string | boolean) =>
    (extra: unknown[] = []) => and(base, { term: { [key.field]: v } }, ...extra);

  // Documents missing the field sort last as their own block (~1.9M unclustered BGCs for gcf_id).
  probes += 1;
  const present = await count(and(base, { exists: { field: key.field } }));
  if (offset >= present) {
    const tail = (extra: unknown[] = []) => and(base, missing(key.field), ...extra);
    return {
      block: tail,
      // Nothing sorts after the missing block, so it is its own narrowed query.
      fromQuery: tail(),
      rankBefore: present,
      value: '',
      isTail: true,
      probes,
    };
  }

  if (key.kind === 'boolean') {
    // Two values: desc puts true first. Count the head and pick the side.
    const head = key.direction === 'desc';
    probes += 1;
    const headSize = await count(and(base, { term: { [key.field]: head } }));
    const value = offset < headSize ? head : !head;
    return {
      block: blockAt(value),
      fromQuery: offset < headSize
        ? anyOf(base, { term: { [key.field]: head } }, { term: { [key.field]: !head } }, missing(key.field))
        : anyOf(base, { term: { [key.field]: !head } }, missing(key.field)),
      rankBefore: offset < headSize ? 0 : headSize,
      value: value ? 1 : 0,
      isTail: false,
      probes,
    };
  }

  if (key.kind === 'ordered') {
    if (!aggregate) return null;

    // Walk values in key order with a composite aggregation, summing counts until the
    // block holding `offset`; from whichever end is nearer.
    const fromStart = offset <= present / 2;
    const walkOrder: 'asc' | 'desc' = fromStart
      ? key.direction
      : (key.direction === 'asc' ? 'desc' : 'asc');

    let after: Record<string, unknown> | undefined;
    let seen = 0;                       // documents passed, from the walked end
    for (let request = 0; request < MAX_COMPOSITE_REQUESTS; request += 1) {
      const composite: Record<string, unknown> = {
        size: COMPOSITE_PAGE,
        sources: [{ k: { terms: { field: key.field, order: walkOrder } } }],
      };
      if (after) composite.after = after;
      probes += 1;
      const response = await aggregate({
        size: 0, query: base, aggs: { walk: { composite } },
      }) as { aggregations?: { walk?: {
        buckets?: Array<{ key: Record<string, string>; doc_count: number }>;
        after_key?: Record<string, unknown>;
      } } };

      const walk = response.aggregations?.walk;
      const buckets = walk?.buckets ?? [];
      if (buckets.length === 0) break;

      for (const bucket of buckets) {
        // Rank of this value's first document, whichever way we are walking.
        const rank = fromStart ? seen : present - seen - bucket.doc_count;
        if (rank <= offset && offset < rank + bucket.doc_count) {
          const value = bucket.key.k;
          return {
            block: blockAt(value),
            fromQuery: anyOf(base, fromRange(value), missing(key.field)),
            rankBefore: rank,
            value,
            isTail: false,
            probes,
          };
        }
        seen += bucket.doc_count;
      }

      after = walk?.after_key;
      if (!after) break;
    }
    // Ran out of budget before reaching the offset: refuse rather than guess.
    return null;
  }

  if (key.kind === 'terms') {
    if (!aggregate) return null;
    probes += 1;
    const response = await aggregate({
      size: 0,
      query: base,
      aggs: { values: { terms: { field: key.field, size: ENUMERABLE_VALUE_CEILING } } },
    }) as { aggregations?: { values?: { buckets?: Array<{ key: string }>; sum_other_doc_count?: number } } };
    const agg = response.aggregations?.values;
    const buckets = agg?.buckets ?? [];
    // A truncated list would land the boundary on the wrong value rather than fail.
    if (buckets.length === 0 || (agg?.sum_other_doc_count ?? 0) > 0) return null;

    const values = buckets.map((bucket) => bucket.key).sort();
    if (key.direction === 'desc') values.reverse();

    // `before` is non-decreasing along the sort order, so the block holding the
    // offset is the LAST value whose count still fits under it.
    let lo2 = 0;
    let hi2 = values.length - 1;
    let chosen = values[0];
    let rank = 0;
    while (lo2 <= hi2) {
      const mid = Math.floor((lo2 + hi2) / 2);
      probes += 1;
      const scanned = await count(and(base, before(values[mid])));
      if (scanned <= offset) {
        chosen = values[mid];
        rank = scanned;
        lo2 = mid + 1;
      } else {
        hi2 = mid - 1;
      }
    }

    // `must_not` of a range also admits documents lacking the field, which is
    // right: they sort last, so they belong to everything-from-here-onward.
    const nothingAfter = { bool: { must_not: [before(chosen)] } };
    return {
      block: (extra: unknown[] = []) => and(base, { term: { [key.field]: chosen } }, nothingAfter, ...extra),
      fromQuery: and(base, nothingAfter),
      rankBefore: rank,
      value: chosen,
      isTail: false,
      probes,
    };
  }

  let lo: number;
  let hi: number;
  if (key.kind === 'uuid') {
    lo = 0;
    hi = ID_PREFIX_MAX;
  } else {
    const extreme = async (order: 'asc' | 'desc') => {
      probes += 1;
      const tuples = await seek({
        size: 1, track_total_hits: false, _source: false, query: base,
        sort: [{ [key.field]: { order } }],
      });
      const value = tuples[0]?.[0];
      return typeof value === 'number' ? value : null;
    };
    const [low, high] = await Promise.all([extreme('asc'), extreme('desc')]);
    if (low === null || high === null) return null;
    lo = low;
    hi = high;
  }

  const asValue = (n: number): number | string => (key.kind === 'uuid' ? uuidFrom(n) : n);
  const integral = key.kind === 'uuid' || !key.float;
  const domainLo = lo;
  const domainHi = hi;
  let valuePos = key.direction === 'desc' ? hi : lo;
  let value: number | string = asValue(valuePos);
  let rankBefore = 0;

  // Interpolate rather than bisect for ids: uuid5 ids are uniform, so the first count is
  // narrow (a broad id range costs seconds). Numeric fields are skewed and keep bisecting.
  const interpolating = key.kind === 'uuid';
  // Known endpoints, free of charge: nothing sorts before the first value, and
  // everything sorts before the last.
  let loCount = key.direction === 'desc' ? present : 0;
  let hiCount = key.direction === 'desc' ? 0 : present;

  for (let step = 0; step < 60 && lo <= hi; step += 1) {
    let mid: number;
    if (interpolating && loCount !== hiCount) {
      const span = hiCount - loCount;
      const guess = lo + ((offset - loCount) / span) * (hi - lo);
      // Keep it strictly inside the bracket, or a degenerate guess stalls.
      mid = Math.min(hi - 1, Math.max(lo + 1, Math.round(guess)));
      if (mid <= lo || mid >= hi) mid = Math.floor((lo + hi) / 2);
    } else {
      mid = integral ? Math.floor((lo + hi) / 2) : (lo + hi) / 2;
    }
    const candidate = asValue(mid);
    probes += 1;
    const scanned = await count(and(base, before(candidate)));
    if (scanned <= offset) {
      value = candidate;
      valuePos = mid;
      rankBefore = scanned;
      if (offset - scanned <= maxRemainder(limit)) break;
      if (key.direction === 'desc') { hi = integral ? mid - 1 : mid; hiCount = scanned; }
      else { lo = integral ? mid + 1 : mid; loCount = scanned; }
    } else if (key.direction === 'desc') {
      lo = integral ? mid + 1 : mid;
      loCount = scanned;
    } else {
      hi = integral ? mid - 1 : mid;
      hiCount = scanned;
    }
    if (!integral && Math.abs(hi - lo) < 1e-9) break;
    if (probes > 45) return null;
  }

  // Bound the far side too: a one-sided `id <= v` can match nearly the whole corpus and
  // the fetch must sort it all. The window width is an estimate, checked and widened;
  // exhausting the attempts falls back to the one-sided query, slow but correct.
  const needed = offset - rankBefore + limit + 1;
  let fromQuery: Record<string, unknown> = anyOf(base, fromRange(value), missing(key.field));
  let width = Math.max(1, Math.ceil(((domainHi - domainLo) * needed) / Math.max(present, 1)) * 4);

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const farPos = key.direction === 'desc' ? valuePos - width : valuePos + width;
    const clamped = Math.max(domainLo, Math.min(domainHi, farPos));
    const far = asValue(clamped);
    const window = key.direction === 'desc'
      ? { range: { [key.field]: { gte: far, lte: value } } }
      : { range: { [key.field]: { lte: far, gte: value } } };
    probes += 1;
    if (await count(and(base, window)) >= needed) {
      fromQuery = and(base, window);
      break;
    }
    // Reaching the end of the domain means the one-sided query is correct.
    if (clamped === domainLo || clamped === domainHi) break;
    width *= 4;
  }

  return {
    block: blockAt(value),
    // Falls back to: the block and everything after it, including the missing
    // documents, which sort after every value.
    fromQuery,
    rankBefore,
    value,
    isTail: false,
    probes,
  };
}

/** Resolve a deep page by counting, or null to leave it to the caller's fail-fast refusal. */
export interface PagedRequest {
  from: number;
  size: number;
  sort: unknown;
  query: Record<string, unknown>;
}

export async function planCountResolvedPage(
  /** The caller's built search; the property search over bgc_facets also uses this. */
  request: PagedRequest,
  count: (query: Record<string, unknown>) => Promise<number>,
  /** Fetch sort keys only: reads a numeric field's range, and walks a tie block
   *  the id bisection declines. */
  seek: (body: Record<string, unknown>) => Promise<unknown[][]>,
  /** Runs an aggregation, for sorts whose values are enumerable. */
  aggregate?: (body: Record<string, unknown>) => Promise<unknown>,
): Promise<CountResolvedPage | PastTheEnd | null> {
  const offset = request.from;
  const limit = request.size;

  if (offset + limit <= BROWSE_RESULT_WINDOW) return null;

  const key = leadingKey(request.sort);
  if (!key) return null;

  const base = request.query;
  let probes = 1;
  const total = await count(base);
  // Past the end there is nothing to resolve, and nothing to refuse either.
  if (offset >= total) return { pastEnd: true, total, probes };

  const boundary = await resolveLeadingBoundary(base, key, offset, limit, count, seek, aggregate);
  if (!boundary) return null;
  probes += boundary.probes;

  const query = boundary.fromQuery;
  let skip = offset - boundary.rankBefore;
  if (skip < 0) return null;

  if (skip > maxRemainder(limit) && boundary.isTail) {
    // A synthetic `search_after` cannot enter the missing block (no value; OpenSearch
    // uses a sentinel), so narrow instead: nothing sorts after it.
    const bisected = await bisectId(boundary.block, [], skip, limit, count);
    if (!bisected) return null;
    return {
      query: boundary.block([{ range: { bgc_id: { gte: bisected.id } } }]),
      sort: request.sort,
      from: bisected.remainder,
      size: limit,
      sliceFrom: 0,
      total,
      probes: probes + bisected.probes,
    };
  }

  if (skip > maxRemainder(limit)) {
    // Bisect the id first: ~8 counts versus a request per 10,000 documents for the walk.
    const seeked = await seekWithinBlock(
      boundary.block, request.sort as Array<Record<string, { order?: string }>>,
      boundary.value, skip, limit, count,
    );
    if (seeked) {
      return {
        query,
        sort: request.sort,
        after: seeked.after,
        from: 0,
        size: seeked.sliceFrom + limit,
        sliceFrom: seeked.sliceFrom,
        total,
        probes: probes + seeked.probes,
      };
    }
  }

  // Fallback for shapes the bisection declines: a bounded walk in window-sized strides.
  let after: unknown[] | undefined;
  let strides = 0;
  while (skip > maxRemainder(limit)) {
    strides += 1;
    if (strides > MAX_WALK_STRIDES) return null;
    const stride = Math.min(skip, BROWSE_RESULT_WINDOW);
    const body: Record<string, unknown> = {
      size: stride, track_total_hits: false, _source: false, query, sort: request.sort,
    };
    if (after) body.search_after = after;
    probes += 1;
    const tuples = await seek(body);
    // Fewer hits than asked means the block ended early; stop rather than guess.
    if (tuples.length < stride) return null;
    after = tuples[tuples.length - 1];
    skip -= stride;
  }

  return {
    query,
    sort: request.sort,
    after,
    from: after ? 0 : skip,
    size: after ? skip + limit : limit,
    sliceFrom: after ? skip : 0,
    total,
    probes,
  };
}

export const countResolvedPageBody = (plan: CountResolvedPage): Record<string, unknown> => ({
  ...(plan.after ? { search_after: plan.after } : { from: plan.from }),
  size: plan.size,
  // The narrowed query's hit count starts at the boundary, so the pager gets the unnarrowed total.
  track_total_hits: false,
  query: plan.query,
  sort: plan.sort,
});
