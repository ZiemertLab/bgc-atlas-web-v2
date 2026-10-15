import { spawn } from 'child_process';
import { constants, createReadStream } from 'fs';
import { access } from 'fs/promises';
import path from 'path';
import type { Readable } from 'stream';

import { NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';

import prisma from '@/lib/prisma';
import {
  findAntismashResultsJsonPath,
  getAntismashRun,
  getAntismashRunExtractionDir,
  startAntismashRunExtraction,
  touchAntismashRunExtraction,
} from '@/lib/api/antismash';
import { antismashFailureMessage, serverError } from '@/lib/api/errors';

const isReadable = async (filePath: string) => {
  try {
    await access(filePath, constants.R_OK);
    return true;
  } catch {
    return false;
  }
};

interface RegionTrimResult {
  recordId?: string;
  regionNumber?: string | null;
}

/**
 * Trim the results JSON to one region in a Python subprocess, so the large
 * parse never spikes this server's heap.
 */
// Needs `ijson`, which only the project miniforge python has, not the system
// python3 on pm2's PATH.
const ANTISMASH_PYTHON =
  process.env.ANTISMASH_PYTHON || '/data/bgc-atlas/miniforge3/bin/python3';

function runRegionTrim(
  jsonPath: string,
  recordId: string | null,
  regionNumber: number | null,
  outPath: string,
): Promise<RegionTrimResult> {
  return new Promise((resolve, reject) => {
    const scriptPath = path.join(process.cwd(), '..', 'scripts', 'trim_antismash_region.py');
    const child = spawn(ANTISMASH_PYTHON, [
      scriptPath,
      '--json-path', jsonPath,
      '--record-id', recordId ?? '',
      '--region-number', String(regionNumber ?? 0),
      '--out-path', outPath,
    ], { stdio: ['ignore', 'pipe', 'pipe'] });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) {
        try {
          const lastLine = stdout.trim().split('\n').pop() || '{}';
          resolve(JSON.parse(lastLine) as RegionTrimResult);
        } catch {
          resolve({});
        }
      } else {
        reject(new Error(`trim_antismash_region.py exited ${code}: ${stderr.slice(0, 500)}`));
      }
    });
  });
}

const isValidUuid = (id: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);

type TrimPhase = 'trimming' | 'ready' | 'error';

interface TrimState {
  status: TrimPhase;
  startedAt: number;
  recordId?: string | null;
  regionNumber?: string | null;
  message?: string;
}

/**
 * Region trims run in the background and clients poll: a deep assembly's
 * results JSON is tens of GB and takes minutes. In-process state (pm2
 * fork_mode); the trimmed file on disk is the durable record.
 */
const trimStates = new Map<string, TrimState>();

function startRegionTrim(
  bgcId: string,
  jsonPath: string,
  recordId: string | null,
  regionNumber: number | null,
  outPath: string,
): TrimState {
  const existing = trimStates.get(bgcId);
  if (existing && existing.status === 'trimming') {
    return existing;
  }

  const state: TrimState = { status: 'trimming', startedAt: Date.now() };
  trimStates.set(bgcId, state);

  void runRegionTrim(jsonPath, recordId, regionNumber, outPath)
    .then((result) => {
      trimStates.set(bgcId, {
        ...state,
        status: 'ready',
        recordId: result.recordId ?? null,
        regionNumber: result.regionNumber ?? null,
      });
    })
    .catch((error: unknown) => {
      trimStates.set(bgcId, {
        ...state,
        status: 'error',
        message: error instanceof Error ? error.message : 'Failed to prepare region data.',
      });
    });

  return state;
}

function preparing(stage: 'extracting' | 'trimming', startedAt: number) {
  return NextResponse.json(
    {
      success: true,
      status: 'preparing',
      stage,
      elapsedMs: Date.now() - startedAt,
    },
    { status: 202, headers: { 'Cache-Control': 'no-store' } },
  );
}

/** Anchors are `r<record>c<region>`; the viewer focuses by the `c<region>` number. */
const parseRegionNumber = (anchor: string | null): number | null => {
  if (!anchor) return null;
  const match = /c(\d+)\s*$/i.exec(anchor);
  if (!match) return null;
  const n = Number.parseInt(match[1], 10);
  return Number.isFinite(n) ? n : null;
};

/**
 * Node-to-web stream with backpressure; guards controller calls so a client
 * disconnect can't throw "Controller is already closed".
 */
function nodeToWebStream(nodeStream: Readable): ReadableStream<Uint8Array> {
  let closed = false;
  return new ReadableStream<Uint8Array>({
    start(controller) {
      nodeStream.on('data', (chunk: Buffer) => {
        if (closed) return;
        controller.enqueue(new Uint8Array(chunk));
        if (controller.desiredSize !== null && controller.desiredSize <= 0) {
          nodeStream.pause();
        }
      });
      nodeStream.on('end', () => {
        if (closed) return;
        closed = true;
        try { controller.close(); } catch { /* already closed */ }
      });
      nodeStream.on('error', (err) => {
        if (closed) return;
        closed = true;
        try { controller.error(err); } catch { /* already errored */ }
      });
    },
    pull() {
      nodeStream.resume();
    },
    cancel() {
      closed = true;
      nodeStream.destroy();
    },
  });
}

interface RouteParams {
  params: Promise<{ id?: string }>;
}

/**
 * Serve the BGC's single antiSMASH region as JSON for the bgc-viewer, trimmed
 * once from the full results JSON and cached on disk in the extraction directory.
 *
 * Responses:
 *   200  the trimmed region JSON, streamed from disk
 *   202  {status:'preparing', stage} — work started, poll this endpoint again
 */
export async function GET(_request: Request, { params }: RouteParams) {
  try {
    const { id: bgcId } = await params;

    if (!bgcId || !isValidUuid(bgcId)) {
      return NextResponse.json(
        { success: false, error: 'Invalid BGC ID' },
        { status: 400 },
      );
    }

    const rows = await prisma.$queryRaw<Array<{
      antismash_run_id: string | null;
      contig: string | null;
      anchor: string | null;
    }>>(Prisma.sql`
      SELECT antismash_run_id, contig, anchor
      FROM bgcs
      WHERE id = ${bgcId}::uuid
    `);

    if (rows.length === 0) {
      return NextResponse.json(
        { success: false, error: 'BGC not found' },
        { status: 404 },
      );
    }

    const { antismash_run_id: runId, contig, anchor } = rows[0];

    if (!runId) {
      return NextResponse.json(
        { success: false, error: 'BGC has no associated antiSMASH run' },
        { status: 404 },
      );
    }

    const run = await getAntismashRun(runId);
    if (!run) {
      return NextResponse.json(
        { success: false, error: 'antiSMASH run not found' },
        { status: 404 },
      );
    }

    const regionNumber = parseRegionNumber(anchor);
    // The extraction directory derives from the run id, so a cached trim is
    // served without starting an extraction.
    const trimmedPath = path.join(getAntismashRunExtractionDir(runId), `.bgc-region-${bgcId}.json`);
    const trimState = trimStates.get(bgcId);

    let resolvedRecordId = contig;
    let resolvedRegionNumber: string | null = regionNumber != null ? String(regionNumber) : null;
    if (trimState?.status === 'ready') {
      if (trimState.recordId) resolvedRecordId = trimState.recordId;
      if (trimState.regionNumber != null) resolvedRegionNumber = trimState.regionNumber;
    }

    if (!(await isReadable(trimmedPath))) {
      if (trimState?.status === 'error') {
        trimStates.delete(bgcId);
        return NextResponse.json(
          { success: false, error: antismashFailureMessage('error', trimState.message, `antiSMASH region trim for ${bgcId}`) },
          { status: 500 },
        );
      }
      if (trimState?.status === 'trimming') {
        return preparing('trimming', trimState.startedAt);
      }

      const extraction = await startAntismashRunExtraction(run);
      if (extraction.status === 'missing-file') {
        return NextResponse.json(
          { success: false, error: antismashFailureMessage('missing-file', extraction.message, `antiSMASH extraction for ${bgcId}`) },
          { status: 404 },
        );
      }
      if (extraction.status === 'error') {
        return NextResponse.json(
          { success: false, error: antismashFailureMessage('error', extraction.message, `antiSMASH extraction for ${bgcId}`) },
          { status: 500 },
        );
      }
      if (extraction.status !== 'ready') {
        return preparing('extracting', extraction.startedAt);
      }

      const jsonPath = await findAntismashResultsJsonPath(runId);
      if (!jsonPath) {
        return NextResponse.json(
          { success: false, error: 'antiSMASH results JSON not found in archive' },
          { status: 404 },
        );
      }

      const started = startRegionTrim(bgcId, jsonPath, contig, regionNumber, trimmedPath);
      if (started.status === 'error') {
        trimStates.delete(bgcId);
        return NextResponse.json(
          { success: false, error: antismashFailureMessage('error', started.message, `antiSMASH region trim for ${bgcId}`) },
          { status: 500 },
        );
      }
      return preparing('trimming', started.startedAt);
    }

    const headers = new Headers({
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'public, s-maxage=86400, stale-while-revalidate=604800',
    });
    if (resolvedRecordId) headers.set('X-Record-Id', resolvedRecordId);
    if (resolvedRegionNumber != null) headers.set('X-Region-Number', resolvedRegionNumber);

    // Eviction ages runs from last use.
    touchAntismashRunExtraction(runId);

    const nodeStream = createReadStream(trimmedPath);
    return new Response(nodeToWebStream(nodeStream), { status: 200, headers });
  } catch (error) {
    return serverError(error, 'Error serving antiSMASH JSON');
  }
}
