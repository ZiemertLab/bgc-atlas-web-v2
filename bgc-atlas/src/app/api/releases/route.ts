import { NextResponse } from 'next/server';

import { readReleases } from '@/lib/releases/read';

/**
 * The data releases: which one /downloads serves, its files and counts, and the earlier ones. Read by the
 * Downloads page and the footer. Memoised per process (lib/releases/read.ts), so a new release shows up
 * within five minutes of being cut, with no build.
 */
export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json(await readReleases(), {
    headers: { 'Cache-Control': 'public, max-age=60' },
  });
}
