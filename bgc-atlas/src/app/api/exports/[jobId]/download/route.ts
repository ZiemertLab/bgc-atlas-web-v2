import { NextRequest, NextResponse } from 'next/server';
import { createReadStream } from 'fs';
import { Readable } from 'stream';
import { stat } from 'fs/promises';
import prisma from '@/lib/prisma';
import { serverError } from '@/lib/api/errors';
import { cancelBodyOnAbort, isHead } from '@/lib/http/abandoned-body';

/** GET /api/exports/[jobId]/download */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) {
  try {
    const { jobId } = await params;
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(jobId)) {
      return NextResponse.json({ success: false, error: 'Export job not found' }, { status: 404 });
    }
    const exportJob = await prisma.gcfExportJob.findUnique({
      where: { id: jobId },
      select: {
        id: true,
        status: true,
        output_path: true,
        output_filename: true,
        is_deleted: true,
        expires_at: true,
      },
    });

    if (!exportJob) {
      return NextResponse.json(
        { success: false, error: 'Export job not found' },
        { status: 404 }
      );
    }

    if (exportJob.status !== 'completed') {
      return NextResponse.json(
        { success: false, error: 'Export is not completed yet' },
        { status: 400 }
      );
    }

    if (exportJob.is_deleted) {
      return NextResponse.json(
        { success: false, error: 'Export file has been deleted' },
        { status: 410 }
      );
    }

    if (!exportJob.output_path || !exportJob.output_filename) {
      return serverError(new Error(`Export ${jobId} is completed but has no output file`), 'Export download');
    }

    if (exportJob.expires_at && new Date() > exportJob.expires_at) {
      return NextResponse.json(
        { success: false, error: 'Export file has expired' },
        { status: 410 }
      );
    }

    let fileStats;
    try {
      fileStats = await stat(exportJob.output_path);
    } catch (error) {
      console.error(`Export file not found: ${exportJob.output_path}`, error);
      return NextResponse.json(
        { success: false, error: 'Export file not found on disk' },
        { status: 404 }
      );
    }

    const headers = {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${exportJob.output_filename}"`,
      'Content-Length': fileStats.size.toString(),
      'Cache-Control': 'private, max-age=3600',
      // nginx would otherwise spool up to 1 GB per slow client onto local disk.
      'X-Accel-Buffering': 'no',
    };

    // HEAD: the file is not opened. Next drops a HEAD's body unread, and an open
    // read stream nobody consumes is a file descriptor held for good.
    if (isHead(request)) return new NextResponse(null, { headers });

    // Pull-based so backpressure holds; a push stream buffered a slow client's
    // whole download (up to ~9 GB) in memory.
    const readableStream = Readable.toWeb(createReadStream(exportJob.output_path)) as ReadableStream<Uint8Array>;
    // Closes the file if the client leaves before the download starts.
    cancelBodyOnAbort(request, readableStream);

    return new NextResponse(readableStream, { headers });
  } catch (error) {
    return serverError(error, 'Error downloading export file');
  }
}
