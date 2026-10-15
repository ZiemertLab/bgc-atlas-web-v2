import { stat } from 'fs/promises';
import { NextRequest, NextResponse } from 'next/server';
import { getJobStatus } from '@/lib/queue';
import { publicJobError } from '@/lib/api/errors';

export const dynamic = 'force-dynamic';

interface GbkResult {
  outputPath?: string;
  outputFilename?: string;
  totalBgcs?: number;
  missingFiles?: number;
  fileSizeBytes?: number;
}

// GET /api/search/properties/export-gbk/[jobId]  -> job status for polling.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params;
  const status = await getJobStatus(jobId);
  if (!status) {
    return NextResponse.json({ error: 'job not found' }, { status: 404 });
  }

  const state = status.failedReason ? 'failed'
    : status.finishedOn ? 'completed'
      : status.processedOn ? 'active' : 'waiting';
  const rv = (status.returnvalue ?? {}) as GbkResult;

  // The browser can only show a failed download as a 404, so report expiry here.
  if (state === 'completed') {
    const present = rv.outputPath ? await stat(rv.outputPath).then(() => true, () => false) : false;
    if (!present) return NextResponse.json({ error: 'export expired' }, { status: 410 });
  }

  return NextResponse.json({
    state,
    ready: state === 'completed',
    progress: typeof status.progress === 'number' ? status.progress : 0,
    error: status.failedReason ? publicJobError('export', status.failedReason) : undefined,
    filename: rv.outputFilename,
    totalBgcs: rv.totalBgcs,
    missingFiles: rv.missingFiles,
    fileSizeBytes: rv.fileSizeBytes,
  });
}
