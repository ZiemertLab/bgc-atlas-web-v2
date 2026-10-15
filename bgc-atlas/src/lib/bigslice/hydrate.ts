// Reads gcf_browse directly for a known id list rather than via /api/gcfs, whose `id` filter
// takes one value.
import {
  aggregateBrowseIndex,
  isBrowseSearchEnabled,
  parseBrowseSearchResponse,
} from '@/lib/opensearch/browse-client';
import { mapGcfBrowseDocument } from '@/lib/opensearch/gcf-browse-mapper';
import { fetchGcfDocumentsFromPostgres } from '@/lib/gcf/postgres-documents';

export type HydratedGcf = ReturnType<typeof mapGcfBrowseDocument>;

/** OpenSearch's default `terms` ceiling; a job cannot produce more distinct families. */
const MAX_IDS = 1024;

// The index holds listed families only; the rest are filled from Postgres. Ids still missing are
// MIBiG-only reference families with no atlas row.
export async function hydrateGcfs(gcfIds: string[]): Promise<Map<string, HydratedGcf>> {
  const ids = Array.from(new Set(gcfIds.filter(Boolean))).slice(0, MAX_IDS);
  if (ids.length === 0) return new Map();

  if (!isBrowseSearchEnabled('gcfs')) {
    const byId = new Map<string, HydratedGcf>();
    await fillFromPostgres(ids, byId);
    return byId;
  }

  try {
    const response = await aggregateBrowseIndex('gcfs', {
      size: ids.length,
      query: { terms: { gcf_id: ids } },
    });
    const { documents } = parseBrowseSearchResponse(response);

    const byId = new Map<string, HydratedGcf>();
    for (const document of documents) {
      const mapped = mapGcfBrowseDocument(document as Parameters<typeof mapGcfBrowseDocument>[0]);
      if (mapped.id) byId.set(mapped.id, mapped);
    }

    await fillFromPostgres(ids.filter((id) => !byId.has(id)), byId);
    return byId;
  } catch (error) {
    // Enrichment only: losing it must not lose the assignment.
    console.error('Failed to hydrate GCFs for a BiG-SLiCE result set:', error);
    // Fall back to Postgres wholesale when OpenSearch is unreachable.
    const byId = new Map<string, HydratedGcf>();
    await fillFromPostgres(ids, byId);
    return byId;
  }
}

/** Hydrate `missing` from Postgres and merge into `byId`. Never throws. */
async function fillFromPostgres(missing: string[], byId: Map<string, HydratedGcf>): Promise<void> {
  if (missing.length === 0) return;
  try {
    const documents = await fetchGcfDocumentsFromPostgres(missing);
    for (const document of documents) {
      const mapped = mapGcfBrowseDocument(document as Parameters<typeof mapGcfBrowseDocument>[0]);
      if (mapped.id) byId.set(mapped.id, mapped);
    }
  } catch (error) {
    console.error('Postgres fallback for unindexed GCFs failed:', error);
  }
}
