import { NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import { buildCacheKey, getOrSetCache } from '@/lib/cache';
import {
  buildBaseFilters,
  buildOuterFilters,
  buildSampleAdvancedCondition,
  parseSampleFilters,
} from '@/lib/api/samples-query';
import { buildAdvancedWhere } from '@/lib/filters/prisma-builders';
import { sampleFilterFields } from '@/lib/filters/field-definitions';
import { filterRefusalResponse } from '@/lib/api/filter-refusal';
import { canonicalizeFilterGroup, parseAdvancedFilterParam } from '@/lib/filters/types';
import type { FilterGroup } from '@/lib/filters/types';
import { STATS_SAMPLES_NAMESPACE } from '@/lib/stats-cache';
import { serverError } from '@/lib/api/errors';

const DEFAULT_LIMIT = 20;
const MIN_LIMIT = 1;
const MAX_LIMIT = 100;

/**
 * Groupings the switch below implements. Others fall through to `biome`, so
 * they are normalised up front to avoid minting duplicate cache entries. Keep
 * in step with the switch.
 */
const GROUP_BY_KEYS = new Set([
  'biome',
  'environment',
  'feature',
  'material',
  'gold_level_1',
  'gold_level_2',
  'gold_level_3',
  'gold_level_4',
  'gold_level_5',
]);

export async function GET(request: Request) {
  const url = new URL(request.url);
  const params = url.searchParams;

  const requestedGroupBy = params.get('groupBy') || 'biome';
  const groupBy = GROUP_BY_KEYS.has(requestedGroupBy) ? requestedGroupBy : 'biome';
  // Clamped: every limit above the distinct-group count returns the same payload,
  // so an unclamped limit is unbounded cache keys on a public endpoint.
  const limitParam = parseInt(params.get('limit') || String(DEFAULT_LIMIT), 10);
  const limit = Number.isFinite(limitParam)
    ? Math.min(Math.max(limitParam, MIN_LIMIT), MAX_LIMIT)
    : DEFAULT_LIMIT;

  // Refuses rather than widens: these charts sit beside the table they describe.
  let baseFilters: Prisma.Sql[];
  let outerFilters: Prisma.Sql[];
  let advancedWhere: Prisma.Sql | null;
  // The cache key is built from the parsed group, and the parse itself can refuse.
  let advancedGroup: FilterGroup | null = null;
  try {
    advancedGroup = parseAdvancedFilterParam(params.get('advancedFilters'));
    baseFilters = buildBaseFilters(params);
    outerFilters = buildOuterFilters(params);
    advancedWhere = buildAdvancedWhere(
      advancedGroup,
      buildSampleAdvancedCondition,
      sampleFilterFields,
    );
  } catch (error) {
    const refusal = filterRefusalResponse(error);
    if (refusal) return refusal;
    throw error;
  }

  let groupColumn: Prisma.Sql;
  switch (groupBy) {
    case 'environment':
      groupColumn = Prisma.sql`sb.environment_biome`;
      break;
    case 'feature':
      groupColumn = Prisma.sql`sb.environment_feature`;
      break;
    case 'material':
      groupColumn = Prisma.sql`sb.environment_material`;
      break;
    case 'gold_level_1':
      groupColumn = Prisma.sql`SPLIT_PART(sb.gold_ecosystem_path, ':', 1)`;
      break;
    case 'gold_level_2':
      groupColumn = Prisma.sql`CASE
        WHEN SPLIT_PART(sb.gold_ecosystem_path, ':', 2) != ''
        THEN CONCAT(SPLIT_PART(sb.gold_ecosystem_path, ':', 1), ':', SPLIT_PART(sb.gold_ecosystem_path, ':', 2))
        ELSE NULL
      END`;
      break;
    case 'gold_level_3':
      groupColumn = Prisma.sql`CASE
        WHEN SPLIT_PART(sb.gold_ecosystem_path, ':', 3) != ''
        THEN CONCAT(
          SPLIT_PART(sb.gold_ecosystem_path, ':', 1), ':',
          SPLIT_PART(sb.gold_ecosystem_path, ':', 2), ':',
          SPLIT_PART(sb.gold_ecosystem_path, ':', 3)
        )
        ELSE NULL
      END`;
      break;
    case 'gold_level_4':
      groupColumn = Prisma.sql`CASE
        WHEN SPLIT_PART(sb.gold_ecosystem_path, ':', 4) != ''
        THEN CONCAT(
          SPLIT_PART(sb.gold_ecosystem_path, ':', 1), ':',
          SPLIT_PART(sb.gold_ecosystem_path, ':', 2), ':',
          SPLIT_PART(sb.gold_ecosystem_path, ':', 3), ':',
          SPLIT_PART(sb.gold_ecosystem_path, ':', 4)
        )
        ELSE NULL
      END`;
      break;
    case 'gold_level_5':
      groupColumn = Prisma.sql`CASE
        WHEN SPLIT_PART(sb.gold_ecosystem_path, ':', 5) != ''
        THEN CONCAT(
          SPLIT_PART(sb.gold_ecosystem_path, ':', 1), ':',
          SPLIT_PART(sb.gold_ecosystem_path, ':', 2), ':',
          SPLIT_PART(sb.gold_ecosystem_path, ':', 3), ':',
          SPLIT_PART(sb.gold_ecosystem_path, ':', 4), ':',
          SPLIT_PART(sb.gold_ecosystem_path, ':', 5)
        )
        ELSE NULL
      END`;
      break;
    case 'biome':
    default:
      groupColumn = Prisma.sql`sb.primary_biome`;
      break;
  }

  const allFilters = [...baseFilters, ...outerFilters];
  if (advancedWhere) {
    allFilters.push(advancedWhere);
  }
  allFilters.push(Prisma.sql`${groupColumn} IS NOT NULL`);
  allFilters.push(Prisma.sql`${groupColumn} != ''`);

  const whereClause = allFilters.length
    ? Prisma.sql`WHERE ${Prisma.join(allFilters, ' AND ')}`
    : Prisma.sql``;

  try {
    // Built from what this route parsed, never the raw query string
    // (Object.fromEntries keeps only the last of a repeated key). The advanced
    // group's client-side ids are stripped so equal questions share a key.
    // lib/stats-cache.ts describes the version scheme.
    const cacheKey = buildCacheKey(STATS_SAMPLES_NAMESPACE, 2, {
      ...parseSampleFilters(params),
      groupBy,
      limit,
      advancedFilters: canonicalizeFilterGroup(advancedGroup),
    });
    const distribution = await getOrSetCache<Array<{ name: string; samples: number; bgcs: number }>>(
      cacheKey,
      async () => {
        // Top-`limit` by sample count plus an "Others" row (omitted when nothing overflows).
        const rows = await prisma.$queryRaw<Array<{ name: string | null; count: number; bgc_count: number }>>(Prisma.sql`
          WITH grouped AS (
            SELECT
              ${groupColumn} as name,
              COUNT(*)::int as count,
              COALESCE(SUM(sb.bgc_count), 0)::int as bgc_count
            FROM sample_summary sb
        -- gcfsMin/gcfsMax reference sgc.
        LEFT JOIN sample_gcf_counts_mv sgc ON sgc.sample_id = sb.id
            ${whereClause}
            GROUP BY 1
          ),
          ranked AS (
            SELECT name, count, bgc_count,
              ROW_NUMBER() OVER (ORDER BY count DESC) AS rn
            FROM grouped
          )
          SELECT name, count, bgc_count
          FROM (
            SELECT name, count, bgc_count, rn AS sort_order
            FROM ranked
            WHERE rn <= ${limit}
            UNION ALL
            SELECT 'Others', SUM(count)::int, SUM(bgc_count)::int, ${limit} + 1
            FROM ranked
            WHERE rn > ${limit}
            HAVING COUNT(*) > 0
          ) ordered
          ORDER BY sort_order
        `);
        return rows.map(row => ({
          name: row.name ? row.name.replace(/^root:\s*/i, '').trim() || 'Unknown' : 'Unknown',
          samples: row.count,
          bgcs: row.bgc_count || 0,
        }));
      },
      86400, // busted + re-warmed on materialized-view refresh
    );

    return NextResponse.json(
      {
        success: true,
        data: {
          distribution,
          meta: {
            groupBy,
            limit,
          }
        }
      },
      {
        headers: {
          'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=60',
        },
      }
    );
  } catch (error) {
    return serverError(error, 'Failed to load sample statistics');
  }
}
