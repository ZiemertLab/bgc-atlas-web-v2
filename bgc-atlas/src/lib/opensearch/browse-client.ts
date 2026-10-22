import { NextResponse } from 'next/server';
import { AsyncLocalStorage } from 'node:async_hooks';
import { buildBrowseSearchRequest, type BrowseEntity } from './browse-query';
import { osRequest } from './http';
import { DEEP_PAGE_CODE } from '@/lib/api/refusal-codes';

const indexByEntity: Record<BrowseEntity, string> = {
  bgcs: process.env.OPENSEARCH_BGC_BROWSE_INDEX || 'bgc_browse',
  gcfs: process.env.OPENSEARCH_GCF_BROWSE_INDEX || 'gcf_browse',
  samples: process.env.OPENSEARCH_SAMPLE_BROWSE_INDEX || 'sample_browse',
};

export interface BrowseSearchResult {
  total: number;
  documents: Record<string, unknown>[];
}

type Env = Record<string, string | undefined>;

export function isBrowseSearchEnabled(entity: BrowseEntity, env: Env = process.env): boolean {
  const global = env.OPENSEARCH_BROWSE_ENABLED?.toLowerCase() === 'true';
  const specific = env[`OPENSEARCH_BROWSE_${entity.toUpperCase()}_ENABLED`]?.toLowerCase() === 'true';
  return global || specific;
}

export function parseBrowseSearchResponse(response: unknown): BrowseSearchResult {
  const hits = (response as {
    hits?: { total?: { value?: number } | number; hits?: Array<{ _source?: Record<string, unknown> }> };
  }).hits;
  const total = typeof hits?.total === 'number' ? hits.total : hits?.total?.value ?? 0;
  return {
    total,
    documents: (hits?.hits ?? []).flatMap((hit) => hit._source ? [hit._source] : []),
  };
}

/** A non-2xx answer from the browse index, with its status kept for isTransientBrowseError. */
export class BrowseIndexHttpError extends Error {
  /** OpenSearch's root_cause[0].type, e.g. 'query_shard_exception', when the body said. */
  readonly rootCauseType: string | undefined;
  /** And its reason, for the log -- never shown to the caller: it names indexes. */
  readonly rootCauseReason: string | undefined;

  constructor(readonly status: number, text: string) {
    super(`OpenSearch ${status}: ${text.slice(0, 300)}`);
    this.name = 'BrowseIndexHttpError';
    try {
      const cause = (JSON.parse(text) as { error?: { root_cause?: { type?: unknown; reason?: unknown }[] } })
        ?.error?.root_cause?.[0];
      this.rootCauseType = typeof cause?.type === 'string' ? cause.type : undefined;
      this.rootCauseReason = typeof cause?.reason === 'string' ? cause.reason : undefined;
    } catch {
      this.rootCauseType = undefined;
      this.rootCauseReason = undefined;
    }
  }
}

/**
 * The index refused the QUERY, not the request's timing: a value it cannot use (a
 * number out of range for the field), or a page past its result window. Retrying
 * cannot help and neither can the SQL fallback -- every one of these in the log was
 * bad input, and the fallback spent up to 45 s and two of the pool's connections to
 * reach a 503 that blamed the index. OpenSearch answers an out-of-range INT with a
 * 500 (input_coercion_exception), so that one is a refusal too, not an outage.
 */
export function isBrowseQueryRejection(error: unknown): error is BrowseIndexHttpError {
  if (!(error instanceof BrowseIndexHttpError)) return false;
  if (error.status === 400) return true;
  return error.status === 500 && error.rootCauseType === 'input_coercion_exception';
}

/** The caller's answer for isBrowseQueryRejection: a 400 that says what to change. */
export function browseQueryRejectionResponse(error: BrowseIndexHttpError, what: string): NextResponse {
  const pastWindow = /result window is too large/i.test(error.rootCauseReason ?? '');
  console.warn(`${what}: the index refused the query (${error.status} ${error.rootCauseType ?? 'unknown'}): `
    + `${(error.rootCauseReason ?? '').slice(0, 200)}`);
  return NextResponse.json(
    {
      success: false,
      // A page past the window is the deep-page refusal by another route, so the
      // list keeps its pager. A value the index cannot use stays code-less: it
      // does not name the filter, so the page shows the sentence alone.
      ...(pastWindow ? { code: DEEP_PAGE_CODE } : {}),
      error: pastWindow
        ? 'Cannot page this far into the results. Narrow the filters or sort the other way.'
        : 'A value in this query is outside what the search accepts, for example a number '
          + 'that is too large. Check the filter values.',
    },
    { status: 400 },
  );
}

/** Per-call timeout for browse-index requests; withBrowseTimeout narrows it. */
const DEFAULT_BROWSE_TIMEOUT_MS = 20_000;
const browseTimeout = new AsyncLocalStorage<number>();

/**
 * Run `fn` with every browse-index request inside it limited to `timeoutMs`. A
 * retry after a stall uses this: the deep-page resolver may make dozens of calls,
 * and threading a timeout through each of their signatures would be noise.
 */
export function withBrowseTimeout<T>(timeoutMs: number, fn: () => Promise<T>): Promise<T> {
  return browseTimeout.run(timeoutMs, fn);
}

/**
 * Whether a browse-index failure is worth one more try: a timeout, a connection
 * that failed, or OpenSearch saying it is overloaded or broken (429, 5xx). A 4xx
 * is about the request -- a page past the result window, an unmapped field -- and
 * asking again gets the same answer.
 */
export function isTransientBrowseError(error: unknown): boolean {
  if (isBrowseQueryRejection(error)) return false;
  if (error instanceof BrowseIndexHttpError) return error.status === 429 || error.status >= 500;
  if (!(error instanceof Error)) return false;
  // AbortSignal.timeout rejects with a DOMException named TimeoutError; undici
  // reports a refused or reset connection as TypeError('fetch failed') with the
  // socket error as its cause.
  if (error.name === 'TimeoutError' || error.name === 'AbortError') return true;
  return error instanceof TypeError && error.message === 'fetch failed';
}

async function postToBrowseIndex(
  entity: BrowseEntity,
  body: Record<string, unknown>,
  endpoint: '_search' | '_count' = '_search',
): Promise<unknown> {
  const response = await osRequest(`/${indexByEntity[entity]}/${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(browseTimeout.getStore() ?? DEFAULT_BROWSE_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new BrowseIndexHttpError(response.status, await response.text());
  }
  return response.json();
}

export async function searchBrowseIndex(entity: BrowseEntity, params: URLSearchParams): Promise<BrowseSearchResult> {
  return parseBrowseSearchResponse(await postToBrowseIndex(entity, buildBrowseSearchRequest(entity, params)));
}

/** How many documents match, without fetching any; deep paging resolves ranks with counts. */
export async function countBrowseIndex(
  entity: BrowseEntity,
  query: Record<string, unknown>,
): Promise<number> {
  const response = await postToBrowseIndex(entity, { query }, '_count');
  return (response as { count?: number }).count ?? 0;
}

/** Runs a caller-built search body; deep paging needs it for `search_after`. */
export async function searchBrowseIndexWithBody(
  entity: BrowseEntity,
  body: Record<string, unknown>,
): Promise<BrowseSearchResult> {
  return parseBrowseSearchResponse(await postToBrowseIndex(entity, body));
}

/** Hits suppressed. Summary panels pass a body from `buildBrowseFilters` so they
 *  aggregate the rows the table lists. */
export async function aggregateBrowseIndex(entity: BrowseEntity, body: Record<string, unknown>): Promise<unknown> {
  return postToBrowseIndex(entity, body);
}

/** Only each hit's sort keys; deep paging walks tie blocks this way with `_source: false`. */
export async function sortKeysBrowseIndex(
  entity: BrowseEntity,
  body: Record<string, unknown>,
): Promise<unknown[][]> {
  const response = await postToBrowseIndex(entity, body);
  const hits = (response as { hits?: { hits?: Array<{ sort?: unknown[] }> } }).hits?.hits ?? [];
  return hits.flatMap((hit) => (hit.sort ? [hit.sort] : []));
}

/**
 * Opens a point-in-time on an entity's browse alias. Resolved to the concrete index
 * at open, so an alias swap during a long read cannot duplicate or skip rows.
 */
export async function openBrowsePit(entity: BrowseEntity, keepAlive: string): Promise<string> {
  const response = await osRequest(`/${indexByEntity[entity]}/_search/point_in_time?keep_alive=${encodeURIComponent(keepAlive)}`,
    { method: 'POST', signal: AbortSignal.timeout(20_000) },
  );
  if (!response.ok) {
    throw new Error(`OpenSearch PIT ${response.status}: ${(await response.text()).slice(0, 300)}`);
  }
  const pitId = (await response.json() as { pit_id?: string }).pit_id;
  if (!pitId) throw new Error('OpenSearch PIT: no pit_id in response');
  return pitId;
}

export interface BrowsePitPage {
  total: number | null;
  hits: { source: Record<string, unknown>; sort: unknown[] | undefined }[];
}

/** One page of a point-in-time read. The body carries `pit`, so no index in the URL. */
export async function searchBrowsePit(body: Record<string, unknown>): Promise<BrowsePitPage> {
  const response = await osRequest(`/_search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) {
    throw new Error(`OpenSearch ${response.status}: ${(await response.text()).slice(0, 300)}`);
  }
  const hits = (await response.json() as {
    hits?: {
      total?: { value?: number } | number;
      hits?: Array<{ _source?: Record<string, unknown>; sort?: unknown[] }>;
    };
  }).hits;
  const total = typeof hits?.total === 'number' ? hits.total : hits?.total?.value ?? null;
  return {
    total,
    hits: (hits?.hits ?? []).map((hit) => ({ source: hit._source ?? {}, sort: hit.sort })),
  };
}

/** Release a point-in-time. Best effort: an unreleased one expires with its keep-alive. */
export async function closeBrowsePit(pitId: string): Promise<void> {
  try {
    await osRequest(`/_search/point_in_time`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pit_id: [pitId] }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch (error) {
    console.warn('OpenSearch PIT close failed; it will expire on its own', error);
  }
}
