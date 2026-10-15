import { NextRequest, NextResponse } from 'next/server';
import { getBigSliceSessionMetadata, getBigSliceSessionResults } from '@/lib/bigslice/database';
import { isMember } from '@/lib/bigslice/families';
import { hydrateGcfs, type HydratedGcf } from '@/lib/bigslice/hydrate';
import { serverError } from '@/lib/api/errors';

interface BigSliceResultsResponse {
  success: boolean;
  session?: {
    sessionId: string;
    status: string;
    totalMatches: number;
    searchDurationMs: number | null;
    createdAt: string;
    completedAt: string | null;
    parameters: {
      distanceThreshold: number;
      numFiles: number;
    };
  };
  results?: Array<{
    resultId: string;
    origFilename: string;
    bigsliceGcfId: number | null;
    /** Which v3 model produced the hit; bigsliceGcfId is ambiguous without it. */
    tier: 'seed' | 'fragmented';
    distance: number;
    rank: number;
    /** Null for a reference-only family with no Atlas page. */
    gcfId: string | null;
    gcfName: string | null;
    petName: string | null;
    nBgc: number | null;
    domCategory: string | null;
    /** distance <= the clustering threshold: a membership rather than a near miss. */
    isMember: boolean;
    /** From the /gcfs index; null when the family has no atlas row or browse search is unavailable. */
    gcf: HydratedGcf | null;
  }>;
  pagination?: {
    total: number;
    limit: number;
    offset: number;
    hasMore: boolean;
  };
  error?: string;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
): Promise<NextResponse<BigSliceResultsResponse>> {
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

    const searchParams = request.nextUrl.searchParams;
    // A maximal job is 100 files x 3 ranks x 2 tiers = 600 rows, and the results
    // page groups by file rather than paginating, so this must cover a whole job.
    const MAX_RESULT_ROWS = 1000;
    const limit = Math.min(parseInt(searchParams.get('limit') || '50', 10), MAX_RESULT_ROWS);
    const offset = parseInt(searchParams.get('offset') || '0', 10);
    const minMembership = searchParams.get('minMembership')
      ? parseFloat(searchParams.get('minMembership')!)
      : undefined;
    const sortBy = (searchParams.get('sortBy') || 'distance') as 'membership' | 'distance' | 'filename';
    const sortOrder = (searchParams.get('sortOrder') || 'asc') as 'asc' | 'desc';

    if (isNaN(limit) || limit < 1 || limit > MAX_RESULT_ROWS) {
      return NextResponse.json({
        success: false,
        error: 'Limit must be between 1 and 500',
      }, { status: 400 });
    }

    if (isNaN(offset) || offset < 0) {
      return NextResponse.json({
        success: false,
        error: 'Offset must be 0 or greater',
      }, { status: 400 });
    }

    if (minMembership !== undefined && (isNaN(minMembership) || minMembership < 0 || minMembership > 1)) {
      return NextResponse.json({
        success: false,
        error: 'Minimum membership must be between 0 and 1',
      }, { status: 400 });
    }

    if (!['membership', 'distance', 'filename'].includes(sortBy)) {
      return NextResponse.json({
        success: false,
        error: 'Sort by must be one of: membership, distance, filename',
      }, { status: 400 });
    }

    if (!['asc', 'desc'].includes(sortOrder)) {
      return NextResponse.json({
        success: false,
        error: 'Sort order must be either asc or desc',
      }, { status: 400 });
    }

    const results = await getBigSliceSessionResults(sessionId, {
      limit: limit + 1, // one extra to detect more
      offset,
      minMembership,
      sortBy,
      sortOrder,
    });

    const hasMore = results.length > limit;
    const displayResults = hasMore ? results.slice(0, limit) : results;

    const hydrated = await hydrateGcfs(
      displayResults.map((result) => result.gcfId).filter((id): id is string => Boolean(id)),
    );

    const response: BigSliceResultsResponse = {
      success: true,
      session: {
        sessionId: metadata.sessionId,
        status: metadata.status,
        totalMatches: metadata.totalMatches,
        searchDurationMs: metadata.searchDurationMs,
        createdAt: metadata.createdAt.toISOString(),
        completedAt: metadata.completedAt?.toISOString() || null,
        parameters: metadata.parameters,
      },
      results: displayResults.map(result => ({
        resultId: result.resultId,
        origFilename: result.origFilename,
        bigsliceGcfId: result.bigsliceGcfId,
        tier: result.tier,
        distance: result.distance,
        rank: result.rank,
        gcfId: result.gcfId,
        gcfName: result.gcfName,
        petName: result.petName,
        nBgc: result.nBgc,
        domCategory: result.domCategory,
        isMember: isMember(result.distance),
        gcf: result.gcfId ? hydrated.get(result.gcfId) ?? null : null,
      })),
      pagination: {
        total: metadata.totalMatches,
        limit,
        offset,
        hasMore,
      },
    };

    const headers: HeadersInit = {};

    if (metadata.status === 'completed') {
      headers['Cache-Control'] = 'public, max-age=3600';
    } else if (metadata.status === 'failed') {
      headers['Cache-Control'] = 'public, max-age=300';
    } else {
      headers['Cache-Control'] = 'no-cache, no-store, must-revalidate';
      headers['Pragma'] = 'no-cache';
      headers['Expires'] = '0';
    }

    return NextResponse.json(response, { headers });

  } catch (error) {
    return serverError(error, 'Error retrieving BiG-SLiCE search results');
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
