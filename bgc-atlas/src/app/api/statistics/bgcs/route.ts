import { NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';

import prisma from '@/lib/prisma';
import { getOrSetCache } from '@/lib/cache';
import { serverError } from '@/lib/api/errors';

const DEFAULT_LIMIT = 30;
const MAX_LIMIT = 100;
const DEFAULT_BIOME_LEVEL = 1;
const MAX_BIOME_LEVEL = 4;

type GroupByOption = 'biome' | 'environment' | 'feature' | 'material' | 'gold_level_1' | 'gold_level_2' | 'gold_level_3' | 'gold_level_4' | 'gold_level_5';

type DistributionRow = {
  name: string | null;
  complete: bigint | number;
  partial: bigint | number;
};

type ApiPayload = {
  bgcCategoryDistribution: Array<{ name: string; complete: number; partial: number }>;
  distribution: Array<{ name: string; complete: number; partial: number }>;
  meta: {
    groupBy: GroupByOption;
    level?: number;
    limit: number;
  };
};

const toNumber = (value: bigint | number) => (typeof value === 'bigint' ? Number(value) : value);

const parseNumber = (
  value: string | null,
  { fallback, min, max }: { fallback?: number; min?: number; max?: number } = {}
) => {
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  let result = parsed;
  if (typeof min === 'number' && result < min) result = min;
  if (typeof max === 'number' && result > max) result = max;
  return result;
};

const resolveGroupBy = (value: string | null): GroupByOption => {
  switch (value) {
    case 'environment':
    case 'feature':
    case 'material':
    case 'gold_level_1':
    case 'gold_level_2':
    case 'gold_level_3':
    case 'gold_level_4':
    case 'gold_level_5':
      return value;
    default:
      return 'biome';
  }
};

const cleanLabel = (value: string | null) => {
  if (!value) return 'Unknown';
  const stripped = value.replace(/^root:\s*/i, '').trim();
  return stripped.length > 0 ? stripped : 'Unknown';
};

/**
 * Top-`limit` rows plus one "Others" row (omitted when nothing overflows).
 * Mirrored in generate-bgc-charts-snapshot.ts.
 */
const withOthersDistribution = (source: Prisma.Sql, limit: number): Prisma.Sql => Prisma.sql`
  WITH src AS (
    ${source}
  ),
  ranked AS (
    SELECT name, complete, partial,
      ROW_NUMBER() OVER (ORDER BY complete DESC, partial DESC, name) AS rn
    FROM src
  )
  SELECT name, complete, partial
  FROM (
    SELECT name, complete, partial, rn AS sort_order
    FROM ranked
    WHERE rn <= ${limit}
    UNION ALL
    SELECT 'Others', SUM(complete)::int, SUM(partial)::int, ${limit} + 1
    FROM ranked
    WHERE rn > ${limit}
    HAVING COUNT(*) > 0
  ) ordered
  ORDER BY sort_order
`;

export async function GET(request: Request) {
  const url = new URL(request.url);
  const params = url.searchParams;

  const groupBy = resolveGroupBy(params.get('groupBy'));
  const limit = parseNumber(params.get('limit'), {
    fallback: DEFAULT_LIMIT,
    min: 5,
    max: MAX_LIMIT,
  }) ?? DEFAULT_LIMIT;

  const biomeLevel = groupBy === 'biome'
    ? parseNumber(params.get('level'), {
        fallback: DEFAULT_BIOME_LEVEL,
        min: 1,
        max: MAX_BIOME_LEVEL,
      }) ?? DEFAULT_BIOME_LEVEL
    : undefined;

  try {
    // v2: a stale unversioned entry lacking bgcCategoryDistribution would draw empty.
    const cacheKey = `statistics:bgcs:v2:${groupBy}:${biomeLevel ?? 'na'}:${limit}`;
    const payload = await getOrSetCache<ApiPayload>(cacheKey, async () => {
    const classQuery = Prisma.sql`
      SELECT name, complete, partial
      FROM bgc_product_category_distribution_mv
      ORDER BY complete DESC, partial DESC, name
      LIMIT ${limit}
    `;

    let distributionQuery: Prisma.Sql;

    if (groupBy === 'gold_level_1' || groupBy === 'gold_level_2' || groupBy === 'gold_level_3' || groupBy === 'gold_level_4' || groupBy === 'gold_level_5') {
      const goldLevel = Number(groupBy.slice('gold_level_'.length));
      distributionQuery = withOthersDistribution(
        Prisma.sql`
          SELECT name, complete, partial
          FROM bgc_gold_ecosystem_distribution_mv
          WHERE level = ${goldLevel}
        `,
        limit,
      );
    } else {
      const distributionViewName = (() => {
        if (groupBy === 'environment') {
          return 'bgc_environment_distribution_mv';
        }
        if (groupBy === 'feature') {
          return 'bgc_feature_distribution_mv';
        }
        if (groupBy === 'material') {
          return 'bgc_material_distribution_mv';
        }
        const level = Math.min(Math.max(biomeLevel ?? DEFAULT_BIOME_LEVEL, 1), MAX_BIOME_LEVEL);
        return `bgc_biome_level_${level}_distribution_mv`;
      })();

      distributionQuery = withOthersDistribution(
        Prisma.sql`SELECT name, complete, partial FROM ${Prisma.raw(distributionViewName)}`,
        limit,
      );
    }

    const [classRows, distributionRows] = await Promise.all([
      prisma.$queryRaw<DistributionRow[]>(classQuery),
      prisma.$queryRaw<DistributionRow[]>(distributionQuery),
    ]);

    const categoryDistribution = classRows.map((row) => ({
      name: row.name ?? 'Unclassified',
      complete: toNumber(row.complete),
      partial: toNumber(row.partial),
    }));

    const distribution = distributionRows.map((row) => ({
      name: cleanLabel(row.name),
      complete: toNumber(row.complete),
      partial: toNumber(row.partial),
    }));

    const result: ApiPayload = {
      bgcCategoryDistribution: categoryDistribution,
      distribution,
      meta: {
        groupBy,
        level: biomeLevel,
        limit,
      },
    };
    return result;
    }, 300);

    return NextResponse.json({ success: true, data: payload }, {
      headers: {
        'Cache-Control': 'public, max-age=300, s-maxage=300, stale-while-revalidate=60',
      },
    });
  } catch (error) {
    return serverError(error, 'Failed to load BGC statistics');
  }
}
