import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import { buildCacheKey, getOrSetCache } from '@/lib/cache';
import { parseSourceTypes, UnknownSourceTypeError } from '@/lib/api/samples-query';
import { STATS_GLOBAL_NAMESPACE } from '@/lib/stats-cache';
import { serverError } from '@/lib/api/errors';

export type StatisticsResponse = {
  success: boolean;
  data?: {
    totalSamples: number;
    totalAssemblies: number;
    totalBgcs: number;
    totalCompleteBgcs: number;
    totalGcfs: number;
    totalMetagenomeSamples: number;
    totalMetagenomeAssemblies: number;
    totalGenomes: number;
  };
  error?: string;
  message?: string;
};

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    // Deduped, sorted and validated once so the SQL and cache key share one set.
    // An unknown type is rejected, not dropped: dropping would silently ignore it,
    // and letting it reach the key would allow unbounded cache growth. The check
    // lives in parseSourceTypes, shared with the sample routes.
    let sourceTypes: string[];
    try {
      sourceTypes = parseSourceTypes(searchParams);
    } catch (error) {
      if (error instanceof UnknownSourceTypeError) {
        return NextResponse.json<StatisticsResponse>(
          { success: false, error: 'Unknown source type', message: error.message },
          { status: 400 }
        );
      }
      throw error;
    }

    // The types are a set (`&&` / `IN`), so dedupe+sort is semantic.
    // lib/stats-cache.ts describes the version scheme.
    const cacheKey = buildCacheKey(STATS_GLOBAL_NAMESPACE, 2, {
      sourceTypes,
    });

    const payload = await getOrSetCache(cacheKey, async () => {
      let samplesSubquery;
      let assembliesSubquery;
      let bgcsSubquery;
      let completeBgcsSubquery;
      let gcfsSubquery;

      if (sourceTypes.length > 0) {
        // Samples come from a matview: counting sample_summary live reads ~900 MB.
        samplesSubquery = Prisma.sql`SELECT COALESCE(SUM(sample_count), 0)::bigint FROM sample_source_type_counts
          WHERE source_types && ARRAY[${Prisma.join(sourceTypes)}]::text[]`;

        assembliesSubquery = Prisma.sql`SELECT COALESCE(SUM(assembly_count), 0)::bigint FROM source_type_statistics WHERE source_type IN (${Prisma.join(sourceTypes)})`;
        bgcsSubquery = Prisma.sql`SELECT COALESCE(SUM(bgc_count), 0)::bigint FROM source_type_statistics WHERE source_type IN (${Prisma.join(sourceTypes)})`;
        completeBgcsSubquery = Prisma.sql`SELECT COALESCE(SUM(complete_bgc_count), 0)::bigint FROM source_type_statistics WHERE source_type IN (${Prisma.join(sourceTypes)})`;
        // Summing may overcount GCFs spanning several selected types; a distinct count is far slower.
        gcfsSubquery = Prisma.sql`SELECT COALESCE(SUM(gcf_count), 0)::bigint FROM source_type_statistics WHERE source_type IN (${Prisma.join(sourceTypes)})`;
      } else {
        // Not COUNT(*) FROM samples: ~1.4 GB, 30-60 s cold.
        samplesSubquery = Prisma.sql`SELECT COALESCE(SUM(sample_count), 0)::bigint FROM sample_source_type_counts`;
        assembliesSubquery = Prisma.sql`SELECT COALESCE(SUM(assembly_count), 0)::bigint FROM source_type_statistics`;
        bgcsSubquery = Prisma.sql`SELECT COALESCE(SUM(bgc_count), 0)::bigint FROM source_type_statistics`;
        completeBgcsSubquery = Prisma.sql`SELECT COALESCE(SUM(complete_bgc_count), 0)::bigint FROM source_type_statistics`;
        // `listed`, so the headline count matches what /gcfs lists.
        gcfsSubquery = Prisma.sql`SELECT COUNT(*) FROM gcfs WHERE listed`;
      }

      // Independent of the sourceType filter, for the home-page overview.
      const metagenomeSamplesSubquery = Prisma.sql`SELECT COALESCE(SUM(sample_count), 0)::bigint FROM sample_source_type_counts
        WHERE source_types && ARRAY['metagenome']::text[]`;
      const metagenomeAssembliesSubquery = Prisma.sql`SELECT COALESCE(SUM(assembly_count), 0)::bigint FROM source_type_statistics WHERE source_type = 'metagenome'`;
      const genomesSubquery = Prisma.sql`SELECT COALESCE(SUM(assembly_count), 0)::bigint FROM source_type_statistics WHERE source_type IN ('isolate', 'MAG', 'SAG')`;

      const rows = await prisma.$queryRaw<[
        {
          total_samples: bigint | number;
          total_assemblies: bigint | number;
          total_bgcs: bigint | number;
          total_complete_bgcs: bigint | number;
          total_gcfs: bigint | number;
          total_metagenome_samples: bigint | number;
          total_metagenome_assemblies: bigint | number;
          total_genomes: bigint | number;
        }
      ]>`
        SELECT
          (${samplesSubquery}) AS total_samples,
          (${assembliesSubquery}) AS total_assemblies,
          (${bgcsSubquery}) AS total_bgcs,
          (${completeBgcsSubquery}) AS total_complete_bgcs,
          (${gcfsSubquery}) AS total_gcfs,
          (${metagenomeSamplesSubquery}) AS total_metagenome_samples,
          (${metagenomeAssembliesSubquery}) AS total_metagenome_assemblies,
          (${genomesSubquery}) AS total_genomes
      `;

      const row = rows?.[0];

      const toNum = (v: unknown) => {
        if (typeof v === 'bigint') return Number(v);
        if (typeof v === 'number') return v;
        if (typeof v === 'string') return Number(v);
        return 0;
      };

      const data = {
        totalSamples: toNum(row?.total_samples),
        totalAssemblies: toNum(row?.total_assemblies),
        totalBgcs: toNum(row?.total_bgcs),
        totalCompleteBgcs: toNum(row?.total_complete_bgcs),
        totalGcfs: toNum(row?.total_gcfs),
        totalMetagenomeSamples: toNum(row?.total_metagenome_samples),
        totalMetagenomeAssemblies: toNum(row?.total_metagenome_assemblies),
        totalGenomes: toNum(row?.total_genomes),
      };

      return { success: true, data };
    }, 86400); // busted + re-warmed on materialized-view refresh

    return NextResponse.json<StatisticsResponse>(payload, {
      headers: {
        'Cache-Control': 'public, max-age=300, s-maxage=300, stale-while-revalidate=60',
      },
    });
  } catch (error) {
    return serverError(error, 'Failed to load statistics');
  }
}
