import { access, constants } from 'fs/promises';
import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { publicJobError, serverError } from '@/lib/api/errors';
import { EXPORT_JOB_ID_RE } from '@/lib/export/export-job-download';

export const dynamic = 'force-dynamic';

const STATES: Record<string, 'waiting' | 'active' | 'completed' | 'failed'> = {
  pending: 'waiting',
  running: 'active',
  completed: 'completed',
  failed: 'failed',
};

// GET /api/search/properties/export-gbk/[jobId]  -> job status for polling.
//
// Read from the gcf_export_jobs row, as /api/exports/[jobId] is. This route used
// to read the BullMQ job's return value, which stopped carrying the output path
// when exports became recorded jobs (98a58cc) -- so every finished export
// polled here answered "expired".
export async function GET(_req: NextRequest, { params }: { params: Promise<{ jobId: string }> }) {
  try {
    const { jobId } = await params;
    if (!EXPORT_JOB_ID_RE.test(jobId)) {
      return NextResponse.json({ error: 'job not found' }, { status: 404 });
    }
    const job = await prisma.gcfExportJob.findUnique({
      where: { id: jobId },
      select: {
        status: true,
        progress: true,
        error_message: true,
        output_path: true,
        output_filename: true,
        total_bgcs: true,
        missing_files: true,
        file_size_bytes: true,
        expires_at: true,
        is_deleted: true,
      },
    });
    if (!job) {
      return NextResponse.json({ error: 'job not found' }, { status: 404 });
    }

    const state = STATES[job.status] ?? 'waiting';

    // The browser can only show a failed download as a 404, so report expiry here.
    if (state === 'completed') {
      const live = !job.is_deleted && !!job.output_path
        && !(job.expires_at && new Date() > job.expires_at)
        && await access(job.output_path, constants.R_OK).then(() => true, () => false);
      if (!live) return NextResponse.json({ error: 'export expired' }, { status: 410 });
    }

    return NextResponse.json({
      state,
      ready: state === 'completed',
      progress: job.progress ?? 0,
      error: state === 'failed' ? publicJobError('export', job.error_message) : undefined,
      filename: job.output_filename ?? undefined,
      totalBgcs: job.total_bgcs ?? undefined,
      missingFiles: job.missing_files ?? undefined,
      fileSizeBytes: job.file_size_bytes != null ? Number(job.file_size_bytes) : undefined,
    });
  } catch (error) {
    return serverError(error, 'Error fetching GBK export status');
  }
}
