// Where on the submitted sequence each hit CDS lands; only for queries with a contig.
import { NextRequest, NextResponse } from 'next/server';
import { getContigMap, getSessionMetadata } from '@/lib/seqsearch/database';
import { serverError } from '@/lib/api/errors';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const MAX_STACK_GROUPS = 100;
const DEFAULT_STACK_GROUPS = 30;

function groupLimitFrom(request: NextRequest): number {
  const requested = Number(new URL(request.url).searchParams.get('groups'));
  return Number.isFinite(requested) && requested > 0
    ? Math.min(Math.trunc(requested), MAX_STACK_GROUPS)
    : DEFAULT_STACK_GROUPS;
}

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
    // A GenBank CDS-translation search is protein but still has a contig, so let
    // getContigMap decide rather than gating on search type.
    const map = await getContigMap(sessionId, groupLimitFrom(request));
    if (!map.queries.length) {
      return NextResponse.json(
        { success: false, error: 'This search has no contig to map hits onto' },
        { status: 400 },
      );
    }

    return NextResponse.json({ success: true, map }, {
      headers: { 'Cache-Control': session.status === 'completed' ? 'public, max-age=3600' : 'no-cache' },
    });
  } catch (error) {
    return serverError(error, 'Error building contig map');
  }
}
