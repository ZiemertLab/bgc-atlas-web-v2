import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getOrSetCache } from '@/lib/cache';
import { serverError } from '@/lib/api/errors';

// One row of the /about "What's in the Atlas" table.
export type DataSourceStat = {
  id: string;
  name: string;
  url: string | null;
  assemblyCount: number;
  bgcCount: number;
  // Upstream release where the name omits it (OMDB's 'v2'); null otherwise.
  release: string | null;
  // 'metagenome' | 'MAG' | 'isolate' | 'SAG'; /about groups on this, not a hardcoded list.
  primarySourceType: string | null;
};

export type DataSourceStatsResponse = {
  success: boolean;
  data?: DataSourceStat[];
  error?: string;
};

/** Upstream release per stored data_sources.name, where the display name omits it. */
const RELEASES: Record<string, string> = {
  'Ocean Microbiomics Database v2': 'v2',
};

type Row = {
  id: string;
  raw_name: string;
  name: string;
  url: string | null;
  assembly_count: number;
  bgc_count: number;
  primary_source_type: string | null;
};

export async function GET() {
  try {
    const data = await getOrSetCache(
      // Versioned: an older entry has a different shape.
      'stats:data-sources:v3',
      async () => {
        // Labels joined at read time so a corrected display_name or URL applies
        // without a REFRESH.
        const rows = await prisma.$queryRaw<Row[]>`
          SELECT ds.id::text                                    AS id,
                 ds.name                                        AS raw_name,
                 COALESCE(ds.display_name, ds.name)             AS name,
                 ds.source_url                                  AS url,
                 s.assembly_count                               AS assembly_count,
                 s.bgc_count                                    AS bgc_count,
                 s.primary_source_type                          AS primary_source_type
          FROM data_source_statistics s
            JOIN data_sources ds ON ds.id = s.data_source_id
          ORDER BY assembly_count DESC
        `;

        return rows.map(
          (r): DataSourceStat => ({
            id: r.id,
            name: r.name,
            url: r.url,
            assemblyCount: Number(r.assembly_count),
            bgcCount: Number(r.bgc_count),
            primarySourceType: r.primary_source_type,
            release: RELEASES[r.raw_name] ?? null,
          })
        );
      },
      3600
    );

    return NextResponse.json({ success: true, data } satisfies DataSourceStatsResponse);
  } catch (error) {
    return serverError(error, 'Failed to load data source statistics');
  }
}
