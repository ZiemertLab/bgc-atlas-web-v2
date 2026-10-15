// TSV export of a BiG-SLiCE result set, one row per candidate. TSV because pet
// names and GOLD paths routinely contain commas.
import { NextResponse } from 'next/server';

import { getBigSliceSessionMetadata, getBigSliceSessionResults } from '@/lib/bigslice/database';
import { isMember } from '@/lib/bigslice/families';
import { hydrateGcfs } from '@/lib/bigslice/hydrate';
import { serverError } from '@/lib/api/errors';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Above any real job: 100 files x 3 ranks x 2 tiers = 600. */
const MAX_ROWS = 2000;

const COLUMNS = [
  'query_file', 'rank', 'tier', 'distance', 'is_member',
  'gcf_name', 'gcf_pet_name', 'gcf_id', 'bigslice_gcf_id',
  'member_bgcs', 'assemblies', 'product_categories', 'dominant_taxon', 'top_biome',
] as const;

/** TSV has no quoting, so strip separators. */
function cell(value: string | number | boolean | null | undefined): string {
  if (value === null || value === undefined) return '';
  return String(value).replace(/[\t\r\n]+/g, ' ').trim();
}

function topShare(distribution: Record<string, number> | undefined): string {
  if (!distribution) return '';
  const entries = Object.entries(distribution);
  if (entries.length === 0) return '';
  const [label, share] = entries.reduce((best, next) => (next[1] > best[1] ? next : best));
  return `${label} (${share.toFixed(1)}%)`;
}

export async function GET(
  request: Request,
  context: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId } = await context.params;
  if (!UUID_RE.test(sessionId)) {
    return NextResponse.json({ success: false, error: 'Invalid session ID format' }, { status: 400 });
  }

  try {
    const metadata = await getBigSliceSessionMetadata(sessionId);
    if (!metadata) {
      return NextResponse.json({ success: false, error: 'Job not found' }, { status: 404 });
    }

    const results = await getBigSliceSessionResults(sessionId, { limit: MAX_ROWS });
    const hydrated = await hydrateGcfs(
      results.map((result) => result.gcfId).filter((id): id is string => Boolean(id)),
    );

    const lines = [COLUMNS.join('\t')];
    for (const result of results) {
      const gcf = result.gcfId ? hydrated.get(result.gcfId) ?? null : null;
      lines.push([
        cell(result.origFilename),
        // 1-based; the database stores BiG-SLiCE's 0-based rank.
        cell(result.rank + 1),
        cell(result.tier),
        cell(result.distance.toFixed(6)),
        cell(isMember(result.distance)),
        cell(result.gcfName),
        cell(result.petName),
        cell(result.gcfId),
        cell(result.bigsliceGcfId),
        cell(result.nBgc),
        cell(gcf?.assemblyCount),
        cell(gcf?.productCategories?.join('; ')),
        cell(topShare(gcf?.taxonomyDistribution)),
        cell(topShare(gcf?.biomeDistributionByLevel?.[1])),
      ].join('\t'));
    }

    const tsv = lines.join('\n') + '\n';
    return new NextResponse(tsv, {
      headers: {
        'Content-Type': 'text/tab-separated-values; charset=utf-8',
        'Content-Disposition': `attachment; filename="bgc-atlas-clustering-${sessionId.slice(0, 8)}.tsv"`,
      },
    });
  } catch (error) {
    return serverError(error, 'Error exporting BiG-SLiCE results');
  }
}
