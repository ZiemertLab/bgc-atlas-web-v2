import { NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import { getOrSetCache } from '@/lib/cache';
import { serverError } from '@/lib/api/errors';

export async function GET() {
  try {
    // Filters on `g.listed` to match scripts/generate-gcf-charts-snapshot.ts.
    // The key is unsuffixed so the refresh-time bust of `gcf:stats` matches it.
    const cacheKey = 'gcf:stats';

    const payload = await getOrSetCache(cacheKey, async () => {
      type ProductDistRow = {
        product_category: string;
        gcf_count: number | string;
      };

      const productDistRows = await prisma.$queryRaw<ProductDistRow[]>(Prisma.sql`
        SELECT
          m.product_category,
          COUNT(DISTINCT m.gcf_id) as gcf_count
        FROM gcf_product_type_matrix_mv m
        JOIN gcfs g ON g.id = m.gcf_id
        WHERE m.product_category IS NOT NULL AND m.product_category != ''
          AND g.listed
        GROUP BY m.product_category
        ORDER BY gcf_count DESC
        LIMIT 12
      `);

      type SizeDistRow = {
        size_range: string;
        gcf_count: number | string;
      };

      const sizeDistRows = await prisma.$queryRaw<SizeDistRow[]>(Prisma.sql`
        WITH size_buckets AS (
          SELECT
            CASE
              WHEN member_bgc_count BETWEEN 1 AND 10 THEN '1-10'
              WHEN member_bgc_count BETWEEN 11 AND 50 THEN '11-50'
              WHEN member_bgc_count BETWEEN 51 AND 100 THEN '51-100'
              WHEN member_bgc_count BETWEEN 101 AND 500 THEN '101-500'
              WHEN member_bgc_count BETWEEN 501 AND 1000 THEN '501-1000'
              WHEN member_bgc_count > 1000 THEN '1000+'
              ELSE NULL
            END as size_range,
            CASE
              WHEN member_bgc_count BETWEEN 1 AND 10 THEN 1
              WHEN member_bgc_count BETWEEN 11 AND 50 THEN 2
              WHEN member_bgc_count BETWEEN 51 AND 100 THEN 3
              WHEN member_bgc_count BETWEEN 101 AND 500 THEN 4
              WHEN member_bgc_count BETWEEN 501 AND 1000 THEN 5
              WHEN member_bgc_count > 1000 THEN 6
              ELSE NULL
            END as sort_order
          FROM gcf_summary_mv s
          JOIN gcfs g ON g.id = s.gcf_id
          WHERE s.member_bgc_count > 0
            AND g.listed
        )
        SELECT
          size_range,
          COUNT(*) as gcf_count
        FROM size_buckets
        GROUP BY size_range, sort_order
        ORDER BY sort_order
      `);

      type FullSizeDistRow = {
        size: number;
        count: number | string;
      };

      const fullSizeDistRows = await prisma.$queryRaw<FullSizeDistRow[]>(Prisma.sql`
        SELECT
          s.member_bgc_count as size,
          COUNT(*)::int as count
        FROM gcf_summary_mv s
        JOIN gcfs g ON g.id = s.gcf_id
        WHERE s.member_bgc_count > 0
          AND g.listed
        GROUP BY s.member_bgc_count
        ORDER BY s.member_bgc_count ASC
      `);

      const toNum = (val: number | string): number => {
        if (typeof val === 'number') return val;
        const num = Number(val);
        return Number.isFinite(num) ? num : 0;
      };

      return {
        success: true,
        data: {
          categoryDistribution: productDistRows.map((row) => ({
            category: row.product_category,
            count: toNum(row.gcf_count),
          })),
          sizeDistribution: sizeDistRows.map((row) => ({
            range: row.size_range,
            count: toNum(row.gcf_count),
          })),
          fullSizeDistribution: fullSizeDistRows.map((row) => ({
            size: toNum(row.size),
            count: toNum(row.count),
          })),
        },
        message: 'GCF statistics fetched successfully',
      };
    }, 86400); // busted + re-warmed on materialized-view refresh

    return NextResponse.json(payload, {
      headers: {
        'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=7200',
      },
    });
  } catch (error) {
    return serverError(error, 'GCF stats API Error');
  }
}
