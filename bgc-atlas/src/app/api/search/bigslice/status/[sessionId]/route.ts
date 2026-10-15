import { NextRequest, NextResponse } from 'next/server';
import { getBigSliceSessionMetadata } from '@/lib/bigslice/database';
import { publicJobError, serverError } from '@/lib/api/errors';

interface StatusResponse {
  success: boolean;
  session?: {
    sessionId: string;
    status: 'pending' | 'running' | 'completed' | 'failed';
    progress: number;
    errorMessage?: string;
    totalMatches?: number;
    searchDurationMs?: number;
    createdAt: string;
    startedAt?: string;
    completedAt?: string;
    parameters: {
      distanceThreshold: number;
      numFiles: number;
    };
  };
  error?: string;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
): Promise<NextResponse<StatusResponse>> {
  try {
    const { sessionId } = await params;

    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(sessionId)) {
      return NextResponse.json({
        success: false,
        error: 'Invalid session ID format',
      }, { status: 400 });
    }

    const metadata = await getBigSliceSessionMetadata(sessionId);

    if (!metadata) {
      return NextResponse.json({
        success: false,
        error: 'Session not found',
      }, { status: 404 });
    }

    const response: StatusResponse = {
      success: true,
      session: {
        sessionId: metadata.sessionId,
        status: metadata.status as 'pending' | 'running' | 'completed' | 'failed',
        progress: metadata.progress,
        createdAt: metadata.createdAt.toISOString(),
        parameters: metadata.parameters,
      },
    };

    if (metadata.errorMessage) {
      response.session!.errorMessage = publicJobError('search', metadata.errorMessage);
    }

    if (metadata.totalMatches > 0) {
      response.session!.totalMatches = metadata.totalMatches;
    }

    if (metadata.searchDurationMs) {
      response.session!.searchDurationMs = metadata.searchDurationMs;
    }

    if (metadata.startedAt) {
      response.session!.startedAt = metadata.startedAt.toISOString();
    }

    if (metadata.completedAt) {
      response.session!.completedAt = metadata.completedAt.toISOString();
    }

    const headers: HeadersInit = {};

    if (metadata.status === 'completed' || metadata.status === 'failed') {
      headers['Cache-Control'] = 'public, max-age=300';
    } else {
      headers['Cache-Control'] = 'no-cache, no-store, must-revalidate';
      headers['Pragma'] = 'no-cache';
      headers['Expires'] = '0';
    }

    return NextResponse.json(response, { headers });

  } catch (error) {
    return serverError(error, 'Error retrieving BiG-SLiCE session status');
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
