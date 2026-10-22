import { NextRequest } from 'next/server';
import { serveExportZip } from '@/lib/export/export-job-download';

/** GET /api/exports/[jobId]/download */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) {
  const { jobId } = await params;
  return serveExportZip(request, jobId);
}
