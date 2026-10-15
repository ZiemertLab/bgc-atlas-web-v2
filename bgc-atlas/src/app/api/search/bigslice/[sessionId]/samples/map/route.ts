// Samples where the matched families occur, from the pre-aggregated
// gcf_sample_map_mv (~2 s for a large result set; the panel fetches on open).
// Memberships only: a hit past 0.4 is a nearest family, not one the query belongs to.
import { NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';

import prisma from '@/lib/prisma';
import { getOrSetCacheWithMetadata } from '@/lib/cache';
import { stripSourcePrefix } from '@/lib/utils/sample-id';
import { CLUSTERING_THRESHOLD } from '@/lib/bigslice/families';
import { serverError } from '@/lib/api/errors';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const MAX_MAP_LIMIT = 5000;

type MapRow = {
  id: string;
  external_id: string | null;
  name: string | null;
  geographic_location: string | null;
  geolocation_name: string | null;
  latitude: Prisma.Decimal | number | null;
  longitude: Prisma.Decimal | number | null;
  environment_biome: string | null;
  primary_biome: string | null;
  environment_feature: string | null;
  environment_material: string | null;
  host_scientific_name: string | null;
  data_source_names: string[] | null;
  study_titles: string[] | null;
  assembly_count: number | null;
  bgc_count: number | null;
  source_types: string[] | null;
  gold_ecosystem_path: string | null;
  families_here: number;
};

export async function GET(
  request: Request,
  context: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId } = await context.params;
  if (!UUID_RE.test(sessionId)) {
    return NextResponse.json(
      { success: false, error: 'Invalid session ID format' },
      { status: 400 },
    );
  }

  const cacheKey = `bigslice:map:${sessionId}`;

  try {
    const { data: payload, isHit } = await getOrSetCacheWithMetadata(cacheKey, async () => {
      // Resolved in their own round trip and inlined: a subquery would leave the
      // planner guessing at the join size.
      const memberFamilies = await prisma.$queryRaw<{ gcf_id: string }[]>`
        SELECT DISTINCT gcf_id
        FROM bigslice_search_results
        WHERE session_id = ${sessionId}
          AND gcf_id IS NOT NULL
          AND distance <= ${CLUSTERING_THRESHOLD}
      `;
      const gcfIds = memberFamilies.map((row) => row.gcf_id);
      if (gcfIds.length === 0) {
        return { success: true, data: [], total: 0, families: 0, limit: MAX_MAP_LIMIT };
      }

      // One row per sample, not per (family, sample), so a coordinate is drawn once.
      const dataQuery = Prisma.sql`
        SELECT DISTINCT ON (m.id)
          m.id, m.external_id, m.name, m.geographic_location, m.geolocation_name,
          m.latitude, m.longitude, m.environment_biome, m.primary_biome,
          m.environment_feature, m.environment_material, m.host_scientific_name,
          m.data_source_names, m.study_titles, m.assembly_count, m.bgc_count,
          m.source_types, ss.gold_ecosystem_path,
          COUNT(*) OVER (PARTITION BY m.id)::int AS families_here
        FROM gcf_sample_map_mv m
        LEFT JOIN sample_summary ss ON ss.id = m.id
        WHERE m.gcf_id = ANY(${gcfIds}::uuid[])
        ORDER BY m.id, m.bgc_count_from_gcf DESC
        LIMIT ${MAX_MAP_LIMIT}
      `;

      const countQuery = Prisma.sql`
        SELECT COUNT(DISTINCT id)::int AS total
        FROM gcf_sample_map_mv
        WHERE gcf_id = ANY(${gcfIds}::uuid[])
      `;

      const [rows, countResult] = await Promise.all([
        prisma.$queryRaw<MapRow[]>(dataQuery),
        prisma.$queryRaw<{ total: number }[]>(countQuery),
      ]);

      const data = rows.map((row) => {
        const latitude = row.latitude !== null && row.latitude !== undefined ? Number(row.latitude) : undefined;
        const longitude = row.longitude !== null && row.longitude !== undefined ? Number(row.longitude) : undefined;
        const locationLabel = row.geographic_location
          ?? row.geolocation_name
          ?? (latitude !== undefined && longitude !== undefined
            ? `${latitude.toFixed(4)}, ${longitude.toFixed(4)}`
            : null);

        return {
          id: row.id,
          externalId: stripSourcePrefix(row.external_id) ?? null,
          name: row.name ?? null,
          location: locationLabel,
          latitude,
          longitude,
          environmentBiome: row.primary_biome ?? row.environment_biome ?? null,
          goldEcosystemPath: row.gold_ecosystem_path ?? null,
          environmentFeature: row.environment_feature ?? null,
          environmentMaterial: row.environment_material ?? null,
          hostScientificName: row.host_scientific_name ?? null,
          dataSourceNames: Array.isArray(row.data_source_names) ? row.data_source_names : [],
          studyTitles: Array.isArray(row.study_titles) ? row.study_titles : [],
          assemblyCount: row.assembly_count ?? 0,
          bgcCount: row.bgc_count ?? 0,
          sourceTypes: Array.isArray(row.source_types) ? row.source_types : [],
        };
      });

      return {
        success: true,
        data,
        total: countResult?.[0]?.total ?? data.length,
        families: gcfIds.length,
        limit: MAX_MAP_LIMIT,
      };
    }, 300);

    console.log(`[API] BiG-SLiCE map samples for ${sessionId}. Cache Hit: ${isHit}`);

    const response = NextResponse.json(payload);
    response.headers.set('X-Cache', isHit ? 'HIT' : 'MISS');
    return response;
  } catch (error) {
    return serverError(error, 'Error building the BiG-SLiCE result map');
  }
}
