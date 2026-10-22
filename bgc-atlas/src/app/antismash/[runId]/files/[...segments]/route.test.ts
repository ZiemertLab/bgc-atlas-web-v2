import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

let runDir: string;

const { viewer, ensure, charge } = vi.hoisted(() => ({
  viewer: { wouldStart: false, full: false },
  ensure: vi.fn(),
  charge: vi.fn(async (): Promise<{ success: boolean; limit: number; remaining: number; reset: number; error?: string }> =>
    ({ success: true, limit: 60, remaining: 59, reset: Date.now() + 60_000 })),
}));

vi.mock('@/lib/api/antismash', () => ({
  ANTISMASH_VIEWER_BUSY_MESSAGE: 'The viewer is busy.',
  antismashExtractionWouldStart: async () => viewer.wouldStart,
  antismashExtractionLineFull: () => viewer.full,
  getAntismashRun: async (id: string) => ({ id, bgcs: [] }),
  ensureAntismashRunExtraction: ensure,
  getAntismashRunExtractionDir: () => runDir,
  touchAntismashRunExtraction: () => {},
}));
vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: charge, viewerRateLimit: {} }));

const opened: string[] = [];
const streams: Array<{ destroyed: boolean }> = [];
vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return {
    ...actual,
    createReadStream: (file: string, ...rest: unknown[]) => {
      opened.push(file);
      const stream = (actual.createReadStream as (...a: unknown[]) => { destroyed: boolean })(file, ...rest);
      streams.push(stream);
      return stream;
    },
  };
});

const { GET } = await import('./route');

const RUN = 'a40fc7b4-320f-5458-8469-d613b167b882';
const body = 'LOCUS x\n'.repeat(20_000); // 160 KB: more than one read's worth

beforeAll(() => {
  runDir = mkdtempSync(path.join(tmpdir(), 'antismash-files-'));
  mkdirSync(path.join(runDir, 'js'));
  writeFileSync(path.join(runDir, 'js', 'big.gbk'), body);
});
afterAll(() => rmSync(runDir, { recursive: true, force: true }));
beforeEach(() => {
  opened.length = 0; streams.length = 0;
  viewer.wouldStart = false; viewer.full = false;
  ensure.mockReset().mockImplementation(async () => ({ status: 'ready', extractedPath: runDir }));
  charge.mockClear();
});

const call = (method: string, segments: string[], signal?: AbortSignal) =>
  GET(new Request(`http://localhost/antismash/${RUN}/files/${segments.join('/')}`, { method, signal }), {
    params: Promise.resolve({ runId: RUN, segments }),
  });

describe('antiSMASH run files', () => {
  it('answers HEAD with the headers and size, without opening the file', async () => {
    const res = await call('HEAD', ['js', 'big.gbk']);
    expect(res.status).toBe(200);
    expect(res.body).toBeNull();
    expect(res.headers.get('Content-Length')).toBe(String(body.length));
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(opened).toEqual([]);
  });

  it('streams the file on GET', async () => {
    const res = await call('GET', ['js', 'big.gbk']);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(body);
    expect(opened).toHaveLength(1);
  });

  it('closes the file when the client leaves before the body is read', async () => {
    const controller = new AbortController();
    const res = await call('GET', ['js', 'big.gbk'], controller.signal);
    expect(res.status).toBe(200);
    expect(streams[0].destroyed).toBe(false);
    controller.abort();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(streams[0].destroyed).toBe(true);
  });

  it('still answers 404 for a missing file on HEAD', async () => {
    const res = await call('HEAD', ['js', 'nope.gbk']);
    expect(res.status).toBe(404);
  });

  it('charges the caller only for a run it would start unpacking', async () => {
    await call('GET', ['js', 'big.gbk']);
    expect(charge).not.toHaveBeenCalled();

    viewer.wouldStart = true;
    await call('GET', ['js', 'big.gbk']);
    expect(charge).toHaveBeenCalledTimes(1);
  });

  it('answers 429 and starts nothing when the caller is over the viewer limit', async () => {
    viewer.wouldStart = true;
    charge.mockResolvedValueOnce({ success: false, limit: 60, remaining: 0, reset: Date.now() + 30_000,
      error: 'Rate limit exceeded. Please wait 30 seconds before trying again.' });
    const res = await call('GET', ['index.html']);
    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBeTruthy();
    expect(ensure).not.toHaveBeenCalled();
  });

  it('answers 503 with a readable message when the unpacking line is full', async () => {
    viewer.wouldStart = true;
    viewer.full = true;
    const res = await call('GET', ['index.html']);
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe('The viewer is busy.');
    expect(charge).not.toHaveBeenCalled();
    expect(ensure).not.toHaveBeenCalled();
  });

  it('answers 503, not 500, when the unpack was refused at the gate', async () => {
    viewer.wouldStart = true;
    ensure.mockResolvedValueOnce({ status: 'error', busy: true, message: 'The viewer is busy.' });
    const res = await call('GET', ['index.html']);
    expect(res.status).toBe(503);
  });

  it('does not show the archive path from a failed unpack', async () => {
    ensure.mockResolvedValueOnce({ status: 'missing-file', message: 'Archive not found or unreadable at /ceph/secret/run.tar.gz.' });
    const res = await call('GET', ['index.html']);
    expect(res.status).toBe(404);
    expect(JSON.stringify(await res.json())).not.toContain('/ceph/');
  });

  it('refuses a symlink that leads out of the run directory', async () => {
    const outside = mkdtempSync(path.join(tmpdir(), 'outside-run-'));
    writeFileSync(path.join(outside, 'secret.env'), 'DATABASE_URL=postgres://secret');
    symlinkSync(path.join(outside, 'secret.env'), path.join(runDir, 'js', 'innocent.js'));
    try {
      const res = await call('GET', ['js', 'innocent.js']);
      expect(res.status).toBe(404);
      expect(await res.text()).not.toContain('secret');
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it('still serves a symlink that stays inside the run', async () => {
    symlinkSync(path.join(runDir, 'js', 'big.gbk'), path.join(runDir, 'js', 'alias.gbk'));
    expect((await call('GET', ['js', 'alias.gbk'])).status).toBe(200);
  });
});
