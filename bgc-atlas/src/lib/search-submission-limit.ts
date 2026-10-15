import { NextRequest, NextResponse } from 'next/server';
import {
  checkRateLimit,
  refundRateLimit,
  searchAttemptRateLimit,
  searchRateLimit,
} from '@/lib/rate-limit';

/**
 * The rate limits on the two search submit routes (sequence and BiG-SLiCE),
 * which share one budget.
 *
 * Two limiters, checked in this order:
 *  - searchAttempt (60/hour) counts every request, so a client that only ever
 *    sends rejected files is still bounded;
 *  - search (10/hour) counts searches that were queued. It is charged here and
 *    handed back by refundSearchSubmission unless the route queues a job.
 *
 * Usage:
 *   const limited = await chargeSearchSubmission(request, clientIp);
 *   if (limited) return limited;
 *   let queued = false;
 *   try { ...; await addSearchJob(...); queued = true; ... }
 *   finally { if (!queued) await refundSearchSubmission(clientIp); }
 */

/** Returns the 429 to send, or null when the request may go ahead (and has been charged). */
export async function chargeSearchSubmission(
  _request: NextRequest,
  clientIp: string,
): Promise<NextResponse<{ success: false; error?: string }> | null> {
  // The attempt limit goes first: a request it turns away must not also
  // charge (and then never refund) a search slot.
  const attempt = await checkRateLimit(searchAttemptRateLimit, clientIp);
  const result = attempt.success
    ? await checkRateLimit(searchRateLimit, clientIp)
    : attempt;
  if (result.success) return null;

  return NextResponse.json({
    success: false,
    error: result.error,
  }, {
    status: 429,
    headers: {
      'Retry-After': String(Math.ceil((result.reset - Date.now()) / 1000)),
      'X-RateLimit-Limit': String(result.limit),
      'X-RateLimit-Remaining': String(result.remaining),
      'X-RateLimit-Reset': new Date(result.reset).toISOString(),
    },
  });
}

/** Hand back the search slot of a request that queued no job. */
export async function refundSearchSubmission(clientIp: string): Promise<void> {
  await refundRateLimit(searchRateLimit, clientIp);
}
