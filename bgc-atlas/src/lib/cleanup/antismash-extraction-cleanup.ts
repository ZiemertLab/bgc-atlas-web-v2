import { readdir, rm, stat } from 'fs/promises';
import path from 'path';

import {
  getAntismashExtractionRoot,
  getAntismashRunExtractionDir,
  isAntismashExtractionInFlight,
  isAntismashRunExtracted,
  readAntismashExtractionFootprint,
  upgradeAntismashExtractionMarker,
  ANTISMASH_EXTRACTION_MARKER_FILE,
} from '@/lib/api/antismash';

// Bounds the antiSMASH extraction cache in ANTISMASH_TMP_DIR (an MFD run extracts to ~4.4 GB across
// ~46k files). File count has its own bound: a share with a large inode count fails its backups,
// and a cache under any byte cap can still hold millions of files.

export interface ExtractionEntry {
  runId: string;
  bytes: number;
  /** Regular files under the run. 0 when not measured yet -- see `unsized`. */
  files: number;
  /** Epoch ms of the last successful serve (marker mtime), not the extraction. */
  lastServedMs: number;
  complete: boolean;
  inFlight: boolean;
}

export interface EvictionPolicy {
  ttlMs: number;
  maxBytes: number;
  maxFiles: number;
  /** How long an unmarked directory may sit before it counts as a crashed partial. */
  incompleteGraceMs: number;
  now: number;
}

export const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;
export const DEFAULT_MAX_BYTES = 4 * 1024 * 1024 * 1024;
// Keeps one MFD run (~46k files) to ~9% of the budget; lower thrashes the slowest extractions.
export const DEFAULT_MAX_FILES = 500_000;
export const DEFAULT_INCOMPLETE_GRACE_MS = 6 * 60 * 60 * 1000;

// Report-only unless ANTISMASH_CACHE_MAX_BYTES or ANTISMASH_CACHE_TTL_HOURS is set: the defaults
// assume a small /tmp cache and would wipe a large shared one.
const isEnforcementConfigured = () =>
  Boolean(
    process.env.ANTISMASH_CACHE_MAX_BYTES ||
      process.env.ANTISMASH_CACHE_TTL_HOURS ||
      process.env.ANTISMASH_CACHE_MAX_FILES,
  );

/**
 * Least-recently-served first. Never an in-flight extraction (the ENOTEMPTY race); an unmarked
 * directory past `incompleteGraceMs` is a crash partial; anything unserved within `ttlMs` goes;
 * then evict until both `maxBytes` and `maxFiles` fit. Never the most recently served, even if it
 * alone exceeds the cap, or the next view pays to re-extract it.
 */
export function selectEvictions(entries: ExtractionEntry[], policy: EvictionPolicy): string[] {
  const { ttlMs, maxBytes, maxFiles, incompleteGraceMs, now } = policy;

  const evictions: string[] = [];
  const survivors: ExtractionEntry[] = [];

  for (const entry of entries) {
    if (entry.inFlight) {
      continue;
    }
    const age = now - entry.lastServedMs;
    if (!entry.complete) {
      if (age > incompleteGraceMs) evictions.push(entry.runId);
      continue;
    }
    if (age > ttlMs) {
      evictions.push(entry.runId);
      continue;
    }
    survivors.push(entry);
  }

  survivors.sort((a, b) => a.lastServedMs - b.lastServedMs);

  let totalBytes = survivors.reduce((sum, entry) => sum + entry.bytes, 0);
  let totalFiles = survivors.reduce((sum, entry) => sum + entry.files, 0);
  // The last element is the most recently served -- exempt, so stop before it.
  for (
    let i = 0;
    i < survivors.length - 1 && (totalBytes > maxBytes || totalFiles > maxFiles);
    i += 1
  ) {
    evictions.push(survivors[i].runId);
    totalBytes -= survivors[i].bytes;
    totalFiles -= survivors[i].files;
  }

  return evictions;
}

const isValidUuid = (id: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);

// Walking a run on CephFS is expensive, so legacy-marker backfill is amortised across passes.
const MAX_LEGACY_MEASURES_PER_PASS = 20;

async function readExtractionEntries(): Promise<ExtractionEntry[]> {
  const root = getAntismashExtractionRoot();
  let measured = 0;

  let dirents;
  try {
    dirents = await readdir(root, { withFileTypes: true });
  } catch {
    // No cache directory yet is the normal state on a fresh install.
    return [];
  }

  const entries: ExtractionEntry[] = [];
  for (const dirent of dirents) {
    // Only uuid-named run directories: this module does not delete what it did not create.
    if (!dirent.isDirectory() || !isValidUuid(dirent.name)) continue;

    const runId = dirent.name;
    const dir = getAntismashRunExtractionDir(runId);
    const complete = await isAntismashRunExtracted(runId);

    let lastServedMs: number;
    try {
      const target = complete ? path.join(dir, ANTISMASH_EXTRACTION_MARKER_FILE) : dir;
      lastServedMs = (await stat(target)).mtimeMs;
    } catch {
      continue;
    }

    let bytes = 0;
    let files = 0;
    if (complete) {
      const recorded = await readAntismashExtractionFootprint(runId);
      if (recorded !== null) {
        ({ bytes, files } = recorded);
      } else if (measured < MAX_LEGACY_MEASURES_PER_PASS) {
        // Legacy marker: measure and write back so later passes need not walk it.
        measured += 1;
        ({ bytes, files } = await upgradeAntismashExtractionMarker(runId));
      }
      // Over the per-pass budget: left at 0/0, which can only under-evict; TTL still applies.
    }

    entries.push({
      runId,
      bytes,
      files,
      lastServedMs,
      complete,
      inFlight: isAntismashExtractionInFlight(runId),
    });
  }

  return entries;
}

export interface CleanupResult {
  scanned: number;
  evicted: number;
  bytesReclaimed: number;
  failed: number;
  errors: string[];
  /** Size before eviction, over sized runs only: far below the truth while `unsized` is high. */
  bytesTotal: number;
  /** Total files across runs whose footprint is known. */
  filesTotal: number;
  /** Files reclaimed by this pass, over evicted runs with a known footprint. */
  filesReclaimed: number;
  /** Runs contributing a real figure to `bytesTotal` / `filesTotal`. */
  sized: number;
  /** Runs counted as zero because their size is not recorded yet. */
  unsized: number;
  /** False when no bound was configured: `evicted` is then what WOULD have gone. */
  enforced: boolean;
}

export async function cleanupAntismashExtractions(
  overrides: Partial<Omit<EvictionPolicy, 'now'>> = {},
): Promise<CleanupResult> {
  const policy: EvictionPolicy = {
    ttlMs: overrides.ttlMs ?? readEnvHours('ANTISMASH_CACHE_TTL_HOURS', DEFAULT_TTL_MS),
    maxBytes: overrides.maxBytes ?? readEnvBytes('ANTISMASH_CACHE_MAX_BYTES', DEFAULT_MAX_BYTES),
    maxFiles: overrides.maxFiles ?? readEnvCount('ANTISMASH_CACHE_MAX_FILES', DEFAULT_MAX_FILES),
    incompleteGraceMs: overrides.incompleteGraceMs ?? DEFAULT_INCOMPLETE_GRACE_MS,
    now: Date.now(),
  };

  const entries = await readExtractionEntries();
  const byId = new Map(entries.map((entry) => [entry.runId, entry]));
  const doomed = selectEvictions(entries, policy);
  const bytesTotal = entries.reduce((sum, entry) => sum + entry.bytes, 0);
  const filesTotal = entries.reduce((sum, entry) => sum + entry.files, 0);
  const sized = entries.filter((entry) => entry.files > 0 || entry.bytes > 0).length;
  const unsized = entries.length - sized;

  // An explicit override from a caller counts as configuration; bare defaults do not.
  const enforced =
    overrides.maxBytes !== undefined ||
    overrides.ttlMs !== undefined ||
    overrides.maxFiles !== undefined ||
    isEnforcementConfigured();

  if (!enforced) {
    return {
      scanned: entries.length,
      evicted: doomed.length,
      bytesReclaimed: doomed.reduce((sum, runId) => sum + (byId.get(runId)?.bytes ?? 0), 0),
      failed: 0,
      errors: [],
      bytesTotal,
      filesTotal,
      filesReclaimed: doomed.reduce((sum, runId) => sum + (byId.get(runId)?.files ?? 0), 0),
      sized,
      unsized,
      enforced: false,
    };
  }

  let evicted = 0;
  let bytesReclaimed = 0;
  let filesReclaimed = 0;
  let failed = 0;
  const errors: string[] = [];

  for (const runId of doomed) {
    // Re-check: a request may have started extracting this run since the listing.
    if (isAntismashExtractionInFlight(runId)) continue;
    try {
      await rm(getAntismashRunExtractionDir(runId), {
        recursive: true,
        force: true,
        maxRetries: 5,
        retryDelay: 100,
      });
      evicted += 1;
      bytesReclaimed += byId.get(runId)?.bytes ?? 0;
      filesReclaimed += byId.get(runId)?.files ?? 0;
    } catch (error) {
      failed += 1;
      errors.push(`${runId}: ${error instanceof Error ? error.message : 'unknown error'}`);
    }
  }

  return {
    scanned: entries.length,
    evicted,
    bytesReclaimed,
    failed,
    errors,
    bytesTotal,
    filesTotal,
    filesReclaimed,
    sized,
    unsized,
    enforced: true,
  };
}

function readEnvHours(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const hours = Number(raw);
  return Number.isFinite(hours) && hours > 0 ? hours * 60 * 60 * 1000 : fallback;
}

function readEnvCount(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const count = Number(raw);
  return Number.isFinite(count) && count > 0 ? count : fallback;
}

function readEnvBytes(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const bytes = Number(raw);
  return Number.isFinite(bytes) && bytes > 0 ? bytes : fallback;
}
