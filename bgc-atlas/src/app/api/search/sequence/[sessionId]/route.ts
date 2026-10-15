import { NextRequest, NextResponse } from 'next/server';
import { getResultGroups, getSessionMetadata, getTruncatedQueries } from '@/lib/seqsearch/database';
import { hydrateBgcs, type HydratedBgc } from '@/lib/seqsearch/hydrate';
import { publicJobError, serverError } from '@/lib/api/errors';

interface ResultGroupResponse {
  groupKey: string;
  queryIds: string[];
  bgcId: string | null;
  /** false when the hit region has no row in `bgcs` ("not in Atlas"). */
  linked: boolean;
  bgcFilename: string | null;
  contig: string | null;
  products: string[];
  categories: string[];
  sampleId: string | null;
  sampleName: string | null;
  dataSource: string | null;
  gcfId: string | null;
  gcfName: string | null;
  taxonName: string | null;
  taxonLineage: string | null;
  cdsHits: number;
  bestIdentity: number;
  bestCoverage: number;
  bestEValue: number;
  bestBitScore: number;
}

interface SearchResultsResponse {
  success: boolean;
  session?: {
    sessionId: string;
    status: string;
    totalHits: number;
    searchDurationMs: number | null;
    createdAt: string;
    completedAt: string | null;
    sequenceType: string;
    maxResults: number;
    /** Query ids whose hits were cut off at max-target-seqs. */
    truncatedQueries: string[];
    parameters: {
      eValue: number;
      minIdentity: number;
      minCoverage: number;
    };
  };
  groups?: ResultGroupResponse[];
  pagination?: {
    total: number;
    limit: number;
    offset: number;
    hasMore: boolean;
  };
  error?: string;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ sessionId: string }> },
): Promise<NextResponse<SearchResultsResponse>> {
  try {
    const { sessionId } = await context.params;

    if (!UUID_RE.test(sessionId)) {
      return NextResponse.json({ success: false, error: 'Invalid session ID format' }, { status: 400 });
    }

    const sessionMetadata = await getSessionMetadata(sessionId);
    if (!sessionMetadata) {
      return NextResponse.json({ success: false, error: 'Session not found' }, { status: 404 });
    }

    const { searchParams } = new URL(request.url);
    const limit = Math.min(parseInt(searchParams.get('limit') || '25'), 200);
    const offset = parseInt(searchParams.get('offset') || '0');
    const minIdentity = searchParams.get('minIdentity') ? parseFloat(searchParams.get('minIdentity')!) : undefined;
    const minCoverage = searchParams.get('minCoverage') ? parseFloat(searchParams.get('minCoverage')!) : undefined;
    const queryId = searchParams.get('queryId') || undefined;
    const queryFrom = searchParams.get('queryFrom') ? parseInt(searchParams.get('queryFrom')!, 10) : undefined;
    const queryTo = searchParams.get('queryTo') ? parseInt(searchParams.get('queryTo')!, 10) : undefined;
    const sortBy = (searchParams.get('sortBy') || 'evalue') as
      'evalue' | 'identity' | 'bitscore' | 'querygenes';
    const sortOrder = (searchParams.get('sortOrder') || 'asc') as 'asc' | 'desc';

    if (limit < 1 || offset < 0) {
      return NextResponse.json({ success: false, error: 'Invalid pagination parameters' }, { status: 400 });
    }

    const session = {
      sessionId: sessionMetadata.sessionId,
      status: sessionMetadata.status,
      totalHits: sessionMetadata.totalHits,
      searchDurationMs: sessionMetadata.searchDurationMs,
      createdAt: sessionMetadata.createdAt.toISOString(),
      completedAt: sessionMetadata.completedAt ? sessionMetadata.completedAt.toISOString() : null,
      sequenceType: sessionMetadata.sequenceType,
      maxResults: sessionMetadata.maxResults,
      hasContigMap: sessionMetadata.hasContigMap,
      totalGroups: sessionMetadata.totalGroups,
      truncatedQueries: [] as string[],
      parameters: sessionMetadata.parameters,
    };

    if (sessionMetadata.status === 'pending' || sessionMetadata.status === 'running') {
      return NextResponse.json({
        success: true,
        session: { ...session, totalHits: 0, searchDurationMs: null, completedAt: null },
        groups: [],
        pagination: { total: 0, limit, offset, hasMore: false },
      });
    }

    if (sessionMetadata.status === 'failed') {
      return NextResponse.json({
        success: false,
        error: publicJobError('search', sessionMetadata.errorMessage),
      }, { status: 500 });
    }

    const { groups, total } = await getResultGroups(sessionId, {
      limit, offset, minIdentity, minCoverage, sortBy, sortOrder, queryId, queryFrom, queryTo,
    });
    session.truncatedQueries = await getTruncatedQueries(sessionId, sessionMetadata.maxResults);

    const hydrated = await hydrateBgcs(groups.map(g => g.bgcId).filter((id): id is string => !!id));

    const response: SearchResultsResponse = {
      success: true,
      session,
      groups: groups.map(group => {
        const bgc: HydratedBgc | undefined = group.bgcId ? hydrated[group.bgcId] : undefined;
        return {
          groupKey: group.groupKey,
          queryIds: group.queryIds,
          bgcId: group.bgcId,
          linked: !!bgc,
          bgcFilename: bgc?.bgcFilename ?? group.bgcFilename,
          contig: bgc?.contig ?? null,
          products: bgc?.products ?? [],
          categories: bgc?.categories ?? [],
          sampleId: bgc?.sampleId ?? null,
          sampleName: bgc?.sampleName ?? null,
          dataSource: bgc?.dataSource ?? null,
          gcfId: bgc?.gcfId ?? null,
          gcfName: bgc?.gcfName ?? null,
          taxonName: bgc?.taxonName ?? null,
          taxonLineage: bgc?.taxonLineage ?? null,
          cdsHits: group.cdsHits,
          bestIdentity: group.bestIdentity,
          bestCoverage: group.bestCoverage,
          bestEValue: group.bestEValue,
          bestBitScore: group.bestBitScore,
        };
      }),
      pagination: { total, limit, offset, hasMore: offset + groups.length < total },
    };

    return NextResponse.json(response, {
      headers: {
        'Cache-Control': sessionMetadata.status === 'completed' ? 'public, max-age=3600' : 'no-cache',
      },
    });

  } catch (error) {
    return serverError(error, 'Error retrieving search results');
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
