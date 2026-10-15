import { NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import { getOrSetCache } from '@/lib/cache';
import { serverError } from '@/lib/api/errors';

/**
 * GTDB taxonomy of genomes (isolate/MAG/SAG) for the Genome Collections
 * sunbursts: one row per domain->family lineage; the client nests them.
 *
 * Reads `assembly_taxonomy` (one resolved lineage per genome) with a LEFT JOIN,
 * so each genome counts once and unresolved or BGC-less genomes fall into the
 * domain-NULL ("Unknown") group. Deriving lineages from BGCs would double-count
 * and scan ~16.5M rows.
 */
type GenomeTaxonomyRow = {
  domain: string | null;
  phylum: string | null;
  class: string | null;
  order_name: string | null;
  family: string | null;
  bgc_count: number;
  genome_count: number;
};

export async function GET() {
  try {
    const hierarchy = await getOrSetCache<GenomeTaxonomyRow[]>(
      // Versioned: bumped rather than flushed so no instance keeps serving an old entry.
      'statistics:genomes:taxonomy-hierarchy:v5',
      async () => {
        const [rows, corpusRes] = await Promise.all([
          prisma.$queryRaw<GenomeTaxonomyRow[]>(Prisma.sql`
            SELECT
              at.domain,
              at.phylum,
              at.class,
              at.order_name,
              at.family,
              COUNT(*)::int AS genome_count,
              COALESCE(SUM(at.n_bgcs), 0)::int AS bgc_count
            FROM assemblies a
            LEFT JOIN assembly_taxonomy at ON at.assembly_id = a.id
            WHERE a.source_type IN ('isolate', 'MAG', 'SAG')
            GROUP BY at.domain, at.phylum, at.class, at.order_name, at.family
          `),
          // Same matview as the stat strip, so the two agree even if it is stale.
          prisma.$queryRaw<Array<{ total: bigint }>>(Prisma.sql`
            SELECT COALESCE(SUM(bgc_count), 0)::bigint AS total
            FROM source_type_statistics
            WHERE source_type IN ('isolate', 'MAG', 'SAG')
          `),
        ]);

        // BGCs of unresolved genomes are in no group's n_bgcs; add them to the
        // Unknown group so the total matches the stat strip. A negative remainder
        // means a stale matview and is skipped.
        const corpusBgcs = Number(corpusRes?.[0]?.total ?? 0);
        const attributed = rows.reduce((sum, row) => sum + row.bgc_count, 0);
        const unattributed = corpusBgcs - attributed;

        if (unattributed > 0) {
          const unknown = rows.find((row) => row.domain === null);
          if (unknown) {
            unknown.bgc_count += unattributed;
          } else {
            rows.push({
              domain: null, phylum: null, class: null, order_name: null, family: null,
              bgc_count: unattributed, genome_count: 0,
            });
          }
        }

        return rows;
      },
      21600,
    );

    return NextResponse.json(
      { success: true, data: { hierarchy } },
      { headers: { 'Cache-Control': 'public, s-maxage=21600, stale-while-revalidate=3600' } },
    );
  } catch (error) {
    return serverError(error, 'Failed to load genome taxonomy hierarchy');
  }
}
