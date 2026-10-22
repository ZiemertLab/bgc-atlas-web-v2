import { NextResponse } from 'next/server';
import { getQueueStatus } from '@/lib/queue';
import { serverError } from '@/lib/api/errors';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    // `jobs` includes submitters' session ids; this endpoint is public, so serve counts only.
    // Searches only, and "Completed" includes the previous site's (v1) searches:
    // this strip is the search page's queue, not an overview of every queue.
    const status = await getQueueStatus();

    return NextResponse.json({
      success: true,
      data: {
        waiting: status.searches.waiting,
        active: status.searches.active,
        completed: status.completed + status.v1Completed,
      },
    });
  } catch (error) {
    return serverError(error, 'Error fetching queue stats');
  }
}
