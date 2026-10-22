import { Prisma } from '@prisma/client';

import prisma from '@/lib/prisma';
import { getOrSetCache } from '@/lib/cache';
import { bgcFacetDocs } from '@/lib/opensearch/client';
import { nullableString, sampleMapRows, type SampleMapRow } from '@/lib/map/sample-map-rows';
import { getHitBgcIds, type SequenceHitFilters } from './database';

// BGC -> sample -> coordinates is read from the bgc_facets and sample_browse indexes. As a
// Postgres join (one primary-key lookup chain per hit BGC) it was ~0.5 s warm but ~120 s cold
// on a large search; it survives only for ids an index lacks. Results are cached, and the
// queue worker warms the cache after a search completes.

/** The table's filters, the contig of a selected locus (queryId) among them. */
export type SequenceMapFilters = SequenceHitFilters;

export type SequenceMapSampleRow = SampleMapRow;

export const MAX_MAP_LIMIT = 5000;

const COMPLETED_TTL_SECONDS = 24 * 60 * 60;
const RUNNING_TTL_SECONDS = 30;

function cacheKey(sessionId: string, filters: SequenceMapFilters): string {
  const parts = [
    filters.minIdentity ?? '',
    filters.minCoverage ?? '',
    filters.queryFrom ?? '',
    filters.queryTo ?? '',
    filters.queryId ?? '',
  ].join('|');
  return `seqsearch:samplemap:v1:${sessionId}:${parts}`;
}

/** BGC -> sample for the hit BGCs: from the index, the join only for what it lacks. */
async function sampleIdsForBgcs(bgcIds: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  try {
    for (const [bgcId, doc] of await bgcFacetDocs(bgcIds, ['sample_id'])) {
      const sampleId = nullableString(doc.sample_id);
      if (sampleId) out.set(bgcId, sampleId);
    }
  } catch (error) {
    console.warn(`Could not resolve ${bgcIds.length} BGC samples from OpenSearch; using Postgres:`, error);
  }
  const missing = bgcIds.filter((id) => !out.has(id));
  if (missing.length) {
    const rows = await prisma.$queryRaw<Array<{ bgc_id: string; sample_id: string }>>(Prisma.sql`
      SELECT b.id::text AS bgc_id, sa.sample_id::text AS sample_id
      FROM bgcs b
      JOIN sample_assemblies sa ON sa.assembly_id = b.assembly
      WHERE b.id = ANY(${missing}::uuid[])
    `);
    for (const row of rows) out.set(row.bgc_id, row.sample_id);
  }
  return out;
}

async function runQuery(
  sessionId: string,
  filters: SequenceMapFilters,
): Promise<SequenceMapSampleRow[]> {
  // The same filters the results table applies, so the map describes the set on screen.
  // Only the session's own rows come from Postgres; the BGC -> sample -> coordinates walk
  // is keyed index reads. An assembly belongs to exactly one sample, so the index's single
  // sample_id per BGC is the join's answer, not a simplification of it.
  const bgcSamples = await sampleIdsForBgcs(await getHitBgcIds(sessionId, filters));

  const bgcHits = new Map<string, number>();
  for (const sampleId of bgcSamples.values()) bgcHits.set(sampleId, (bgcHits.get(sampleId) ?? 0) + 1);
  return sampleMapRows(bgcHits, MAX_MAP_LIMIT);
}

export function getSequenceSampleMap(
  sessionId: string,
  filters: SequenceMapFilters,
  isCompleted: boolean,
): Promise<SequenceMapSampleRow[]> {
  return getOrSetCache(
    cacheKey(sessionId, filters),
    () => runQuery(sessionId, filters),
    isCompleted ? COMPLETED_TTL_SECONDS : RUNNING_TTL_SECONDS,
  );
}

// Warms the unfiltered map, which is what the panel requests by default. Never throws.
export async function warmSequenceSampleMap(sessionId: string): Promise<void> {
  try {
    const rows = await getSequenceSampleMap(sessionId, {}, true);
    console.log(`Warmed sample map for session ${sessionId} (${rows.length} samples)`);
  } catch (error) {
    console.warn(`Could not warm the sample map for session ${sessionId}:`, error);
  }
}
