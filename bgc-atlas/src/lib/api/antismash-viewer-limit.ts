import { NextResponse } from 'next/server';

import { getClientIp } from '@/lib/client-ip';
import { checkRateLimit, viewerRateLimit } from '@/lib/rate-limit';

/**
 * Charge the caller's viewer budget for work this request is about to START (an
 * archive unpack or a region trim). null when allowed; otherwise the 429 to send.
 *
 * The body carries both `error` (read by the region viewer) and `status`/`message`
 * (read by the extraction-status poller), so each client shows the sentence.
 */
export async function chargeViewerWork(request: Request): Promise<NextResponse | null> {
  const result = await checkRateLimit(viewerRateLimit, getClientIp(request));
  if (result.success) return null;
  const message = `You have opened many new antiSMASH regions in a short time. ${result.error ?? ''}`.trim();
  return NextResponse.json(
    { success: false, status: 'error', error: message, message },
    {
      status: 429,
      headers: {
        'Retry-After': String(Math.max(1, Math.ceil((result.reset - Date.now()) / 1000))),
        'Cache-Control': 'no-store',
      },
    },
  );
}

/** The 503 for a full preparation line, in the same two-field shape. */
export function viewerBusyResponse(message: string): NextResponse {
  return NextResponse.json(
    { success: false, status: 'error', error: message, message },
    { status: 503, headers: { 'Retry-After': '60', 'Cache-Control': 'no-store' } },
  );
}
