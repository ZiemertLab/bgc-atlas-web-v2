import { EventEmitter } from 'events';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

/**
 * Region trims are bounded box-wide: each streams a run's whole results JSON
 * (up to 14.9 GB) through Python, and nothing stopped a visitor walking BGC ids
 * from starting one per id. The Python is a fake that runs until released.
 */

const { pythons, charge } = vi.hoisted(() => ({
  pythons: [] as EventEmitter[],
  charge: vi.fn(async (): Promise<{ success: boolean; limit: number; remaining: number; reset: number; error?: string }> =>
    ({ success: true, limit: 60, remaining: 59, reset: Date.now() + 60_000 })),
}));
let runDir: string;

vi.mock('@/lib/prisma', () => ({
  default: { $queryRaw: async () => [{ antismash_run_id: 'run-1', contig: 'c1', anchor: 'r1c1' }] },
}));
vi.mock('@/lib/bgc/redirect', () => ({ findBgcRedirect: async () => null, redirectToTwin: () => new Response(null) }));
vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: charge, viewerRateLimit: {} }));
vi.mock('@/lib/api/antismash', () => ({
  ANTISMASH_VIEWER_BUSY_MESSAGE: 'The viewer is busy.',
  antismashExtractionLineFull: () => false,
  antismashExtractionWouldStart: async () => false,
  getAntismashRun: async (id: string) => ({ id, bgcs: [] }),
  getAntismashRunExtractionDir: () => runDir,
  startAntismashRunExtraction: async () => ({ status: 'ready' }),
  findAntismashResultsJsonPath: async () => path.join(runDir, 'results.json'),
  touchAntismashRunExtraction: () => {},
}));
vi.mock('child_process', async (orig) => ({
  ...(await orig<typeof import('child_process')>()),
  spawn: vi.fn(() => {
    const child = Object.assign(new EventEmitter(), { stdout: new EventEmitter(), stderr: new EventEmitter() });
    pythons.push(child);
    return child;
  }),
}));

const { GET } = await import('./route');

beforeAll(() => { runDir = mkdtempSync(path.join(tmpdir(), 'trim-gate-')); });
afterAll(() => rmSync(runDir, { recursive: true, force: true }));

const bgc = (n: number) => `00000000-0000-5000-8000-${String(n).padStart(12, '0')}`;
const call = (n: number) =>
  GET(new Request(`http://localhost/api/bgcs/${bgc(n)}/antismash-json`), { params: Promise.resolve({ id: bgc(n) }) });
const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

describe('region trim gate', () => {
  it('runs two trims at once, queues sixteen, then answers 503 without charging', async () => {
    for (let n = 0; n < 18; n++) expect((await call(n)).status).toBe(202);
    await settle();
    expect(pythons).toHaveLength(2);
    expect(charge).toHaveBeenCalledTimes(18);

    const refused = await call(18);
    expect(refused.status).toBe(503);
    expect((await refused.json()).error).toBe('The viewer is busy.');
    expect(charge).toHaveBeenCalledTimes(18);

    // A poll for a queued BGC is not a new trim: it is neither charged nor refused.
    expect((await call(5)).status).toBe(202);
    expect(charge).toHaveBeenCalledTimes(18);

    pythons[0].emit('exit', 1);
    await settle();
    expect(pythons).toHaveLength(3);
  });

  it("answers 429 for a new trim over the caller's limit", async () => {
    for (const p of pythons) p.emit('exit', 1);
    await settle();
    for (let i = 0; i < 20; i++) { for (const p of pythons) p.emit('exit', 1); await settle(); }
    charge.mockResolvedValueOnce({ success: false, limit: 60, remaining: 0, reset: Date.now() + 30_000,
      error: 'Rate limit exceeded.' });
    const res = await call(99);
    expect(res.status).toBe(429);
  });
});
