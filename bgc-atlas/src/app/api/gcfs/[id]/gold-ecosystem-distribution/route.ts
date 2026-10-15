import { NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import { getOrSetCache } from '@/lib/cache';
import { serverError } from '@/lib/api/errors';
import { aggregateBrowseIndex, isBrowseSearchEnabled } from '@/lib/opensearch/browse-client';
import {
  buildGcfGoldDistributionRequest, parseGcfGoldDistributionResponse, type GoldPathCount,
} from '@/lib/opensearch/gcf-gold-distribution';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * GOLD ecosystem distribution for a GCF. Separate from /api/gcfs/[id] because it
 * feeds a collapsed section. Served from a terms aggregation on bgc_browse;
 * topPathsFromSql is the fallback for when the index is disabled or unreachable.
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  if (!UUID_REGEX.test(id)) {
    return NextResponse.json(
      { success: false, error: 'Invalid GCF ID', message: 'The provided GCF ID is not a valid UUID' },
      { status: 400 },
    );
  }

  try {
    const distribution = await getOrSetCache(`gcf:${id}:gold-ecosystem-distribution`, async () => {
      const rows = await topPaths(id);
      const totalBgcs = rows.reduce((sum, r) => sum + r.bgc_count, 0);
      return rows.map((row) => {
        const path = row.gold_ecosystem_path;
        const parts = path.split(':').map((p) => p.trim()).filter(Boolean);
        return {
          goldLevel1: parts[0] || null,
          goldLevel2: parts.length > 1 ? parts.slice(0, 2).join(':') : null,
          goldLevel3: parts.length > 2 ? parts.slice(0, 3).join(':') : null,
          goldLevel4: parts.length > 3 ? parts.slice(0, 4).join(':') : null,
          goldLevel5: parts.length > 4 ? path : null,
          bgcCount: row.bgc_count,
          percentage: totalBgcs > 0 ? (row.bgc_count / totalBgcs) * 100 : 0,
        };
      });
    }, 3600); // 1h — static between re-clusters

    return NextResponse.json(
      { success: true, data: { distribution } },
      { headers: { 'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=60' } },
    );
  } catch (error) {
    return serverError(error, 'Failed to load GCF GOLD ecosystem distribution');
  }
}

async function topPaths(id: string): Promise<GoldPathCount[]> {
  if (isBrowseSearchEnabled('bgcs')) {
    try {
      return parseGcfGoldDistributionResponse(
        await aggregateBrowseIndex('bgcs', buildGcfGoldDistributionRequest(id)),
      );
    } catch (error) {
      console.error('OpenSearch GCF ecosystem aggregation failed; falling back to PostgreSQL', error);
    }
  }
  return topPathsFromSql(id);
}

/**
 * The same top-50 paths from PostgreSQL. Slow on large families: it looks up
 * every member BGC in `bgcs` for its assembly, one cold read each —
 * ~155 s for a 92k-member family — so it is the fallback, not the normal path.
 */
async function topPathsFromSql(id: string): Promise<GoldPathCount[]> {
  // Collapse members to distinct assemblies before the sample join (a gold
  // path depends only on the assembly). work_mem is pinned so the hashes stay
  // off CephFS temp.
  const rows = await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SET LOCAL work_mem = '256MB'`);
    return tx.$queryRaw<Array<{ gold_ecosystem_path: string; bgc_count: number }>>(Prisma.sql`
      WITH fam_asm AS (
        SELECT b.assembly AS assembly_id, COUNT(*)::int AS bgc_count
        FROM bgc_gcf bg
        JOIN bgcs b ON b.id = bg.bgc_id
        -- primary membership only
        WHERE bg.gcf_id = ${id}::uuid AND bg.is_primary
        GROUP BY b.assembly
      ),
      asm_paths AS (
        SELECT DISTINCT sa.assembly_id, sb.gold_ecosystem_path
        FROM sample_assemblies sa
        JOIN sample_summary sb ON sb.id = sa.sample_id
        WHERE sa.assembly_id IN (SELECT assembly_id FROM fam_asm)
          AND sb.gold_ecosystem_path IS NOT NULL
          AND sb.gold_ecosystem_path != ''
      )
      SELECT ap.gold_ecosystem_path, SUM(fa.bgc_count)::int AS bgc_count
      FROM asm_paths ap
      JOIN fam_asm fa ON fa.assembly_id = ap.assembly_id
      GROUP BY ap.gold_ecosystem_path
      ORDER BY bgc_count DESC
      LIMIT 50
    `);
  }, { timeout: 120000, maxWait: 20000 });
  return rows;
}
