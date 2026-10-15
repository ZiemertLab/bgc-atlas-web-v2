import { NextResponse } from 'next/server';
import redis from '@/lib/redis-client';

/**
 * The site-wide maintenance notice, switched at runtime so announcing a data
 * operation needs neither a build nor a restart:
 *
 *   redis-cli SET site:notice "Maintenance in progress. Some data may be temporarily inconsistent."
 *   redis-cli DEL site:notice
 *
 * Every page load asks, so the Redis read is memoised per process; a change
 * reaches readers within NOTICE_TTL_MS. An unreachable Redis means no notice,
 * never a broken page.
 */
const NOTICE_KEY = 'site:notice';
const NOTICE_TTL_MS = 15_000;

let cached: { message: string | null; at: number } | null = null;

export const dynamic = 'force-dynamic';

export async function GET() {
  if (!cached || Date.now() - cached.at > NOTICE_TTL_MS) {
    let message: string | null = null;
    try {
      message = (await redis.get(NOTICE_KEY))?.trim() || null;
    } catch {
      message = null;
    }
    cached = { message, at: Date.now() };
  }

  return NextResponse.json(
    { message: cached.message },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
