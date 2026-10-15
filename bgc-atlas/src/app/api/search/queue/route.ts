import { NextResponse } from 'next/server';
import { getQueueStatus } from '@/lib/queue';
import { serverError } from '@/lib/api/errors';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    // `jobs` includes submitters' session ids; this endpoint is public, so serve counts only.
    const { jobs: _jobs, ...counts } = await getQueueStatus();

    return NextResponse.json({
      success: true,
      data: counts,
    });
  } catch (error) {
    return serverError(error, 'Error fetching queue stats');
  }
}
