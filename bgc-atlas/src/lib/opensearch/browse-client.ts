import { buildBrowseSearchRequest, type BrowseEntity } from './browse-query';
import { osRequest } from './http';

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

async function postToBrowseIndex(
  entity: BrowseEntity,
  body: Record<string, unknown>,
  endpoint: '_search' | '_count' = '_search',
): Promise<unknown> {
  const response = await osRequest(`/${indexByEntity[entity]}/${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) {
    throw new Error(`OpenSearch ${response.status}: ${(await response.text()).slice(0, 300)}`);
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
