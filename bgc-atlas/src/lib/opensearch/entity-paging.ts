// Paging for the Property Search "Return" switcher: a terms aggregation ordered by
// count (composite is forward-only and key-ordered, so it cannot drive a pager), with
// an explicit ceiling that the UI must show.

/** Most entities reachable by paging; the ceiling is `search.max_buckets` (65,535),
 *  not cost, with headroom for family-scope sub-aggregations. */
export const ENTITY_CAP = 60_000;

/** Four filter sub-aggregations per candidate bucket is the limit. */
export const MAX_COHORTS = 4;
/** Family scope pass-1 terms ceiling, under `search.max_buckets` (65,535); test it
 *  against a broad union. Truncation drops the small endemic families a scope query
 *  looks for, hence `truncated` in the response. */
export const CANDIDATE_CAP = 60_000;
/** Candidates named in pass 2's terms clause; well under index.max_terms_count (65,536). */
export const CANDIDATE_LIMIT = 20_000;

export interface AggBucket { key: string; doc_count: number }

/** Buckets to request to cover `page`, never exceeding the cap. */
export const aggSize = (page: number, pageSize: number): number =>
  Math.min(ENTITY_CAP, Math.max(1, page) * Math.max(1, pageSize));

/** The slice of the returned buckets belonging to `page`. */
export const slicePage = (buckets: AggBucket[], page: number, pageSize: number): AggBucket[] => {
  const start = (Math.max(1, page) - 1) * Math.max(1, pageSize);
  return buckets.slice(start, start + Math.max(1, pageSize));
};

/** True when the requested page lies past the ceiling, so the UI can say so. */
export const pageIsCapped = (page: number, pageSize: number): boolean =>
  (Math.max(1, page) - 1) * Math.max(1, pageSize) >= ENTITY_CAP;
