// CDS-level alignments for one (query, BGC) group, fetched when a row is expanded.
import { NextRequest, NextResponse } from 'next/server';
import { getGroupHits, getSessionMetadata, hitFiltersFromSearchParams } from '@/lib/seqsearch/database';
import { serverError } from '@/lib/api/errors';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ sessionId: string }> },
) {
  try {
    const { sessionId } = await context.params;
    if (!UUID_RE.test(sessionId)) {
      return NextResponse.json({ success: false, error: 'Invalid session ID format' }, { status: 400 });
    }

    const { searchParams } = new URL(request.url);
    const groupKey = searchParams.get('groupKey');
    if (!groupKey) {
      return NextResponse.json({ success: false, error: 'groupKey is required' }, { status: 400 });
    }
    // The table's filters, the selected locus among them, so an expanded row lists
    // only the alignments the table shows.
    const filters = hitFiltersFromSearchParams(searchParams);

    const session = await getSessionMetadata(sessionId);
    if (!session) {
      return NextResponse.json({ success: false, error: 'Session not found' }, { status: 404 });
    }

    const hits = await getGroupHits(sessionId, groupKey, filters);

    return NextResponse.json({ success: true, hits }, {
      headers: { 'Cache-Control': session.status === 'completed' ? 'public, max-age=3600' : 'no-cache' },
    });
  } catch (error) {
    return serverError(error, 'Error retrieving group hits');
  }
}
