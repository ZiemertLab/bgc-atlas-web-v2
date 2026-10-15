import { NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import { getOrSetCache } from '@/lib/cache';
import { serverError } from '@/lib/api/errors';

export type DataSourceOption = {
  id: string;
  name: string;
  source_url: string | null;
};

export async function GET(request: Request) {
  try {
    // Optional `sourceType` (repeatable or comma-separated) narrows the list to
    // sources contributing samples of those types.
    const { searchParams } = new URL(request.url);
    const sourceTypes = [
      ...new Set(
        searchParams
          .getAll('sourceType')
          .flatMap((value) => value.split(','))
          .map((value) => value.trim())
          .filter(Boolean),
      ),
    ].sort();

    const rows = sourceTypes.length === 0
      ? await getOrSetCache(
        'data-sources:all:v2',
        () => prisma.dataSource.findMany({
          select: { id: true, name: true, source_type: true, source_url: true },
          orderBy: { name: 'asc' },
        }),
        3600,
      )
      : await getOrSetCache(
        `data-sources:sourceType:v2:${sourceTypes.join(',')}`,
        () => prisma.$queryRaw<DataSourceOption[]>(Prisma.sql`
          SELECT ds.id, ds.name, ds.source_type, ds.source_url
          FROM data_sources ds
          WHERE ds.id IN (
            SELECT DISTINCT dsi.id
            FROM sample_summary ss
            CROSS JOIN LATERAL unnest(ss.data_source_ids) AS dsi(id)
            WHERE ss.source_types && ${sourceTypes}::text[]
          )
          ORDER BY ds.name ASC
        `),
        3600,
      );

    return NextResponse.json(
      {
        success: true,
        data: rows as DataSourceOption[],
        total: rows.length,
      },
      { headers: { 'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=7200' } }
    );
  } catch (error) {
    return serverError(error, 'Failed to list data sources');
  }
}
