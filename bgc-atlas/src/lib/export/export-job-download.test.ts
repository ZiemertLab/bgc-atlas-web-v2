import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

/**
 * Export zips are resumable: a dropped download of a multi-GB zip restarted from
 * byte 0. The record comes from a mocked Prisma; the file is real.
 */

const { record } = vi.hoisted(() => ({ record: { current: null as Record<string, unknown> | null } }));
vi.mock('@/lib/prisma', () => ({ default: { gcfExportJob: { findUnique: async () => record.current } } }));

const { byteRange, serveExportZip } = await import('./export-job-download');

const ID = '11111111-1111-4111-8111-111111111111';
let dir: string;
const body = Buffer.from(Array.from({ length: 1000 }, (_, i) => i % 256));

beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'zip-range-'));
  writeFileSync(path.join(dir, 'x.zip'), body);
  record.current = {
    id: ID, status: 'completed', output_path: path.join(dir, 'x.zip'), output_filename: 'x.zip',
    is_deleted: false, expires_at: new Date(Date.now() + 86_400_000),
  };
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const get = (range?: string, method = 'GET') =>
  serveExportZip(new Request('http://localhost/x', { method, headers: range ? { range } : {} }), ID);

describe('byteRange', () => {
  it.each([
    ['bytes=0-99', { start: 0, end: 99 }],
    ['bytes=900-', { start: 900, end: 999 }],
    ['bytes=-100', { start: 900, end: 999 }],
    ['bytes=950-5000', { start: 950, end: 999 }],
    ['bytes=1000-', 'unsatisfiable'],
    ['bytes=-0', 'unsatisfiable'],
    ['bytes=0-99,200-299', null],
    ['items=0-1', null],
    [null, null],
  ])('%s', (header, expected) => {
    expect(byteRange(header as string | null, 1000)).toEqual(expected);
  });
});

describe('serveExportZip ranges', () => {
  it('serves the whole file without a Range, and says ranges are accepted', async () => {
    const res = await get();
    expect(res.status).toBe(200);
    expect(res.headers.get('Accept-Ranges')).toBe('bytes');
    expect(Buffer.from(await res.arrayBuffer()).equals(body)).toBe(true);
  });

  it('serves a resumed download as 206 with the bytes asked for', async () => {
    const res = await get('bytes=900-');
    expect(res.status).toBe(206);
    expect(res.headers.get('Content-Range')).toBe('bytes 900-999/1000');
    expect(res.headers.get('Content-Length')).toBe('100');
    expect(Buffer.from(await res.arrayBuffer()).equals(body.subarray(900))).toBe(true);
  });

  it('answers a range past the end with 416', async () => {
    const res = await get('bytes=5000-');
    expect(res.status).toBe(416);
    expect(res.headers.get('Content-Range')).toBe('bytes */1000');
  });

  it('answers HEAD with the range headers and no body', async () => {
    const res = await get('bytes=0-9', 'HEAD');
    expect(res.status).toBe(206);
    expect(res.headers.get('Content-Length')).toBe('10');
    expect(res.body).toBeNull();
  });
});
