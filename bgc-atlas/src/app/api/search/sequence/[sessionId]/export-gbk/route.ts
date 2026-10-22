import { randomUUID } from 'crypto';
import type { Prisma } from '@prisma/client';
import { NextRequest, NextResponse } from 'next/server';
import { addExportJob } from '@/lib/queue';
import prisma from '@/lib/prisma';
import { getClientIpOrNull } from '@/lib/client-ip';
import { isValidExportEmail, PROPERTY_GBK_EXPORT_MAX_REGIONS } from '@/lib/gcf/export-limits';
import { exportRateLimit, getClientIp, checkRateLimit } from '@/lib/rate-limit';
import { getHitBgcIds, getSessionMetadata, parseHitFilters } from '@/lib/seqsearch/database';
import { serverError } from '@/lib/api/errors';

export const dynamic = 'force-dynamic';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// POST /api/search/sequence/[sessionId]/export-gbk  { filters?, email? }
// Records an export job (gcf_export_jobs, kind 'regions') and queues it to zip the region
// GBK files of the BGCs the session's hits land in, under the results table's filters.
// Returns { exportJobId }; the client opens /exports/<exportJobId>, the same job page as
// the property-search and GCF exports.
//
// Until this existed, the only way to get a sequence search's regions was one
// /api/bgcs/<id>/download per BGC: a reader scripted that for a 999-BGC search and spent
// an afternoon against the download limiter.
export async function POST(
  req: NextRequest,
  context: { params: Promise<{ sessionId: string }> },
) {
  // Enqueues onto the one-at-a-time 'export-jobs' queue, and middleware.ts skips the
  // general limiter for /api/search/*, so this route must carry its own.
  const clientIp = getClientIp(req);
  const rateLimitResult = await checkRateLimit(exportRateLimit, clientIp);
  if (!rateLimitResult.success) {
    return NextResponse.json(
      { success: false, error: rateLimitResult.error },
      {
        status: 429,
        headers: {
          'Retry-After': String(Math.ceil((rateLimitResult.reset - Date.now()) / 1000)),
          'X-RateLimit-Limit': String(rateLimitResult.limit),
          'X-RateLimit-Remaining': String(rateLimitResult.remaining),
          'X-RateLimit-Reset': new Date(rateLimitResult.reset).toISOString(),
        },
      },
    );
  }

  const { sessionId } = await context.params;
  if (!UUID_RE.test(sessionId)) {
    return NextResponse.json({ success: false, error: 'Invalid session ID format' }, { status: 400 });
  }

  let body: { filters?: unknown; email?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, error: 'invalid JSON body' }, { status: 400 });
  }

  try {
    const session = await getSessionMetadata(sessionId);
    if (!session) {
      return NextResponse.json({ success: false, error: 'Session not found' }, { status: 404 });
    }
    if (session.status !== 'completed') {
      return NextResponse.json(
        { success: false, error: 'The search has not finished yet.' },
        { status: 409 },
      );
    }

    // One address or none: refused rather than silently dropped, as on the other exports.
    let email: string | undefined;
    if (typeof body.email === 'string' && body.email.trim() !== '') {
      if (!isValidExportEmail(body.email.trim())) {
        return NextResponse.json(
          { success: false, error: 'Enter a single valid email address, or leave it blank.' },
          { status: 400 },
        );
      }
      email = body.email.trim();
    }

    // Counted here so an empty selection is refused before anything is recorded; the job
    // resolves the same ids again from the same rows, which never change once completed.
    const filters = parseHitFilters(body.filters);
    const matched = (await getHitBgcIds(sessionId, filters)).length;
    const regionCount = Math.min(matched, PROPERTY_GBK_EXPORT_MAX_REGIONS);
    if (!regionCount) {
      return NextResponse.json(
        { success: false, error: 'None of the hits under these filters land in an Atlas BGC.' },
        { status: 400 },
      );
    }

    const exportJobId = randomUUID();
    await prisma.gcfExportJob.create({
      data: {
        id: exportJobId,
        job_id: exportJobId,
        kind: 'regions',
        status: 'pending',
        total_bgcs: regionCount,
        user_email: email ?? null,
        user_ip: getClientIpOrNull(req),
        // `source` tells the job page this is not a property search.
        search_query: { source: 'sequence', sessionId, filters } as unknown as Prisma.InputJsonValue,
        search_href: `/search/results/${sessionId}`,
      },
    });

    try {
      await addExportJob({ type: 'sequence-gbk-export', exportJobId, sessionId, filters, userEmail: email });
    } catch (queueError) {
      await prisma.gcfExportJob.update({
        where: { id: exportJobId },
        data: { status: 'failed', error_message: 'Could not queue the export', completed_at: new Date() },
      });
      throw queueError;
    }

    return NextResponse.json({ success: true, exportJobId, count: regionCount, matched });
  } catch (err) {
    return serverError(err, '[api/search/sequence/export-gbk]');
  }
}
