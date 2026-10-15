import { NextResponse } from 'next/server';

import { getAntismashRun } from '@/lib/api/antismash';
import { serverError } from '@/lib/api/errors';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id?: string }> }
) {
  const { id: runId } = await params;

  if (!runId || typeof runId !== 'string') {
    return NextResponse.json(
      {
        success: false,
        error: 'Invalid antismash run id',
        message: 'A valid antiSMASH run id must be provided.',
      },
      { status: 400 }
    );
  }

  try {
    const run = await getAntismashRun(runId);

    if (!run) {
      return NextResponse.json(
        {
          success: false,
          error: 'Run not found',
          message: 'No antiSMASH run exists with the provided id.',
        },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      data: run,
    });
  } catch (error) {
    return serverError(error, 'Failed to load antiSMASH run');
  }
}
