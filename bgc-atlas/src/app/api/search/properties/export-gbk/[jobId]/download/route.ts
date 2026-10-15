import { NextRequest, NextResponse } from 'next/server';
import { createReadStream } from 'fs';
import { Readable } from 'stream';
import { stat } from 'fs/promises';
import { getJobStatus } from '@/lib/queue';
import { publicJobError, serverError } from '@/lib/api/errors';
import { cancelBodyOnAbort, isHead } from '@/lib/http/abandoned-body';

export const dynamic = 'force-dynamic';

interface GbkResult { outputPath?: string; outputFilename?: string }

// GET /api/search/properties/export-gbk/[jobId]/download -> the zip file.
export async function GET(req: NextRequest, { params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params;
  const status = await getJobStatus(jobId);
  if (!status) return NextResponse.json({ error: 'job not found' }, { status: 404 });
  if (status.failedReason) return NextResponse.json({ error: publicJobError('export', status.failedReason) }, { status: 400 });
  if (!status.finishedOn) return NextResponse.json({ error: 'export not ready' }, { status: 409 });

  const rv = (status.returnvalue ?? {}) as GbkResult;
  if (!rv.outputPath) return serverError(new Error(`GBK job ${jobId} finished without an output path`), 'GBK download');

  let size: number;
  try {
    size = (await stat(rv.outputPath)).size;
  } catch {
    return NextResponse.json({ error: 'export file not found (expired?)' }, { status: 404 });
  }

  // Pull-based, so a slow client never makes the server buffer the file.
  const filename = rv.outputFilename ?? 'bgc-regions.zip';
  const headers = {
    'Content-Type': 'application/zip',
    'Content-Disposition': `attachment; filename="${filename}"`,
    'X-Accel-Buffering': 'no',
  };
  // HEAD: the file is not opened -- Next would drop the body unread and the
  // descriptor would stay open (lib/http/abandoned-body).
  if (isHead(req)) return new NextResponse(null, { status: 200, headers: { ...headers, 'Content-Length': String(size) } });

  const webStream = Readable.toWeb(createReadStream(rv.outputPath)) as ReadableStream<Uint8Array>;
  // Closes the file if the client leaves before the download starts.
  cancelBodyOnAbort(req, webStream);

  return new NextResponse(webStream, { status: 200, headers });
}
