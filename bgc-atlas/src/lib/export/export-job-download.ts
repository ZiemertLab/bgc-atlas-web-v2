import { NextResponse } from 'next/server';
import { createReadStream } from 'fs';
import { Readable } from 'stream';
import { stat } from 'fs/promises';
import prisma from '@/lib/prisma';
import { serverError } from '@/lib/api/errors';
import { cancelBodyOnAbort, isHead } from '@/lib/http/abandoned-body';

/**
 * A single `Range: bytes=` request over a file of `size` bytes: `a-b`, `a-` or the
 * suffix `-n`. null means serve the whole file (no header, a syntax this does not
 * take, or several ranges -- RFC 9110 lets a server ignore those); 'unsatisfiable'
 * is the 416 for a range that starts past the end.
 */
export function byteRange(
  header: string | null,
  size: number,
): { start: number; end: number } | 'unsatisfiable' | null {
  const m = header ? /^bytes=(\d*)-(\d*)$/.exec(header.trim()) : null;
  if (!m || (m[1] === '' && m[2] === '')) return null;
  if (m[1] === '') {
    const suffix = Number(m[2]);
    if (suffix === 0) return 'unsatisfiable';
    return { start: Math.max(0, size - suffix), end: size - 1 };
  }
  const start = Number(m[1]);
  const end = m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1);
  if (start >= size) return 'unsatisfiable';
  if (end < start) return null;
  return { start, end };
}

export const EXPORT_JOB_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The ZIP of a completed export job, read from its gcf_export_jobs row.
 *
 * Served by /api/exports/[jobId]/download and by the older property-search path
 * /api/search/properties/export-gbk/[jobId]/download. That path once read the
 * file from the BullMQ job's return value, which stopped carrying it when
 * exports became recorded jobs -- every download there was a 500 until both
 * routes shared this.
 */
export async function serveExportZip(request: Request, jobId: string): Promise<Response> {
  try {
    if (!EXPORT_JOB_ID_RE.test(jobId)) {
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

    // Check if file has expired
    if (exportJob.expires_at && new Date() > exportJob.expires_at) {
      return NextResponse.json(
        { success: false, error: 'Export file has expired' },
        { status: 410 }
      );
    }

    // Verify file exists and get stats
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

    const size = fileStats.size;
    const headers: Record<string, string> = {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${exportJob.output_filename}"`,
      'Content-Length': size.toString(),
      'Cache-Control': 'private, max-age=3600',
      // nginx would otherwise spool up to 1 GB per slow client onto the 38 GB root disk.
      'X-Accel-Buffering': 'no',
      // Resumable: a dropped download of a multi-GB zip restarted from byte 0.
      'Accept-Ranges': 'bytes',
    };

    const range = byteRange(request.headers.get('range'), size);
    if (range === 'unsatisfiable') {
      return new NextResponse(null, {
        status: 416,
        headers: { 'Content-Range': `bytes */${size}`, 'Accept-Ranges': 'bytes' },
      });
    }
    let status = 200;
    if (range) {
      status = 206;
      headers['Content-Range'] = `bytes ${range.start}-${range.end}/${size}`;
      headers['Content-Length'] = String(range.end - range.start + 1);
    }

    // HEAD: the file is not opened. Next drops a HEAD's body unread, and an open
    // read stream nobody consumes is a file descriptor held for good.
    if (isHead(request)) return new NextResponse(null, { status, headers });

    // Pull-based so backpressure holds; a push stream buffered a slow client's
    // whole download (up to ~9 GB) in memory.
    const readableStream = Readable.toWeb(
      createReadStream(exportJob.output_path, range ? { start: range.start, end: range.end } : undefined),
    ) as ReadableStream<Uint8Array>;
    // Closes the file if the client leaves before the download starts.
    cancelBodyOnAbort(request, readableStream);

    return new NextResponse(readableStream, { status, headers });
  } catch (error) {
    return serverError(error, 'Error downloading export file');
  }
}
