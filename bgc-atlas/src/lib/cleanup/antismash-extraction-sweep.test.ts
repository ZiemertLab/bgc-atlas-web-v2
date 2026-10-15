import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, utimes, rm, readdir, readFile } from 'fs/promises';
import os from 'os';
import path from 'path';

import { cleanupAntismashExtractions } from './antismash-extraction-cleanup';

// The filesystem half of the sweep, exercised against a scratch directory since a wrong path is destructive.

const GB = 1024 * 1024 * 1024;
const HOUR = 60 * 60 * 1000;

const RUN_A = '11111111-1111-5111-8111-111111111111';
const RUN_B = '22222222-2222-5222-8222-222222222222';
const RUN_C = '33333333-3333-5333-8333-333333333333';

let root: string;
let previousRoot: string | undefined;

async function makeRun(
  runId: string,
  {
    bytes,
    ageMs,
    files = 300,
    complete = true,
  }: { bytes: number; ageMs: number; files?: number; complete?: boolean },
) {
  const dir = path.join(root, runId);
  await mkdir(path.join(dir, 'nested'), { recursive: true });
  await writeFile(path.join(dir, 'nested', 'index.html'), 'x', 'utf8');

  const when = new Date(Date.now() - ageMs);
  if (complete) {
    const marker = path.join(dir, '.extraction-complete');
    await writeFile(
      marker,
      JSON.stringify({ completedAt: when.toISOString(), bytes, files }),
      'utf8',
    );
    await utimes(marker, when, when);
  } else {
    await utimes(dir, when, when);
  }
}

const remaining = async () => (await readdir(root)).sort();

beforeEach(async () => {
  previousRoot = process.env.ANTISMASH_TMP_DIR;
  root = await mkdtemp(path.join(os.tmpdir(), 'antismash-sweep-'));
  process.env.ANTISMASH_TMP_DIR = root;
});

afterEach(async () => {
  if (previousRoot === undefined) delete process.env.ANTISMASH_TMP_DIR;
  else process.env.ANTISMASH_TMP_DIR = previousRoot;
  await rm(root, { recursive: true, force: true });
});

describe('cleanupAntismashExtractions', () => {
  it('removes a run whose last serve is past the TTL, and leaves a fresh one', async () => {
    await makeRun(RUN_A, { bytes: 1 * GB, ageMs: 30 * HOUR });
    await makeRun(RUN_B, { bytes: 1 * GB, ageMs: 1 * HOUR });

    const result = await cleanupAntismashExtractions({ ttlMs: 24 * HOUR });

    expect(result.evicted).toBe(1);
    expect(result.bytesReclaimed).toBe(1 * GB);
    expect(await remaining()).toEqual([RUN_B]);
  });

  it('evicts coldest-first and stops as soon as the cache fits', async () => {
    // 7 GB against a 4 GB cap: dropping the coldest leaves exactly 4 GB, so the sweep stops there.
    await makeRun(RUN_A, { bytes: 3 * GB, ageMs: 5 * HOUR });
    await makeRun(RUN_B, { bytes: 3 * GB, ageMs: 3 * HOUR });
    await makeRun(RUN_C, { bytes: 1 * GB, ageMs: 1 * HOUR });

    await cleanupAntismashExtractions({ maxBytes: 4 * GB });

    expect(await remaining()).toEqual([RUN_B, RUN_C]);
  });

  it('keeps going when one eviction is not enough', async () => {
    await makeRun(RUN_A, { bytes: 3 * GB, ageMs: 5 * HOUR });
    await makeRun(RUN_B, { bytes: 3 * GB, ageMs: 3 * HOUR });
    await makeRun(RUN_C, { bytes: 1 * GB, ageMs: 1 * HOUR });

    await cleanupAntismashExtractions({ maxBytes: 2 * GB });

    expect(await remaining()).toEqual([RUN_C]);
  });

  it('reads the size from the marker rather than walking the tree', async () => {
    // The marker claims 2 GB but the directory holds one byte: the sweep must trust the marker.
    await makeRun(RUN_A, { bytes: 2 * GB, ageMs: 5 * HOUR });
    await makeRun(RUN_B, { bytes: 2 * GB, ageMs: 1 * HOUR });

    await cleanupAntismashExtractions({ maxBytes: 3 * GB });

    expect(await remaining()).toEqual([RUN_B]);
  });

  it('leaves a directory it did not create', async () => {
    // Not named by uuid, so not created by this sweep.
    await mkdir(path.join(root, 'not-a-run-id'), { recursive: true });
    await writeFile(path.join(root, 'not-a-run-id', 'keep.txt'), 'keep', 'utf8');
    const stray = path.join(root, 'loose-file.txt');
    await writeFile(stray, 'keep', 'utf8');
    await makeRun(RUN_A, { bytes: 1 * GB, ageMs: 99 * HOUR });

    await cleanupAntismashExtractions({ ttlMs: 24 * HOUR });

    expect(await remaining()).toEqual(['loose-file.txt', 'not-a-run-id']);
  });

  it('leaves a young unmarked directory but reaps an old one', async () => {
    // Unmarked means tar is still running, or crashed partway. The grace
    // period is what tells those apart.
    await makeRun(RUN_A, { bytes: 0, ageMs: 1 * HOUR, complete: false });
    await makeRun(RUN_B, { bytes: 0, ageMs: 9 * HOUR, complete: false });

    await cleanupAntismashExtractions({ ttlMs: 24 * HOUR });

    expect(await remaining()).toEqual([RUN_A]);
  });

  it('spares the most recently served run even when it alone exceeds the cap', async () => {
    // One MFD run (~4.4 GB) is the most recently served, so exempt from a 4 GB cap.
    await makeRun(RUN_A, { bytes: 4.4 * GB, ageMs: 60_000 });

    await cleanupAntismashExtractions({ maxBytes: 4 * GB });

    expect(await remaining()).toEqual([RUN_A]);
  });

  it('reports an empty cache without creating one', async () => {
    await rm(root, { recursive: true, force: true });
    const result = await cleanupAntismashExtractions();
    expect(result).toMatchObject({ scanned: 0, evicted: 0, failed: 0 });
  });

  it('DELETES NOTHING when no bound is configured', async () => {
    // Report-only until a bound is configured.
    const priorMax = process.env.ANTISMASH_CACHE_MAX_BYTES;
    const priorTtl = process.env.ANTISMASH_CACHE_TTL_HOURS;
    delete process.env.ANTISMASH_CACHE_MAX_BYTES;
    delete process.env.ANTISMASH_CACHE_TTL_HOURS;
    try {
      await makeRun(RUN_A, { bytes: 500 * GB, ageMs: 9999 * HOUR });
      await makeRun(RUN_B, { bytes: 500 * GB, ageMs: 9999 * HOUR });

      const result = await cleanupAntismashExtractions();

      expect(result.enforced).toBe(false);
      // It still SAYS what it would do, so the report is actionable.
      expect(result.evicted).toBe(2);
      expect(result.bytesTotal).toBe(1000 * GB);
      expect(await remaining()).toEqual([RUN_A, RUN_B]);
    } finally {
      if (priorMax !== undefined) process.env.ANTISMASH_CACHE_MAX_BYTES = priorMax;
      if (priorTtl !== undefined) process.env.ANTISMASH_CACHE_TTL_HOURS = priorTtl;
    }
  });

  it('enforces when a bound is passed explicitly', async () => {
    await makeRun(RUN_A, { bytes: 1 * GB, ageMs: 9999 * HOUR });
    const result = await cleanupAntismashExtractions({ ttlMs: HOUR });
    expect(result.enforced).toBe(true);
    expect(await remaining()).toEqual([]);
  });
});

describe('cleanupAntismashExtractions — inodes', () => {
  it('evicts to satisfy the file cap while far under the byte cap', async () => {
    await makeRun(RUN_A, { bytes: 8.3 * GB, files: 46_018, ageMs: 5 * HOUR });
    await makeRun(RUN_B, { bytes: 8.3 * GB, files: 46_018, ageMs: 1 * HOUR });

    const result = await cleanupAntismashExtractions({ maxBytes: 750 * GB, maxFiles: 50_000 });

    expect(result.enforced).toBe(true);
    expect(result.filesReclaimed).toBe(46_018);
    expect(await remaining()).toEqual([RUN_B]);
  });

  it('re-walks a bytes-only marker, which cannot answer the file cap', async () => {
    // Bytes-only legacy markers must be re-measured, not counted as zero files.
    const dir = path.join(root, RUN_A);
    await mkdir(path.join(dir, 'nested'), { recursive: true });
    await writeFile(path.join(dir, 'nested', 'a.txt'), 'x', 'utf8');
    await writeFile(path.join(dir, 'nested', 'b.txt'), 'x', 'utf8');
    const when = new Date(Date.now() - HOUR);
    const marker = path.join(dir, '.extraction-complete');
    await writeFile(marker, JSON.stringify({ completedAt: when.toISOString(), bytes: 999 }), 'utf8');
    await utimes(marker, when, when);

    const result = await cleanupAntismashExtractions({ maxFiles: 500_000 });

    // 3, not 2: the marker itself is a file.
    expect(result.filesTotal).toBe(3);
    const rewritten = JSON.parse(await readFile(marker, 'utf8'));
    expect(rewritten.files).toBe(3);
  });
});
