import { Prisma } from '@prisma/client';

import prisma from '@/lib/prisma';
import { getOrSetCache } from '@/lib/cache';

// ~0.5 s warm but ~120 s cold on a large search (one PK lookup chain per hit BGC), hence the
// cache and the worker warming it. Going via sample_map_view/assembly_samples_mv is slower.

export interface SequenceMapFilters {
  minIdentity?: number;
  minCoverage?: number;
  queryFrom?: number;
  queryTo?: number;
}

export interface SequenceMapSampleRow {
  id: string;
  externalId: string | null;
  name: string | null;
  location: string | null;
  latitude?: number;
  longitude?: number;
  environmentBiome: string | null;
  goldEcosystemPath: string | null;
  environmentMaterial: string | null;
  environmentFeature: string | null;
  hostScientificName: string | null;
  dataSourceNames: string[];
  studyTitles: string[];
  assemblyCount: number;
  bgcCount: number;
  sourceTypes: string[];
}

interface MapRow {
  id: string;
  external_id: string | null;
  name: string | null;
  latitude: Prisma.Decimal | number | null;
  longitude: Prisma.Decimal | number | null;
  geographic_location: string | null;
  environment_biome: string | null;
  gold_ecosystem_path: string | null;
  environment_feature: string | null;
  environment_material: string | null;
  host_scientific_name: string | null;
  bgc_hits: number;
}

export const MAX_MAP_LIMIT = 5000;

const COMPLETED_TTL_SECONDS = 24 * 60 * 60;
const RUNNING_TTL_SECONDS = 30;

function cacheKey(sessionId: string, filters: SequenceMapFilters): string {
  const parts = [
    filters.minIdentity ?? '',
    filters.minCoverage ?? '',
    filters.queryFrom ?? '',
    filters.queryTo ?? '',
  ].join('|');
  return `seqsearch:samplemap:v1:${sessionId}:${parts}`;
}

async function runQuery(
  sessionId: string,
  filters: SequenceMapFilters,
): Promise<SequenceMapSampleRow[]> {
  const conditions: Prisma.Sql[] = [
    Prisma.sql`r.session_id = ${sessionId}`,
    Prisma.sql`r.bgc_id IS NOT NULL`,
  ];
  if (filters.minIdentity !== undefined) conditions.push(Prisma.sql`r.identity >= ${filters.minIdentity}`);
  if (filters.minCoverage !== undefined) conditions.push(Prisma.sql`r.coverage >= ${filters.minCoverage}`);
  if (filters.queryFrom !== undefined && filters.queryTo !== undefined) {
    // Minus-strand hits store start > end, hence least/greatest.
    conditions.push(Prisma.sql`
      least(r.query_start, r.query_end) <= ${filters.queryTo}
      AND greatest(r.query_start, r.query_end) >= ${filters.queryFrom}
    `);
  }

  // Inner joins with the coordinate filter inside: the outer-join-then-count form takes ~32 s.
  const rows = await prisma.$queryRaw<MapRow[]>(Prisma.sql`
    WITH hit_bgcs AS (
      SELECT DISTINCT r.bgc_id
      FROM sequence_search_results r
      WHERE ${Prisma.join(conditions, ' AND ')}
    )
    SELECT
      s.id::text AS id,
      s.external_id,
      s.name,
      s.latitude,
      s.longitude,
      s.geographic_location,
      s.environment_biome,
      s.gold_ecosystem_path,
      s.environment_feature,
      s.environment_material,
      s.host_scientific_name,
      count(DISTINCT h.bgc_id)::int AS bgc_hits
    FROM hit_bgcs h
    JOIN bgcs b               ON b.id = h.bgc_id
    JOIN assemblies a         ON a.id = b.assembly
    JOIN sample_assemblies sa ON sa.assembly_id = a.id
    JOIN samples s            ON s.id = sa.sample_id
    WHERE s.latitude IS NOT NULL AND s.longitude IS NOT NULL
    GROUP BY s.id, s.external_id, s.name, s.latitude, s.longitude,
             s.geographic_location, s.environment_biome, s.gold_ecosystem_path,
             s.environment_feature, s.environment_material, s.host_scientific_name
    LIMIT ${MAX_MAP_LIMIT}
  `);

  return rows.map((row) => {
    const latitude = row.latitude === null || row.latitude === undefined ? undefined : Number(row.latitude);
    const longitude = row.longitude === null || row.longitude === undefined ? undefined : Number(row.longitude);
    return {
      id: row.id,
      externalId: row.external_id,
      name: row.name,
      location:
        row.geographic_location ??
        (latitude !== undefined && longitude !== undefined
          ? `${latitude.toFixed(4)}, ${longitude.toFixed(4)}`
          : null),
      latitude,
      longitude,
      environmentBiome: row.environment_biome,
      goldEcosystemPath: row.gold_ecosystem_path,
      environmentFeature: row.environment_feature,
      environmentMaterial: row.environment_material,
      hostScientificName: row.host_scientific_name,
      dataSourceNames: [] as string[],
      studyTitles: [] as string[],
      assemblyCount: 0,
      bgcCount: row.bgc_hits,
      sourceTypes: [] as string[],
    };
  });
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
