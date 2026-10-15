// Where a sequence search's hits come from. Same response shape as
// /api/gcfs/[id]/samples/map, but derived per request (sessions are ad hoc).
// Query and cache live in lib/seqsearch/sample-map so the worker can warm them.
import { NextRequest, NextResponse } from 'next/server';

import { getSessionMetadata } from '@/lib/seqsearch/database';
import { getSequenceSampleMap, MAX_MAP_LIMIT } from '@/lib/seqsearch/sample-map';
import { serverError } from '@/lib/api/errors';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const numberParam = (value: string | null) => {
  if (value === null) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

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

    const { searchParams } = new URL(request.url);
    const data = await getSequenceSampleMap(
      sessionId,
      {
        minIdentity: numberParam(searchParams.get('minIdentity')),
        minCoverage: numberParam(searchParams.get('minCoverage')),
        queryFrom: numberParam(searchParams.get('queryFrom')),
        queryTo: numberParam(searchParams.get('queryTo')),
      },
      session.status === 'completed',
    );

    return NextResponse.json(
      { success: true, data, total: data.length, limit: MAX_MAP_LIMIT },
      { headers: { 'Cache-Control': session.status === 'completed' ? 'public, max-age=3600' : 'no-cache' } },
    );
  } catch (error) {
    return serverError(error, 'Error building sequence-search sample map');
  }
}
