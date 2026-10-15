import { randomUUID } from 'crypto';
import type { Prisma } from '@prisma/client';
import { NextRequest, NextResponse } from 'next/server';
import type { FilterGroup } from '@/lib/filters/types';
import { countMatches } from '@/lib/opensearch/client';
import { addExportJob } from '@/lib/queue';
import prisma from '@/lib/prisma';
import { getClientIpOrNull } from '@/lib/client-ip';
import { isValidExportEmail, PROPERTY_GBK_EXPORT_MAX_REGIONS } from '@/lib/gcf/export-limits';
import { UnhonourableQueryError } from '@/lib/filters/unhonourable-query';
import { exportRateLimit, getClientIp, checkRateLimit } from '@/lib/rate-limit';
import { serverError } from '@/lib/api/errors';

export const dynamic = 'force-dynamic';

const MAX_REGIONS = PROPERTY_GBK_EXPORT_MAX_REGIONS;

interface GbkExportRequest {
  group?: FilterGroup | null;
  sort?: { field: string; order: 'asc' | 'desc' };
  email?: string;
  /** The /search URL the export was started from, so the job page can link back. */
  searchHref?: string;
}

const searchHrefOf = (v: unknown): string | null =>
  typeof v === 'string' && v.startsWith('/search?') && v.length <= 8192 ? v : null;

// POST /api/search/properties/export-gbk  { group, sort, email?, searchHref? }
// Records a 'regions' export job and queues it to zip up to MAX_REGIONS region
// GBK files. Returns { exportJobId }; the client opens /exports/<exportJobId>.
export async function POST(req: NextRequest) {
  // The export queue runs one job at a time, and middleware skips the general
  // limiter for /api/search/*, so this route carries its own.
  const clientIp = getClientIp(req);
  const rateLimitResult = await checkRateLimit(exportRateLimit, clientIp);
  if (!rateLimitResult.success) {
    return NextResponse.json(
      { error: rateLimitResult.error },
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

  let body: GbkExportRequest;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
  }

  try {
    // A count, not the ids (~10 s for 100k); the job resolves them. countMatches
    // still refuses an unanswerable search before anything is queued.
    const matched = await countMatches(body.group ?? null);
    const regionCount = Math.min(matched, MAX_REGIONS);
    if (!regionCount) {
      return NextResponse.json({ error: 'No matching BGCs to export' }, { status: 400 });
    }

    // One address or none: refused rather than silently dropped, as on the GCF export.
    let email: string | undefined;
    if (typeof body.email === 'string' && body.email.trim() !== '') {
      if (!isValidExportEmail(body.email.trim())) {
        return NextResponse.json(
          { error: 'Enter a single valid email address, or leave it blank.' },
          { status: 400 },
        );
      }
      email = body.email.trim();
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
        search_query: { group: body.group ?? null, sort: body.sort ?? null } as Prisma.InputJsonValue,
        search_href: searchHrefOf(body.searchHref),
      },
    });

    try {
      await addExportJob({
        type: 'property-gbk-export', exportJobId,
        group: body.group ?? null, sort: body.sort ?? null, userEmail: email,
      });
    } catch (queueError) {
      await prisma.gcfExportJob.update({
        where: { id: exportJobId },
        data: { status: 'failed', error_message: 'Could not queue the export', completed_at: new Date() },
      });
      throw queueError;
    }

    return NextResponse.json({ exportJobId, count: regionCount, matched, cap: MAX_REGIONS });
  } catch (err) {
    // Refused before any job is queued; a job on a widened set would email a wrong bundle.
    if (err instanceof UnhonourableQueryError) {
      return NextResponse.json(
        { error: err.message, rejected: err.conditions },
        { status: 400 },
      );
    }
    return serverError(err, '[api/search/properties/export-gbk]', { status: 502 });
  }
}
