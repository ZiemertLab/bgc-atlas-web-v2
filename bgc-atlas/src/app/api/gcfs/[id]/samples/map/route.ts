import { NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';

import prisma from '@/lib/prisma';
import { getOrSetCacheWithMetadata } from '@/lib/cache';
import { stripSourcePrefix } from '@/lib/utils/sample-id';
import { serverError } from '@/lib/api/errors';

const MAX_MAP_LIMIT = 5000;

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isValidUuid(value: string): boolean {
  return UUID_REGEX.test(value);
}

type MapRow = {
  gcf_id: string;
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
  assembly_count: number;
  bgc_count: number;
  source_types: string[] | null;
  bgc_count_from_gcf: number;
  assembly_count_from_gcf: number;
  gold_ecosystem_path: string | null;
};

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id: gcfId } = await context.params;

  if (!isValidUuid(gcfId)) {
    return NextResponse.json(
      {
        success: false,
        error: 'Invalid GCF ID',
        message: 'The provided GCF ID is not a valid UUID',
      },
      { status: 400 }
    );
  }

  const cacheKey = `gcf:${gcfId}:samples:map`;

  try {
    const { data: payload, isHit } = await getOrSetCacheWithMetadata(cacheKey, async () => {
      console.log(`[API] Cache MISS for key: ${cacheKey} - Fetching from DB`);

      const dataQuery = Prisma.sql`
        SELECT
          m.gcf_id,
          m.id,
          m.external_id,
          m.name,
          m.geographic_location,
          m.geolocation_name,
          m.latitude,
          m.longitude,
          m.environment_biome,
          m.primary_biome,
          m.environment_feature,
          m.environment_material,
          m.host_scientific_name,
          m.data_source_names,
          m.study_titles,
          m.assembly_count,
          m.bgc_count,
          m.source_types,
          m.bgc_count_from_gcf,
          m.assembly_count_from_gcf,
          ss.gold_ecosystem_path
        FROM gcf_sample_map_mv m
        LEFT JOIN sample_summary ss ON ss.id = m.id
        WHERE m.gcf_id = ${gcfId}::uuid
        ORDER BY m.bgc_count_from_gcf DESC, m.external_id NULLS LAST
        LIMIT ${MAX_MAP_LIMIT}
      `;

      const countQuery = Prisma.sql`
        SELECT COUNT(*)::int AS total
        FROM gcf_sample_map_mv
        WHERE gcf_id = ${gcfId}::uuid
      `;

      const [rows, countResult] = await Promise.all([
        prisma.$queryRaw<MapRow[]>(dataQuery),
        prisma.$queryRaw<{ total: number }[]>(countQuery),
      ]);

      const total = countResult?.[0]?.total ?? rows.length;

      const data = rows.map((row) => {
        const latitude = row.latitude !== null && row.latitude !== undefined ? Number(row.latitude) : undefined;
        const longitude = row.longitude !== null && row.longitude !== undefined ? Number(row.longitude) : undefined;
        const locationLabel = row.geographic_location
          ?? row.geolocation_name
          ?? (latitude !== undefined && longitude !== undefined ? `${latitude.toFixed(4)}, ${longitude.toFixed(4)}` : null);

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
        total,
        limit: MAX_MAP_LIMIT,
      };
    }, 300);

    console.log(`[API] GCF map samples request for ${gcfId}. Cache Hit: ${isHit}`);

    const response = NextResponse.json(payload);
    response.headers.set('X-Cache', isHit ? 'HIT' : 'MISS');
    response.headers.set(
      'Cache-Control',
      'public, s-maxage=300, stale-while-revalidate=600',
    );
    return response;
  } catch (error) {
    return serverError(error, 'Failed to load GCF map samples');
  }
}
