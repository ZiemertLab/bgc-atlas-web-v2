// CSV export of a whole session, one row per CDS alignment with BGC columns appended.
import { NextRequest, NextResponse } from 'next/server';
import { getAllSessionHits, getSessionMetadata, hitFiltersFromSearchParams } from '@/lib/seqsearch/database';
import { hydrateBgcs } from '@/lib/seqsearch/hydrate';
import { serverError } from '@/lib/api/errors';
import { escapeDelimitedField } from '@/lib/utils/export';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HYDRATE_CHUNK = 1000;

const COLUMNS = [
  'query_id', 'rank', 'bgc_id', 'bgc_filename', 'contig', 'product_types', 'product_categories',
  'sample_name', 'data_source', 'gcf_name', 'taxon_name', 'target_id', 'cds',
  'identity_pct', 'coverage_pct', 'e_value', 'bit_score', 'alignment_length',
  'query_start', 'query_end', 'query_length', 'target_start', 'target_end', 'target_length',
];

// The shared escaper: quotes \r too, and neutralises spreadsheet formulas -- query ids
// are the submitter's own text, and a results link is shared with others.
const csvCell = (value: string | number | null): string => escapeDelimitedField(value, ',');

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ sessionId: string }> },
) {
  try {
    const { sessionId } = await context.params;
    if (!UUID_RE.test(sessionId)) {
      return NextResponse.json({ success: false, error: 'Invalid session ID format' }, { status: 400 });
    }

    const session = await getSessionMetadata(sessionId);
    if (!session) {
      return NextResponse.json({ success: false, error: 'Session not found' }, { status: 404 });
    }

    // The filters on screen (identity, coverage, the selected locus), as the GBK zip
    // beside this button already applies: the CSV listed the whole session while the
    // zip next to it packaged the filtered set.
    const filters = hitFiltersFromSearchParams(request.nextUrl.searchParams);
    const hits = await getAllSessionHits(sessionId, filters);

    // Chunked so the ::uuid[] parameter stays a sane size.
    const distinctBgcIds = [...new Set(hits.map(h => h.bgcId).filter((id): id is string => !!id))];
    const hydrated: Record<string, Awaited<ReturnType<typeof hydrateBgcs>>[string]> = {};
    for (let i = 0; i < distinctBgcIds.length; i += HYDRATE_CHUNK) {
      Object.assign(hydrated, await hydrateBgcs(distinctBgcIds.slice(i, i + HYDRATE_CHUNK)));
    }

    const lines = [COLUMNS.join(',')];
    for (const hit of hits) {
      const bgc = hit.bgcId ? hydrated[hit.bgcId] : undefined;
      lines.push([
        hit.queryId,
        hit.rank,
        hit.bgcId,
        bgc?.bgcFilename ?? null,
        bgc?.contig ?? null,
        bgc?.products.join(';') ?? null,
        bgc?.categories.join(';') ?? null,
        bgc?.sampleName ?? null,
        bgc?.dataSource ?? null,
        bgc?.gcfName ?? null,
        bgc?.taxonName ?? null,
        hit.targetId,
        hit.cdsLabel,
        hit.identity.toFixed(2),
        hit.coverage.toFixed(2),
        hit.eValue,
        hit.bitScore.toFixed(2),
        hit.alignmentLength,
        hit.queryStart,
        hit.queryEnd,
        hit.queryLength,
        hit.targetStart,
        hit.targetEnd,
        hit.targetLength,
      ].map(csvCell).join(','));
    }

    const csv = lines.join('\n') + '\n';
    return new NextResponse(csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="sequence-search-${sessionId}.csv"`,
      },
    });
  } catch (error) {
    return serverError(error, 'Error exporting search results');
  }
}
