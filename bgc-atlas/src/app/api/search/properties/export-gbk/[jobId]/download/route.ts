import { NextRequest } from 'next/server';
import { serveExportZip } from '@/lib/export/export-job-download';

export const dynamic = 'force-dynamic';

// GET /api/search/properties/export-gbk/[jobId]/download -> the zip file.
// The same file /api/exports/[jobId]/download serves; this path predates it.
export async function GET(req: NextRequest, { params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params;
  return serveExportZip(req, jobId);
}
