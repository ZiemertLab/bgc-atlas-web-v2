// Filters and sort come from buildBrowseSearchRequest, as in the list routes, so the file matches
// the table; its sort ends on the entity id, the unique tiebreak search_after needs. Server only.
import {
  closeBrowsePit,
  countBrowseIndex,
  openBrowsePit,
  searchBrowsePit,
} from '@/lib/opensearch/browse-client';
import { buildBrowseFilters, buildBrowseSearchRequest, type BrowseEntity } from '@/lib/opensearch/browse-query';
import { EXPORT_BATCH, type ExportSource } from '@/lib/export/stream';

/** Covers the slowest batch (cold sample enrichment: 8.7 s per 4,477 rows); renewed every page. */
const PIT_KEEP_ALIVE = '5m';

type Doc = Record<string, unknown>;

export async function countBrowseExport(entity: BrowseEntity, params: URLSearchParams): Promise<number> {
  const filters = buildBrowseFilters(entity, params);
  return countBrowseIndex(entity, filters.length ? { bool: { filter: filters } } : { match_all: {} });
}

// `map` must throw rather than return rows with a column silently missing.
export async function openBrowseExport<T>(
  entity: BrowseEntity,
  params: URLSearchParams,
  cap: number,
  map: (docs: Doc[]) => Promise<T[]>,
): Promise<ExportSource<T>> {
  const request = buildBrowseSearchRequest(entity, params) as {
    query: Record<string, unknown>;
    sort: unknown[];
  };
  const pitId = await openBrowsePit(entity, PIT_KEEP_ALIVE);
  const page = (size: number, searchAfter?: unknown[], trackTotal = false) => searchBrowsePit({
    pit: { id: pitId, keep_alive: PIT_KEEP_ALIVE },
    query: request.query,
    sort: request.sort,
    size,
    track_total_hits: trackTotal,
    ...(searchAfter ? { search_after: searchAfter } : {}),
  });

  try {
    const head = await page(Math.min(EXPORT_BATCH, cap), undefined, true);
    const total = head.total ?? head.hits.length;
    const wanted = Math.min(total, cap);
    const first = await map(head.hits.map((h) => h.source));

    async function* rest(): AsyncGenerator<T[], void, void> {
      let fetched = head.hits.length;
      let after = head.hits.at(-1)?.sort;
      let lastSize = head.hits.length;
      while (fetched < wanted && after && lastSize > 0) {
        const next = await page(Math.min(EXPORT_BATCH, wanted - fetched), after);
        if (next.hits.length === 0) return;
        fetched += next.hits.length;
        lastSize = next.hits.length;
        after = next.hits.at(-1)?.sort;
        yield await map(next.hits.map((h) => h.source));
      }
    }

    return { total, first, rest: rest(), close: () => closeBrowsePit(pitId) };
  } catch (error) {
    await closeBrowsePit(pitId);
    throw error;
  }
}
