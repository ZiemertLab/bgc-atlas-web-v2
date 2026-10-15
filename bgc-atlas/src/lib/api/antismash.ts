import { spawn } from 'child_process';
import { constants } from 'fs';
import { access, mkdir, open, readdir, readFile, rm, stat, utimes, writeFile } from 'fs/promises';
import type { Dirent } from 'fs';
import path from 'path';

import { AntiSmashRunStatus } from '@prisma/client';

import prisma from '@/lib/prisma';

import { findAntismashIndex, rankResultsJsonCandidates } from './antismash-viewer-select';

const toIsoString = (value: Date | string | null | undefined) => {
  if (!value) {
    return new Date().toISOString();
  }
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
};

const FALLBACK_EXTRACTION_ROOT = '/tmp/bgc-antismash';
const EXTRACTION_MARKER_FILE = '.extraction-complete';

export { EXTRACTION_MARKER_FILE as ANTISMASH_EXTRACTION_MARKER_FILE };

/**
 * Records size and file count so the eviction sweep need not walk every tree (an MFD run is
 * ~46k files). Treat the count as a floor: the marker itself and later per-BGC trims are not in it.
 * The mtime means last served (every serve touches it), which makes eviction LRU.
 */
interface ExtractionMarker {
  completedAt: string;
  bytes: number | null;
  files: number | null;
}

export interface ExtractionFootprint {
  bytes: number;
  files: number;
}

/** Size and count of every regular file under `dir`. Follows no symlinks. */
async function measureDirectory(dir: string): Promise<ExtractionFootprint> {
  let total = 0;
  let files = 0;
  const walk = async (current: string): Promise<void> => {
    let entries: Dirent[];
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (entry.isFile()) {
        try {
          total += (await stat(full)).size;
          files += 1;
        } catch {
          // Raced with an eviction; it is in neither total.
        }
      }
    }
  };
  await walk(dir);
  return { bytes: total, files };
}

const resolvePath = (inputPath: string) => (path.isAbsolute(inputPath) ? inputPath : path.resolve(process.cwd(), inputPath));

const ensureReadable = async (inputPath: string) => {
  try {
    await access(inputPath, constants.R_OK);
    return true;
  } catch {
    return false;
  }
};

const runTarExtraction = (archivePath: string, targetDir: string) =>
  new Promise<void>((resolve, reject) => {
    const child = spawn('tar', ['-xzf', archivePath, '-C', targetDir], { stdio: 'ignore' });

    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Failed to extract archive (tar exited with code ${code}).`));
      }
    });
  });

// Read at call time: the sweep's tests point ANTISMASH_TMP_DIR at a scratch directory.
export const getAntismashExtractionRoot = () =>
  resolvePath(process.env.ANTISMASH_TMP_DIR || FALLBACK_EXTRACTION_ROOT);

export const getAntismashRunExtractionDir = (runId: string) => path.join(getAntismashExtractionRoot(), runId);

export const isAntismashRunExtracted = async (runId: string) => {
  const markerPath = path.join(getAntismashRunExtractionDir(runId), EXTRACTION_MARKER_FILE);
  try {
    await access(markerPath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
};

// Results JSON names vary by source; a candidate is confirmed by a top-level `records` key in
// its opening bytes.
const looksLikeResultsJson = async (filePath: string): Promise<boolean> => {
  let handle: Awaited<ReturnType<typeof open>> | null = null;
  try {
    handle = await open(filePath, 'r');
    const buffer = Buffer.alloc(65536);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    const head = buffer.toString('utf8', 0, bytesRead);
    return head.includes('"records"');
  } catch {
    return false;
  } finally {
    await handle?.close();
  }
};

export const findAntismashResultsJsonPath = async (runId: string): Promise<string | null> => {
  const rootDir = getAntismashRunExtractionDir(runId);

  const candidates: string[] = [];
  const queue: Array<{ relative: string; depth: number }> = [{ relative: '', depth: 0 }];
  const maxDepth = 6;

  while (queue.length > 0) {
    const { relative, depth } = queue.shift()!;
    if (depth > maxDepth) {
      continue;
    }

    const dirPath = relative ? path.join(rootDir, relative) : rootDir;
    let entries: Dirent[];
    try {
      entries = await readdir(dirPath, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (entry.name.startsWith('.')) {
        continue;
      }

      const entryRelative = relative ? path.join(relative, entry.name) : entry.name;

      if (entry.isFile() && entry.name.toLowerCase().endsWith('.json')) {
        candidates.push(path.join(rootDir, entryRelative));
      } else if (entry.isDirectory()) {
        queue.push({ relative: entryRelative, depth: depth + 1 });
      }
    }
  }

  if (candidates.length === 0) {
    return null;
  }

  // Real run before the prescreen, then `*_regions.json`, then size (size alone picks the prescreen).
  const withSizes = await Promise.all(
    candidates.map(async (filePath) => {
      let size = 0;
      try {
        size = (await stat(filePath)).size;
      } catch {
        size = 0;
      }
      return { filePath, size };
    }),
  );

  for (const candidate of rankResultsJsonCandidates(withSizes)) {
    if (await looksLikeResultsJson(candidate.filePath)) {
      return candidate.filePath;
    }
  }

  return null;
};

export interface AntismashRunRecord {
  id: string;
  name: string | null;
  file_path: string | null;
  num_bgcs: number;
  pipeline_version: string | null;
  antismash_version: string | null;
  status: AntiSmashRunStatus | null;
  assembly: {
    id: string;
    external_id: string | null;
    name: string | null;
  } | null;
  created_at: string;
  updated_at: string;
  extraction: {
    isExtracted: boolean;
    directory: string | null;
    indexRelativePath: string | null;
    regionsRelativePath: string | null;
  };
  bgcs: Array<{
    id: string;
    anchor: string | null;
    filename: string | null;
    contig: string | null;
    start_pos: number | null;
    end_pos: number | null;
  }>;
}

export async function getAntismashRun(runId: string): Promise<AntismashRunRecord | null> {
  const run = await prisma.antiSmashRun.findUnique({
    where: { id: runId },
    include: {
      assembly: {
        select: {
          id: true,
          external_id: true,
          name: true,
        },
      },
      bgcs: {
        select: {
          id: true,
          anchor: true,
          filename: true,
          contig: true,
          start_pos: true,
          end_pos: true,
        },
      },
    },
  });

  if (!run) {
    return null;
  }

  const bgcCount = typeof run.num_bgcs === 'number' ? run.num_bgcs : run.bgcs.length;
  const extracted = await isAntismashRunExtracted(run.id);
  const extractionDir = extracted ? getAntismashRunExtractionDir(run.id) : null;
  const indexLocation = extracted ? await findAntismashIndex(getAntismashRunExtractionDir(run.id)) : null;

  return {
    id: run.id,
    name: run.name ?? null,
    file_path: run.file_path ?? null,
    num_bgcs: bgcCount,
    pipeline_version: run.pipeline_version ?? null,
    antismash_version: run.antismash_version ?? null,
    status: run.status,
    assembly: run.assembly
      ? {
        id: run.assembly.id,
        external_id: run.assembly.external_id ?? null,
        name: run.assembly.name ?? null,
      }
      : null,
    created_at: toIsoString(run.created_at),
    updated_at: toIsoString(run.updated_at),
    extraction: {
      isExtracted: extracted,
      directory: extractionDir,
      indexRelativePath: indexLocation?.relativeIndexPath ?? null,
      regionsRelativePath: indexLocation?.relativeRegionsPath ?? null,
    },
    bgcs: run.bgcs.map((bgc) => ({
      id: bgc.id,
      anchor: bgc.anchor ?? null,
      filename: bgc.filename ?? null,
      contig: bgc.contig ?? null,
      start_pos: bgc.start_pos ?? null,
      end_pos: bgc.end_pos ?? null,
    })),
  };
}

export type AntismashExtractionStatus = 'ready' | 'missing-file' | 'error';

export interface AntismashExtractionResult {
  status: AntismashExtractionStatus;
  extractedPath?: string;
  alreadyExisted?: boolean;
  message?: string;
  indexRelativePath?: string | null;
  regionsRelativePath?: string | null;
}

// Dedups concurrent extractions of one run (two `rm`/`tar` into one dir race with ENOTEMPTY).
// In-process is enough: the server is a single pm2 fork_mode process.
const inflightExtractions = new Map<string, Promise<AntismashExtractionResult>>();

// Large extractions take minutes on CephFS, so clients start one and poll. State falls back to
// the on-disk marker so a restart mid-poll still reports `ready`.
export type AntismashExtractionPhase = 'extracting' | 'ready' | 'missing-file' | 'error';

export interface AntismashExtractionState {
  status: AntismashExtractionPhase;
  startedAt: number;
  elapsedMs: number;
  archiveBytes: number | null;
  message?: string;
  indexRelativePath?: string | null;
  regionsRelativePath?: string | null;
}

const extractionStates = new Map<string, AntismashExtractionState>();

// Returns immediately and never throws; failures are reported through the polled state.
export async function startAntismashRunExtraction(
  run: AntismashRunRecord
): Promise<AntismashExtractionState> {
  const known = await getAntismashExtractionState(run.id);
  if (known && known.status !== 'error') {
    return known;
  }

  let archiveBytes: number | null = null;
  if (run.file_path) {
    try {
      archiveBytes = (await stat(resolvePath(run.file_path))).size;
    } catch {
      archiveBytes = null;
    }
  }

  const state: AntismashExtractionState = {
    status: 'extracting',
    startedAt: Date.now(),
    elapsedMs: 0,
    archiveBytes,
  };
  extractionStates.set(run.id, state);

  // deliberately not awaited — the request returns while this continues
  void ensureAntismashRunExtraction(run)
    .then((result) => {
      extractionStates.set(run.id, {
        ...state,
        status: result.status === 'ready' ? 'ready' : result.status,
        elapsedMs: Date.now() - state.startedAt,
        message: result.message,
        indexRelativePath: result.indexRelativePath ?? null,
        regionsRelativePath: result.regionsRelativePath ?? null,
      });
    })
    .catch((error: unknown) => {
      extractionStates.set(run.id, {
        ...state,
        status: 'error',
        elapsedMs: Date.now() - state.startedAt,
        message: error instanceof Error ? error.message : 'Extraction failed.',
      });
    });

  return state;
}

// Prefers the on-disk marker so results survive a server restart.
export async function getAntismashExtractionState(
  runId: string
): Promise<AntismashExtractionState | null> {
  if (await isAntismashRunExtracted(runId)) {
    const indexLocation = await findAntismashIndex(getAntismashRunExtractionDir(runId));
    if (indexLocation) {
      const tracked = extractionStates.get(runId);
      return {
        status: 'ready',
        startedAt: tracked?.startedAt ?? Date.now(),
        elapsedMs: tracked ? Date.now() - tracked.startedAt : 0,
        archiveBytes: tracked?.archiveBytes ?? null,
        indexRelativePath: indexLocation.relativeIndexPath,
        regionsRelativePath: indexLocation.relativeRegionsPath,
      };
    }
  }

  const tracked = extractionStates.get(runId);
  if (!tracked) {
    return null;
  }
  return { ...tracked, elapsedMs: Date.now() - tracked.startedAt };
}

// The sweep must not reap an unmarked directory that tar is still writing into.
export function isAntismashExtractionInFlight(runId: string): boolean {
  return inflightExtractions.has(runId);
}

// Fire-and-forget: a failed touch only costs LRU position and must never delay serving.
export function touchAntismashRunExtraction(runId: string): void {
  const markerPath = path.join(getAntismashRunExtractionDir(runId), EXTRACTION_MARKER_FILE);
  const now = new Date();
  void utimes(markerPath, now, now).catch(() => {
    // Not extracted, or already evicted. Nothing to keep alive.
  });
}

// Null unless both size and file count are recorded (older markers lack one); the caller re-walks.
export async function readAntismashExtractionFootprint(
  runId: string,
): Promise<ExtractionFootprint | null> {
  const markerPath = path.join(getAntismashRunExtractionDir(runId), EXTRACTION_MARKER_FILE);
  try {
    const raw = await readFile(markerPath, 'utf8');
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    const { bytes, files } = parsed as ExtractionMarker;
    if (typeof bytes !== 'number' || !Number.isFinite(bytes)) return null;
    if (typeof files !== 'number' || !Number.isFinite(files)) return null;
    return { bytes, files };
  } catch {
    return null;
  }
}

// Writes a measured footprint into a legacy marker so sweeps stop re-walking it. The mtime
// (last served) is preserved across the rewrite.
export async function upgradeAntismashExtractionMarker(
  runId: string,
): Promise<ExtractionFootprint> {
  const footprint = await measureDirectory(getAntismashRunExtractionDir(runId));
  const markerPath = path.join(getAntismashRunExtractionDir(runId), EXTRACTION_MARKER_FILE);
  try {
    const { mtime, atime } = await stat(markerPath);
    const marker: ExtractionMarker = {
      completedAt: mtime.toISOString(),
      bytes: footprint.bytes,
      files: footprint.files,
    };
    await writeFile(markerPath, JSON.stringify(marker), 'utf8');
    await utimes(markerPath, atime, mtime);
  } catch {
    // Keep the measurement; the upgrade is an optimisation, not the answer.
  }
  return footprint;
}

export function ensureAntismashRunExtraction(run: AntismashRunRecord): Promise<AntismashExtractionResult> {
  const existing = inflightExtractions.get(run.id);
  if (existing) {
    return existing;
  }

  const promise = extractAntismashRun(run).finally(() => {
    inflightExtractions.delete(run.id);
  });
  inflightExtractions.set(run.id, promise);
  return promise;
}

async function extractAntismashRun(run: AntismashRunRecord): Promise<AntismashExtractionResult> {
  if (!run.file_path) {
    return {
      status: 'missing-file',
      message: 'No archive file path is associated with this antiSMASH run.',
    };
  }

  const archivePath = resolvePath(run.file_path);
  const isReadable = await ensureReadable(archivePath);

  if (!isReadable) {
    return {
      status: 'missing-file',
      message: `Archive not found or unreadable at ${archivePath}.`,
    };
  }

  const extractionRoot = getAntismashExtractionRoot();
  const targetDir = getAntismashRunExtractionDir(run.id);
  const markerPath = path.join(targetDir, EXTRACTION_MARKER_FILE);

  await mkdir(extractionRoot, { recursive: true });

  if (await isAntismashRunExtracted(run.id)) {
    const indexLocation = await findAntismashIndex(getAntismashRunExtractionDir(run.id));

    if (!indexLocation) {
      return {
        status: 'error',
        message: 'antiSMASH index.html not found in extracted directory.',
      };
    }

    return {
      status: 'ready',
      extractedPath: targetDir,
      alreadyExisted: true,
      indexRelativePath: indexLocation.relativeIndexPath,
      regionsRelativePath: indexLocation.relativeRegionsPath,
    };
  }

  try {
    await rm(targetDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    await mkdir(targetDir, { recursive: true });

    await runTarExtraction(archivePath, targetDir);
    // Measure before the marker exists, so a sweep in between sees an unmarked directory.
    const footprint = await measureDirectory(targetDir);
    const marker: ExtractionMarker = {
      completedAt: new Date().toISOString(),
      bytes: footprint.bytes,
      files: footprint.files,
    };
    await writeFile(markerPath, JSON.stringify(marker), 'utf8');

    const indexLocation = await findAntismashIndex(getAntismashRunExtractionDir(run.id));

    if (!indexLocation) {
      return {
        status: 'error',
        message: 'antiSMASH index.html not found in extracted directory.',
      };
    }

    return {
      status: 'ready',
      extractedPath: targetDir,
      alreadyExisted: false,
      indexRelativePath: indexLocation.relativeIndexPath,
      regionsRelativePath: indexLocation.relativeRegionsPath,
    };
  } catch (error) {
    await rm(targetDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });

    return {
      status: 'error',
      message: error instanceof Error ? error.message : 'Extraction failed due to an unknown error.',
    };
  }
}
