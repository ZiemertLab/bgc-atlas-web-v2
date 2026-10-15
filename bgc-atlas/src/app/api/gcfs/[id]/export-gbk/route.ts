import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { addExportJob } from '@/lib/queue';
import type { GcfGbkExportJob } from '@/lib/queue';
import { getClientIpOrNull } from '@/lib/client-ip';
import { checkRateLimit, exportRateLimit, getClientIp } from '@/lib/rate-limit';
import { GCF_GBK_EXPORT_MAX_MEMBERS, isValidExportEmail } from '@/lib/gcf/export-limits';
import { serverError } from '@/lib/api/errors';

const CACHE_DURATION_MS = 60 * 60 * 1000;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** POST /api/gcfs/[id]/export-gbk */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  // /api/gcfs is exempt from the middleware limiter, and each call can enqueue a long job.
  const rateLimitResult = await checkRateLimit(exportRateLimit, getClientIp(request));
  if (!rateLimitResult.success) {
    const retryAfter = Math.max(0, Math.ceil((rateLimitResult.reset - Date.now()) / 1000));
    return NextResponse.json(
      { success: false, error: rateLimitResult.error ?? 'Too many export requests. Please try again later.' },
      {
        status: 429,
        headers: {
          'Retry-After': String(retryAfter),
          'X-RateLimit-Limit': String(rateLimitResult.limit),
          'X-RateLimit-Remaining': String(rateLimitResult.remaining),
          'X-RateLimit-Reset': new Date(rateLimitResult.reset).toISOString(),
        },
      },
    );
  }

  try {
    const { id: gcfId } = await params;

    if (!UUID_RE.test(gcfId)) {
      return NextResponse.json(
        { success: false, error: 'Invalid GCF id' },
        { status: 400 }
      );
    }

    const gcf = await prisma.gcf.findUnique({
      where: { id: gcfId },
      select: {
        id: true,
        name: true,
      },
    });

    if (!gcf) {
      return NextResponse.json(
        { success: false, error: 'GCF not found' },
        { status: 404 }
      );
    }

    // Primary members only; other memberships belong to another family first.
    const bgcCount = await prisma.bgcGcf.count({ where: { gcf_id: gcfId, is_primary: true } });

    if (bgcCount === 0) {
      return NextResponse.json(
        { success: false, error: 'GCF has no BGCs to export' },
        { status: 400 }
      );
    }

    if (bgcCount > GCF_GBK_EXPORT_MAX_MEMBERS) {
      return NextResponse.json(
        {
          success: false,
          error: `This family has ${bgcCount.toLocaleString('en-US')} member BGCs; per-family GenBank export is limited to ${GCF_GBK_EXPORT_MAX_MEMBERS.toLocaleString('en-US')}. The complete region archives are on /downloads.`,
          memberCount: bgcCount,
          cap: GCF_GBK_EXPORT_MAX_MEMBERS,
          downloadsUrl: '/downloads',
        },
        { status: 400 }
      );
    }

    // Optional notification address. Must be exactly one address: nodemailer
    // would mail every entry of a comma-joined list.
    let userEmail: string | undefined;
    let rawEmail: unknown;
    try {
      rawEmail = (await request.json())?.email;
    } catch {
      // optional body
    }
    if (typeof rawEmail === 'string' && rawEmail.trim() !== '') {
      if (!isValidExportEmail(rawEmail.trim())) {
        return NextResponse.json(
          { success: false, error: 'Enter a single valid email address, or leave it blank.' },
          { status: 400 }
        );
      }
      userEmail = rawEmail.trim();
    }

    const recentExport = await prisma.gcfExportJob.findFirst({
      where: {
        gcf_id: gcfId,
        status: { in: ['pending', 'running', 'completed'] },
        created_at: {
          gte: new Date(Date.now() - CACHE_DURATION_MS),
        },
      },
      orderBy: { created_at: 'desc' },
    });

    if (recentExport && recentExport.status === 'completed') {
      console.log(`Reusing recent export ${recentExport.id} for GCF ${gcfId}`);
      return NextResponse.json({
        success: true,
        exportJobId: recentExport.id,
        queueJobId: recentExport.job_id,
        status: recentExport.status,
        reused: true,
      });
    }

    if (recentExport && (recentExport.status === 'pending' || recentExport.status === 'running')) {
      console.log(`Export already in progress ${recentExport.id} for GCF ${gcfId}`);
      return NextResponse.json({
        success: true,
        exportJobId: recentExport.id,
        queueJobId: recentExport.job_id,
        status: recentExport.status,
        existing: true,
      });
    }

    const clientIp = getClientIpOrNull(request);

    const exportJob = await prisma.gcfExportJob.create({
      data: {
        job_id: '',
        gcf_id: gcfId,
        status: 'pending',
        user_email: userEmail || null,
        user_ip: clientIp,
      },
    });

    const jobData: GcfGbkExportJob = {
      type: 'gcf-gbk-export',
      exportJobId: exportJob.id,
      gcfId: gcf.id,
      gcfName: gcf.name || gcf.id,
      userEmail,
    };

    const queueJob = await addExportJob(jobData);

    await prisma.gcfExportJob.update({
      where: { id: exportJob.id },
      data: { job_id: queueJob.id || 'unknown' },
    });

    console.log(`Created export job ${exportJob.id} for GCF ${gcf.name || gcfId}`);

    return NextResponse.json({
      success: true,
      exportJobId: exportJob.id,
      queueJobId: queueJob.id,
      status: 'pending',
      totalBgcs: bgcCount,
    });
  } catch (error) {
    return serverError(error, 'Error creating GCF export job');
  }
}
