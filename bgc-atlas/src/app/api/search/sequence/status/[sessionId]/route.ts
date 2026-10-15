import { NextRequest, NextResponse } from 'next/server';
import { getSessionMetadata } from '@/lib/seqsearch/database';
import { publicJobError, serverError } from '@/lib/api/errors';

interface StatusResponse {
  success: boolean;
  session?: {
    sessionId: string;
    status: 'pending' | 'running' | 'completed' | 'failed';
    progress: number; // 0-100
    errorMessage?: string;
    totalHits?: number;
    searchDurationMs?: number;
    createdAt: string;
    startedAt?: string;
    completedAt?: string;
  };
  job?: {
    jobId: string;
    state: string;
    progress: number | object;
  };
  error?: string;
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ sessionId: string }> }
): Promise<NextResponse<StatusResponse>> {
  try {
    const { sessionId } = await context.params;

    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(sessionId)) {
      return NextResponse.json({
        success: false,
        error: 'Invalid session ID format',
      }, { status: 400 });
    }

    const sessionMetadata = await getSessionMetadata(sessionId);
    if (!sessionMetadata) {
      return NextResponse.json({
        success: false,
        error: 'Session not found',
      }, { status: 404 });
    }

    const sessionResponse: StatusResponse['session'] = {
      sessionId: sessionMetadata.sessionId,
      status: sessionMetadata.status as 'pending' | 'running' | 'completed' | 'failed',
      progress: 0,
      createdAt: sessionMetadata.createdAt.toISOString(),
    };

    if (sessionMetadata.errorMessage) {
      sessionResponse.errorMessage = publicJobError('search', sessionMetadata.errorMessage);
    }

    if (sessionMetadata.totalHits > 0) {
      sessionResponse.totalHits = sessionMetadata.totalHits;
    }

    if (sessionMetadata.searchDurationMs) {
      sessionResponse.searchDurationMs = sessionMetadata.searchDurationMs;
    }

    if (sessionMetadata.completedAt) {
      sessionResponse.completedAt = sessionMetadata.completedAt.toISOString();
    }

    let jobResponse: StatusResponse['job'] | undefined;
    if (sessionResponse.status === 'pending' || sessionResponse.status === 'running') {
      // TODO: store job_id in session metadata and report the BullMQ job's progress.
      if (sessionResponse.status === 'pending') {
        sessionResponse.progress = 0;
      } else if (sessionResponse.status === 'running') {
        sessionResponse.progress = 50;
      }
    } else if (sessionResponse.status === 'completed') {
      sessionResponse.progress = 100;
    }

    const response: StatusResponse = {
      success: true,
      session: sessionResponse,
    };

    if (jobResponse) {
      response.job = jobResponse;
    }

    const cacheControl = (sessionResponse.status === 'completed' || sessionResponse.status === 'failed')
      ? 'public, max-age=300'
      : 'no-cache';

    return NextResponse.json(response, {
      headers: {
        'Cache-Control': cacheControl,
      },
    });

  } catch (error) {
    return serverError(error, 'Error retrieving job status');
  }
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}
