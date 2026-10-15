import { NextRequest, NextResponse } from 'next/server';
import { getSessionMetadata } from '@/lib/seqsearch/database';
import { readDiamondProgress } from '@/lib/seqsearch/progress';
import { getBigSliceSessionMetadata } from '@/lib/bigslice/database';
import { publicJobError, serverError } from '@/lib/api/errors';

export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    if (!id) {
      return NextResponse.json(
        { success: false, error: 'Session ID is required' },
        { status: 400 }
      );
    }

    const sequenceSession = await getSessionMetadata(id);
    if (sequenceSession) {
      // DIAMOND progress only while running; this route is polled every 2 s per tab.
      const diamond =
        sequenceSession.status === 'running' ? await readDiamondProgress(id) : null;

      return NextResponse.json({
        success: true,
        sessionId: id,
        type: 'sequence',
        results: {
          sequence: {
            ...sequenceSession,
            errorMessage: sequenceSession.errorMessage ? publicJobError('search', sequenceSession.errorMessage) : null,
            diamond,
          },
        },
      });
    }

    const bigsliceSession = await getBigSliceSessionMetadata(id);
    if (bigsliceSession) {
      return NextResponse.json({
        success: true,
        sessionId: id,
        type: 'bgc',
        results: {
          bgc: {
            ...bigsliceSession,
            errorMessage: bigsliceSession.errorMessage ? publicJobError('search', bigsliceSession.errorMessage) : null,
          },
        },
      });
    }

    return NextResponse.json(
      {
        success: false,
        error: 'Session not found',
      },
      { status: 404 }
    );
  } catch (error) {
    return serverError(error, 'Error fetching session results');
  }
}
