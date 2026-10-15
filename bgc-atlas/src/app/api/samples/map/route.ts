import { NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';

import prisma from '@/lib/prisma';
import { getOrSetCacheWithMetadata } from '@/lib/cache';
import { stripSourcePrefix } from '@/lib/utils/sample-id';
import { parseAdvancedFilterParam } from '@/lib/filters/types';
import { buildAdvancedWhere } from '@/lib/filters/prisma-builders';
import { sampleFilterFields } from '@/lib/filters/field-definitions';
import { filterRefusalResponse } from '@/lib/api/filter-refusal';
import { samplesMapCacheKey } from '@/lib/api/samples-map-cache-key';
import {
  buildBaseFilters,
  buildOuterFilters,
  buildSampleAdvancedCondition,
  parseNumber,
} from '@/lib/api/samples-query';
import { serverError } from '@/lib/api/errors';

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
  gold_ecosystem_path: string | null;
  environment_feature: string | null;
  environment_material: string | null;
  host_scientific_name: string | null;
  data_source_names: string[] | null;
  study_titles: string[] | null;
  assembly_count: number;
  bgc_count: number;
  source_types: string[] | null;
};

export async function GET(request: Request) {
  const url = new URL(request.url);
  const params = url.searchParams;

  const limitParam = params.get('limit');
  const limit = limitParam ? parseNumber(limitParam, { clampMin: 1, clampMax: MAX_MAP_LIMIT }) : undefined;

  // Same filter set as /api/samples, minus geolocation (also used to count
  // matching samples without lat/lon). Refused, not widened: a dropped
  // condition would put excluded dots on the map.
  let filtersWithoutGeo: Prisma.Sql[];
  try {
    filtersWithoutGeo = [...buildBaseFilters(params), ...buildOuterFilters(params)];
    const advancedGroup = parseAdvancedFilterParam(params.get('advancedFilters'));
    const advancedWhere = buildAdvancedWhere(
      advancedGroup,
      buildSampleAdvancedCondition,
      sampleFilterFields,
    );
    if (advancedWhere) {
      filtersWithoutGeo.push(advancedWhere);
    }
  } catch (error) {
    const refusal = filterRefusalResponse(error);
    if (refusal) return refusal;
    throw error;
  }

  const whereConditions = [
    ...filtersWithoutGeo,
    Prisma.sql`sb.latitude IS NOT NULL AND sb.longitude IS NOT NULL`,
  ];

  const whereClause = Prisma.sql`WHERE ${Prisma.join(whereConditions, ' AND ')}`;
  const missingGeoWhereClause = Prisma.sql`WHERE ${Prisma.join(
    [...filtersWithoutGeo, Prisma.sql`(sb.latitude IS NULL OR sb.longitude IS NULL)`],
    ' AND '
  )}`;

  const cacheKey = samplesMapCacheKey(params);

  try {
    const { data: payload, isHit } = await getOrSetCacheWithMetadata(cacheKey, async () => {
      console.log(`[API] Cache MISS for key: ${cacheKey} - Fetching from DB`);
      const limitClause = typeof limit === 'number' ? Prisma.sql`LIMIT ${limit}` : Prisma.sql``;

      const dataQuery = Prisma.sql`
        SELECT
          sb.id,
          sb.external_id,
          sb.name,
          sb.geographic_location,
          sb.geolocation_name,
          sb.latitude,
          sb.longitude,
          sb.environment_biome,
          sb.primary_biome,
          sb.gold_ecosystem_path,
          sb.environment_feature,
          sb.environment_material,
          sb.host_scientific_name,
          sb.data_source_names,
          sb.study_titles,
          sb.assembly_count,
          sb.bgc_count,
          sb.source_types
        FROM sample_map_view sb
        -- gcfsMin/gcfsMax filter on this MV; Postgres drops the join when unused.
        LEFT JOIN sample_gcf_counts_mv sgc ON sgc.sample_id = sb.id
        ${whereClause}
        ORDER BY sb.bgc_count DESC, sb.external_id NULLS LAST
        ${limitClause}
      `;

      const countQuery = Prisma.sql`
        SELECT COUNT(*)::int AS total
        FROM sample_map_view sb
        -- gcfsMin/gcfsMax filter on this MV; Postgres drops the join when unused.
        LEFT JOIN sample_gcf_counts_mv sgc ON sgc.sample_id = sb.id
        ${whereClause}
      `;

      const missingGeoQuery = Prisma.sql`
        SELECT COUNT(*)::int AS total
        FROM sample_summary sb
        -- gcfsMin/gcfsMax filter on this MV; Postgres drops the join when unused.
        LEFT JOIN sample_gcf_counts_mv sgc ON sgc.sample_id = sb.id
        ${missingGeoWhereClause}
      `;

      const [rows, countResult, missingGeoResult] = await Promise.all([
        prisma.$queryRaw<MapRow[]>(dataQuery),
        prisma.$queryRaw<{ total: number }[]>(countQuery),
        prisma.$queryRaw<{ total: number }[]>(missingGeoQuery),
      ]);

      const total = countResult?.[0]?.total ?? rows.length;
      const missingGeolocation = missingGeoResult?.[0]?.total ?? 0;

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
        missingGeolocation,
        ...(typeof limit === 'number' ? { limit } : {}),
      };
    }, 3600);

    console.log(`[API] Map samples request. Cache Hit: ${isHit}`);

    const response = NextResponse.json(payload);
    response.headers.set('X-Cache', isHit ? 'HIT' : 'MISS');
    response.headers.set(
      'Cache-Control',
      'public, max-age=300, s-maxage=3600, stale-while-revalidate=3600'
    );
    return response;
  } catch (error) {
    return serverError(error, 'Failed to load map samples');
  }
}
