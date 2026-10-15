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
import { STATS_SAMPLES_HIERARCHY_NAMESPACE } from '@/lib/stats-cache';
import { serverError } from '@/lib/api/errors';

/**
 * Flat GOLD-path distribution for the Samples sunburst (client nests on ':').
 * Uses the same filter set as the bar charts.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const params = url.searchParams;

  // Refuses rather than widens: these charts sit beside the table they describe.
  let allFilters: Prisma.Sql[];
  // The cache key is built from the parsed group, and the parse itself can refuse.
  let advancedGroup: FilterGroup | null = null;
  try {
    advancedGroup = parseAdvancedFilterParam(params.get('advancedFilters'));
    allFilters = [...buildBaseFilters(params), ...buildOuterFilters(params)];
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
  allFilters.push(Prisma.sql`sb.gold_ecosystem_path IS NOT NULL`);
  allFilters.push(Prisma.sql`sb.gold_ecosystem_path <> ''`);

  const whereClause = Prisma.sql`WHERE ${Prisma.join(allFilters, ' AND ')}`;

  try {
    // Built from what this route parsed, never the raw query string.
    // lib/stats-cache.ts describes the version scheme.
    const cacheKey = buildCacheKey(STATS_SAMPLES_HIERARCHY_NAMESPACE, 2, {
      ...parseSampleFilters(params),
      advancedFilters: canonicalizeFilterGroup(advancedGroup),
    });
    const hierarchy = await getOrSetCache<Array<{ path: string; samples: number; bgcs: number }>>(
      cacheKey,
      async () => {
        const rows = await prisma.$queryRaw<Array<{ path: string | null; samples: number; bgcs: number }>>(Prisma.sql`
          SELECT
            sb.gold_ecosystem_path AS path,
            COUNT(*)::int AS samples,
            COALESCE(SUM(sb.bgc_count), 0)::int AS bgcs
          FROM sample_summary sb
        -- gcfsMin/gcfsMax reference sgc.
        LEFT JOIN sample_gcf_counts_mv sgc ON sgc.sample_id = sb.id
          ${whereClause}
          GROUP BY sb.gold_ecosystem_path
        `);
        return rows.map(row => ({
          // Drop a leading "root:", as the bar charts' cleanLabel does.
          path: (row.path ?? '').replace(/^root:\s*/i, '').trim(),
          samples: row.samples,
          bgcs: row.bgcs || 0,
        })).filter(row => row.path.length > 0);
      },
      300,
    );

    return NextResponse.json(
      { success: true, data: { hierarchy } },
      { headers: { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=60' } },
    );
  } catch (error) {
    return serverError(error, 'Failed to load sample hierarchy');
  }
}
