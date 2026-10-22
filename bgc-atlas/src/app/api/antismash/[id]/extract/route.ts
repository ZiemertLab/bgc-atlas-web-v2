import { NextResponse } from 'next/server';

import {
  antismashExtractionLineFull,
  antismashExtractionWouldStart,
  getAntismashExtractionState,
  getAntismashRun,
  startAntismashRunExtraction,
  type AntismashExtractionState,
} from '@/lib/api/antismash';
import { antismashFailureMessage } from '@/lib/api/errors';
import { chargeViewerWork } from '@/lib/api/antismash-viewer-limit';

// Extraction takes minutes: POST starts (or joins) it and returns at once; clients poll GET.

const failed = (state: AntismashExtractionState) => state.status === 'error' || state.status === 'missing-file';

const serialise = (state: AntismashExtractionState, runId: string) => ({
  success: !failed(state),
  status: state.status,
  elapsedMs: state.elapsedMs,
  archiveBytes: state.archiveBytes,
  // A full line is the reader's to see; any other failure is logged and summarised.
  message: state.busy
    ? state.message ?? null
    : failed(state)
      ? antismashFailureMessage(state.status, state.message, `antiSMASH extraction of run ${runId}`)
      : state.message ?? null,
  indexRelativePath: state.indexRelativePath ?? null,
  regionsRelativePath: state.regionsRelativePath ?? null,
});

const statusCodeFor = (state: AntismashExtractionState) => {
  if (state.busy) return 503;
  if (state.status === 'missing-file') return 404;
  if (state.status === 'error') return 500;
  return 200;
};

const resolveRunId = async (params: Promise<{ id?: string }>) => {
  const { id } = await params;
  return typeof id === 'string' && id ? id : null;
};

const invalidId = () =>
  NextResponse.json(
    { success: false, error: 'Invalid antismash run id', message: 'A valid antiSMASH run id must be provided.' },
    { status: 400 }
  );

const notFound = () =>
  NextResponse.json(
    { success: false, error: 'Run not found', message: 'No antiSMASH run exists with the provided id.' },
    { status: 404 }
  );

export async function POST(request: Request, { params }: { params: Promise<{ id?: string }> }) {
  const runId = await resolveRunId(params);
  if (!runId) return invalidId();

  const run = await getAntismashRun(runId);
  if (!run) return notFound();

  // Starting an unpack is charged to the caller; joining one is not.
  // A full line answers below without charging (startAntismashRunExtraction
  // returns the refusal synchronously).
  if (await antismashExtractionWouldStart(runId) && !antismashExtractionLineFull()) {
    const limited = await chargeViewerWork(request);
    if (limited) return limited;
  }
  const state = await startAntismashRunExtraction(run);
  return NextResponse.json(serialise(state, runId), { status: statusCodeFor(state) });
}

export async function GET(_request: Request, { params }: { params: Promise<{ id?: string }> }) {
  const runId = await resolveRunId(params);
  if (!runId) return invalidId();

  const state = await getAntismashExtractionState(runId);
  if (!state) {
    return NextResponse.json({ success: true, status: 'idle', message: null }, { status: 200 });
  }

  return NextResponse.json(serialise(state, runId), { status: statusCodeFor(state) });
}
