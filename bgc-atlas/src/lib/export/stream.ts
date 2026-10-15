/**
 * Streamed "All matching" table exports. Server only.
 *
 *   1. GET <list>/export?<list params>&format=…&check=1 validates and counts, consuming nothing.
 *   2. The same URL without check=1 spends one rate-limit unit, waits for a slot, and streams.
 *
 * Failures after step 1 are answered as an attachment with an error status (or abort the stream),
 * so the browser marks the download failed instead of leaving a silently truncated file.
 */
import { NextResponse } from 'next/server';

import { filterRefusalResponse } from '@/lib/api/filter-refusal';
import { cancelBodyOnAbort, isHead } from '@/lib/http/abandoned-body';
import { checkRateLimit, exportRateLimit, getClientIp } from '@/lib/rate-limit';
import {
  EXPORT_MIME,
  EXPORT_ROW_CAP,
  exportEpilogue,
  exportFilename,
  exportPreamble,
  exportRows,
  parseExportFormat,
  type ExportColumn,
  type ExportFormat,
} from '@/lib/export/format';

export { EXPORT_ROW_CAP };

/** Rows per index round trip and per enrichment lookup. */
export const EXPORT_BATCH = 5_000;

// In-process count is site-wide (single pm2 fork); a cold 100k-row export holds Postgres ~3 min.
export const MAX_CONCURRENT_EXPORTS = 2;

const SLOT_WAIT_MS = 60_000;

let active = 0;
const waiting: (() => void)[] = [];

/** Resolves to a release function, or null if no slot freed up in time. */
async function acquireSlot(timeoutMs = SLOT_WAIT_MS): Promise<(() => void) | null> {
  if (active < MAX_CONCURRENT_EXPORTS) {
    active += 1;
    return releaser();
  }
  return new Promise((resolve) => {
    const wake = () => {
      clearTimeout(timer);
      active += 1;
      resolve(releaser());
    };
    const timer = setTimeout(() => {
      const i = waiting.indexOf(wake);
      if (i >= 0) waiting.splice(i, 1);
      resolve(null);
    }, timeoutMs);
    waiting.push(wake);
  });
}

function releaser(): () => void {
  let released = false;
  return () => {
    if (released) return;
    released = true;
    active -= 1;
    waiting.shift()?.();
  };
}

/** The first batch is already fetched, so pre-stream failures can still be answered cleanly. */
export interface ExportSource<T> {
  total: number;
  first: T[];
  rest: AsyncGenerator<T[], void, void>;
  close: () => Promise<void>;
}

export interface ExportSpec<T> {
  /** File name stem: `bgcs`, `gcfs`, `metagenomes`, … */
  stem: string;
  columns: ExportColumn<T>[];
  /** Why the query cannot be exported (e.g. SQL-only filters), or null. */
  refusal: (params: URLSearchParams) => string | null;
  count: (params: URLSearchParams) => Promise<number>;
  open: (params: URLSearchParams, cap: number) => Promise<ExportSource<T>>;
}

/** Thrown by a spec for a query it refuses with a reason the reader can act on. */
export class ExportRefusedError extends Error {}

export interface ExportCheck {
  ok: boolean;
  total?: number;
  rows?: number;
  capped?: boolean;
  reason?: string;
}

export async function handleExport<T>(request: Request, spec: ExportSpec<T>): Promise<Response> {
  const params = new URL(request.url).searchParams;
  const format = parseExportFormat(params.get('format'));
  const isCheck = params.get('check') === '1';
  // Strip the export's own params, so what is left is exactly the list's query.
  const listParams = new URLSearchParams(params);
  for (const key of ['format', 'check', 'limit', 'offset']) listParams.delete(key);

  if (isCheck) return checkExport(request, spec, listParams, format);

  const failName = `${spec.stem}_export_failed.txt`;
  if (!format) return failure(400, 'Unknown format: use csv, tsv or json.', failName);

  const refused = spec.refusal(listParams);
  if (refused) return failure(409, refused, failName);

  // HEAD: the headers a download would have, and nothing else. Running the export
  // would hold a slot and an index cursor for a body nobody reads, and charge the
  // client an export. No row count either: it would cost an index query.
  if (isHead(request)) {
    return new Response(null, {
      status: 200,
      headers: {
        'Content-Type': EXPORT_MIME[format],
        'Content-Disposition': `attachment; filename="${spec.stem}_export.${format}"`,
        'Cache-Control': 'no-store',
      },
    });
  }

  const limit = await checkRateLimit(exportRateLimit, getClientIp(request));
  if (!limit.success) return failure(429, limit.error ?? 'Too many exports.', failName);

  const release = await acquireSlot();
  if (!release) {
    return failure(503, 'The export queue is full. Please try again in a minute.', failName);
  }

  let source: ExportSource<T>;
  try {
    source = await spec.open(listParams, EXPORT_ROW_CAP);
  } catch (error) {
    release();
    if (error instanceof ExportRefusedError) return failure(409, error.message, failName);
    const refusal = await refusalMessage(error);
    if (refusal) return failure(400, refusal, failName);
    console.error(`[export ${spec.stem}] failed before the first row`, error);
    return failure(500, 'The export failed before any rows were written. Please try again.', failName);
  }

  const rows = Math.min(source.total, EXPORT_ROW_CAP);
  const filename = exportFilename(spec.stem, rows, source.total, format);
  return streamSource(request, source, spec, format, filename, release);
}

async function checkExport<T>(
  request: Request, spec: ExportSpec<T>, params: URLSearchParams, format: ExportFormat | null,
): Promise<Response> {
  const answer = (body: ExportCheck, status = 200) => NextResponse.json(body, { status });
  if (!format) return answer({ ok: false, reason: 'Unknown format: use csv, tsv or json.' }, 400);
  const refused = spec.refusal(params);
  if (refused) return answer({ ok: false, reason: refused });

  try {
    const remaining = await exportRateLimit.getRemaining(getClientIp(request));
    if (remaining.remaining <= 0) {
      const minutes = Math.max(1, Math.ceil((remaining.reset - Date.now()) / 60_000));
      return answer({ ok: false, reason: `Export limit reached (20 an hour). Try again in ${minutes} min.` });
    }
  } catch (error) {
    // The download enforces the limit itself; a check that cannot read it says go.
    console.warn('[export] rate-limit read failed during check', error);
  }

  try {
    const total = await spec.count(params);
    if (total === 0) return answer({ ok: false, total, reason: 'Nothing matches these filters.' });
    const rows = Math.min(total, EXPORT_ROW_CAP);
    return answer({ ok: true, total, rows, capped: rows < total });
  } catch (error) {
    if (error instanceof ExportRefusedError) return answer({ ok: false, reason: error.message });
    const refusal = await refusalMessage(error);
    if (refusal) return answer({ ok: false, reason: refusal }, 400);
    console.error(`[export ${spec.stem}] check failed`, error);
    return answer({ ok: false, reason: 'The export service is unavailable. Please try again.' }, 502);
  }
}

function streamSource<T>(
  request: Request, source: ExportSource<T>, spec: ExportSpec<T>, format: ExportFormat,
  filename: string, release: () => void,
): Response {
  const encoder = new TextEncoder();
  let finished = false;
  const finish = async () => {
    if (finished) return;
    finished = true;
    release();
    await source.close();
  };

  async function* chunks(): AsyncGenerator<string> {
    yield exportPreamble(spec.columns, format);
    let first = true;
    if (source.first.length) {
      yield exportRows(source.first, spec.columns, format, true);
      first = false;
    }
    for await (const batch of source.rest) {
      if (!batch.length) continue;
      yield exportRows(batch, spec.columns, format, first);
      first = false;
    }
    yield exportEpilogue(format);
  }
  const it = chunks();
  // A cancel can land while a pull is awaiting the next batch; that pull must then
  // stop, not enqueue onto the closed stream and report a mid-stream failure.
  let cancelled = false;

  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        // Loop past empty chunks (a CSV has no epilogue): a pull that enqueues
        // nothing is never followed by another, and the download would hang.
        for (;;) {
          const { value, done } = await it.next();
          if (cancelled) return;
          if (done) {
            controller.close();
            await finish();
            return;
          }
          if (value) {
            controller.enqueue(encoder.encode(value));
            return;
          }
        }
      } catch (error) {
        if (cancelled) return;
        console.error(`[export ${spec.stem}] failed mid-stream; aborting the download`, error);
        controller.error(error);
        await finish();
      }
    },
    async cancel() {
      // The reader closed the tab or cancelled the download.
      cancelled = true;
      await it.return(undefined);
      await finish();
    },
  });

  // A client gone before the first byte would otherwise leave the slot taken and
  // the cursor open: Next never reads or cancels a body it cannot send.
  cancelBodyOnAbort(request, body);

  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': EXPORT_MIME[format],
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
      // nginx would otherwise buffer the whole file before sending it.
      'X-Accel-Buffering': 'no',
    },
  });
}

/** An error answered as a downloaded text file, so the page stays where it is. */
function failure(status: number, message: string, filename: string): Response {
  return new Response(`${message}\n`, {
    status,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  });
}

/** The 400s the list routes already give for a filter they refuse, as a sentence. */
async function refusalMessage(error: unknown): Promise<string | null> {
  const response = filterRefusalResponse(error);
  if (!response) return null;
  const body = await response.json() as { message?: string; error?: string };
  return body.message ?? body.error ?? 'This filter cannot be exported.';
}
