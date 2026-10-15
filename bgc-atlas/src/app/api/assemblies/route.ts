import { NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';

import prisma from '@/lib/prisma';
import { buildListCacheKeys, getOrSetCache } from '@/lib/cache';
import { parseAdvancedFilterParam } from '@/lib/filters/types';
import { buildAdvancedWhere } from '@/lib/filters/prisma-builders';
import { sampleFilterFields } from '@/lib/filters/field-definitions';
import { filterRefusalResponse } from '@/lib/api/filter-refusal';
import {
  buildBaseFilters,
  buildOuterFilters,
  buildSampleAdvancedCondition,
  mapSampleRowToSample,
  parseNumber,
  type SampleRow,
} from '@/lib/api/samples-query';
import { serverError } from '@/lib/api/errors';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

type AssemblyRow = SampleRow & {
  assembly_id: string;
  assembly_external_id: string | null;
  assembly_name: string | null;
  assembly_bgc_count: number;
  antismash_run_id: string | null;
};

// Outer-query sort: the inner DISTINCT ON must order by a.id first, so sorting
// happens outside, by output column names (no `sb.` prefix).
const sortFieldMap: Record<string, Prisma.Sql> = {
  bgcs: Prisma.sql`assembly_bgc_count`,
  location: Prisma.sql`COALESCE(geographic_location, geolocation_name, '')`,
  biome: Prisma.sql`COALESCE(primary_biome, environment_biome, '')`,
  environment: Prisma.sql`COALESCE(environment_biome, '')`,
  material: Prisma.sql`COALESCE(environment_material, '')`,
  feature: Prisma.sql`COALESCE(environment_feature, '')`,
  host: Prisma.sql`COALESCE(host_scientific_name, host_taxid::text, '')`,
};

function buildOuterOrderClause(params: URLSearchParams) {
  const sortFieldParam = params.get('sortField') ?? 'bgcs';
  const sortOrderParam = params.get('sortOrder') === 'asc' ? 'asc' : 'desc';
  const sortColumn = Object.hasOwn(sortFieldMap, sortFieldParam) ? sortFieldMap[sortFieldParam] : sortFieldMap.bgcs;
  const direction = sortOrderParam === 'asc' ? Prisma.sql`ASC` : Prisma.sql`DESC`;
  return Prisma.sql`ORDER BY ${sortColumn} ${direction}`;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const params = url.searchParams;

  const limit = parseNumber(params.get('limit'), { fallback: DEFAULT_LIMIT, clampMin: 1, clampMax: MAX_LIMIT }) ?? DEFAULT_LIMIT;
  const offset = parseNumber(params.get('offset'), { fallback: 0, clampMin: 0 }) ?? 0;

  // The bgcs range filter targets the per-assembly count, so strip bgcsMin/Max
  // (which the shared builders apply to sb.bgc_count) and re-apply them outside.
  const filterParams = new URLSearchParams(params);
  filterParams.delete('bgcsMin');
  filterParams.delete('bgcsMax');

  // Refuse rather than silently drop an unhonourable filter.
  let allFilters: Prisma.Sql[];
  try {
    allFilters = [...buildBaseFilters(filterParams), ...buildOuterFilters(filterParams)];
    const advancedGroup = parseAdvancedFilterParam(params.get('advancedFilters'));
    // Advanced `bgcs` filters still target the sample-level count (sb.bgc_count).
    const advancedWhere = buildAdvancedWhere(
      advancedGroup,
      buildSampleAdvancedCondition,
      sampleFilterFields,
    );
    if (advancedWhere) {
      allFilters.push(advancedWhere);
    }
  } catch (error) {
    const refusal = filterRefusalResponse(error);
    if (refusal) return refusal;
    throw error;
  }
  const whereClause = allFilters.length
    ? Prisma.sql`WHERE ${Prisma.join(allFilters, ' AND ')}`
    : Prisma.sql``;

  const bgcsMin = parseNumber(params.get('bgcsMin'), { clampMin: 0 });
  const bgcsMax = parseNumber(params.get('bgcsMax'), { clampMin: 0 });
  const outerBgcsConditions: Prisma.Sql[] = [];
  if (bgcsMin !== undefined) {
    outerBgcsConditions.push(Prisma.sql`assembly_bgc_count >= ${bgcsMin}`);
  }
  if (bgcsMax !== undefined) {
    outerBgcsConditions.push(Prisma.sql`assembly_bgc_count <= ${bgcsMax}`);
  }
  const outerWhereClause = outerBgcsConditions.length
    ? Prisma.sql`WHERE ${Prisma.join(outerBgcsConditions, ' AND ')}`
    : Prisma.sql``;

  const outerOrderClause = buildOuterOrderClause(params);

  const { dataKey, countKey } = buildListCacheKeys('assemblies:list', params, [
    'limit', 'offset', 'sortField', 'sortOrder', 'sortFields', 'sortOrders',
  ]);

  const fetchTotal = async (): Promise<number> => {
    const countResult = await prisma.$queryRaw<{ total: number }[]>(Prisma.sql`
      SELECT COUNT(*)::int AS total
      FROM (
        SELECT DISTINCT ON (a.id)
          a.id,
          (SELECT COUNT(*) FROM bgcs b WHERE b.assembly = a.id)::int AS assembly_bgc_count
        FROM assemblies a
        JOIN sample_assemblies sa ON sa.assembly_id = a.id
        JOIN sample_summary sb     ON sb.id = sa.sample_id
        -- gcfsMin/gcfsMax from the shared samples filter builders reference sgc.
        LEFT JOIN sample_gcf_counts_mv sgc ON sgc.sample_id = sb.id
        ${whereClause}
        ORDER BY a.id
      ) t
      ${outerWhereClause}
    `);
    return countResult?.[0]?.total ?? 0;
  };

  const fetchData = async () => {
    // assembly_bgc_count is computed inside because it's needed before LIMIT; the
    // antismash-run lookup is outside so it runs only for the returned rows.
    const rows = await prisma.$queryRaw<AssemblyRow[]>(Prisma.sql`
      SELECT
        t.*,
        (SELECT ar.id FROM antismash_runs ar
           WHERE ar.assembly_id = t.assembly_id
           ORDER BY ar.created_at DESC NULLS LAST
           LIMIT 1) AS antismash_run_id
      FROM (
        SELECT DISTINCT ON (a.id)
          sb.*,
          a.id            AS assembly_id,
          a.external_id   AS assembly_external_id,
          a.name          AS assembly_name,
          (SELECT COUNT(*) FROM bgcs b WHERE b.assembly = a.id)::int AS assembly_bgc_count
        FROM assemblies a
        JOIN sample_assemblies sa ON sa.assembly_id = a.id
        JOIN sample_summary sb     ON sb.id = sa.sample_id
        -- gcfsMin/gcfsMax from the shared samples filter builders reference sgc.
        LEFT JOIN sample_gcf_counts_mv sgc ON sgc.sample_id = sb.id
        ${whereClause}
        ORDER BY a.id
      ) t
      ${outerWhereClause}
      ${outerOrderClause}
      LIMIT ${limit}
      OFFSET ${offset}
    `);
    return rows.map((row) => {
      const sample = mapSampleRowToSample(row);
      return {
        ...sample,
        assemblyId: row.assembly_id,
        assemblyName: row.assembly_name ?? row.assembly_external_id ?? null,
        bgcCount: row.assembly_bgc_count ?? 0,
        antismashRunId: row.antismash_run_id ?? null,
      };
    });
  };

  try {
    const [total, results] = await Promise.all([
      getOrSetCache(countKey, fetchTotal, 600),
      getOrSetCache(dataKey, fetchData, 60),
    ]);

    return NextResponse.json({
      success: true,
      data: { data: results, total, limit, offset },
    });
  } catch (error) {
    return serverError(error, 'Failed to load assemblies');
  }
}
