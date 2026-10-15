import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import { getOrSetCache } from '@/lib/cache';
import { serverError } from '@/lib/api/errors';

export type GcfStatisticsResponse = {
  success: boolean;
  data?: {
    totalGcfs: number;
    totalMemberBgcs: number;
    avgMemberBgcs: number;
    totalCompleteBgcs: number;
    totalAssemblies: number;
    avgTaxaCount: number;
  };
  error?: string;
  message?: string;
};

export async function GET(_request: NextRequest) {
  try {
    // v3 key: a stale v2 per-threshold entry would deserialise and read as a real answer.
    const cacheKey = 'stats:gcfs:global:v3';

    const payload = await getOrSetCache(cacheKey, async () => {
      const rows = await prisma.$queryRaw<[
        {
          total_gcfs: bigint | number;
          total_member_bgcs: bigint | number;
          avg_member_bgcs: number | string;
          total_complete_bgcs: bigint | number;
          total_assemblies: bigint | number;
          avg_taxa_count: number | string;
        }
      ]>(Prisma.sql`
        SELECT
          COUNT(*)::bigint AS total_gcfs,
          COALESCE(SUM(member_bgc_count), 0)::bigint AS total_member_bgcs,
          COALESCE(AVG(member_bgc_count), 0)::float AS avg_member_bgcs,
          COALESCE(SUM(complete_bgc_count), 0)::bigint AS total_complete_bgcs,
          COALESCE(SUM(assembly_count), 0)::bigint AS total_assemblies,
          COALESCE(AVG(unique_taxa_count), 0)::float AS avg_taxa_count
        FROM gcf_summary_mv s
        JOIN gcfs g ON g.id = s.gcf_id
        WHERE s.member_bgc_count > 0
          AND g.listed
      `);

      const row = rows?.[0];

      const toNum = (v: unknown) => {
        if (typeof v === 'bigint') return Number(v);
        if (typeof v === 'number') return v;
        if (typeof v === 'string') return Number(v);
        return 0;
      };

      const data = {
        totalGcfs: toNum(row?.total_gcfs),
        totalMemberBgcs: toNum(row?.total_member_bgcs),
        avgMemberBgcs: toNum(row?.avg_member_bgcs),
        totalCompleteBgcs: toNum(row?.total_complete_bgcs),
        totalAssemblies: toNum(row?.total_assemblies),
        avgTaxaCount: toNum(row?.avg_taxa_count),
      };

      return { success: true, data };
    }, 86400); // busted + re-warmed on materialized-view refresh

    return NextResponse.json<GcfStatisticsResponse>(payload, {
      headers: {
        'Cache-Control': 'public, max-age=300, s-maxage=300, stale-while-revalidate=60',
      },
    });
  } catch (error) {
    return serverError(error, 'Failed to load GCF statistics');
  }
}
