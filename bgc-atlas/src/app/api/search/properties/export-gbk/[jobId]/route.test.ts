import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const { findUnique } = vi.hoisted(() => ({ findUnique: vi.fn() }));
vi.mock('@/lib/prisma', () => ({ default: { gcfExportJob: { findUnique } } }));

import { GET as status } from './route';
import { GET as download } from './download/route';

const ID = '2071fe87-b100-4b86-8e67-4e050195110f';
const dir = mkdtempSync(join(tmpdir(), 'gbk-export-status-'));
const zip = join(dir, `bgc-regions-${ID}.zip`);
writeFileSync(zip, 'PK-not-really');
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const completed = (over: Record<string, unknown> = {}) => ({
  id: ID,
  status: 'completed',
  progress: 100,
  error_message: null,
  output_path: zip,
  output_filename: `bgc-regions-${ID}.zip`,
  total_bgcs: 150,
  missing_files: 0,
  file_size_bytes: BigInt(13),
  expires_at: new Date(Date.now() + 86_400_000),
  is_deleted: false,
  ...over,
});

type Handler = (req: NextRequest, ctx: { params: Promise<{ jobId: string }> }) => Promise<Response>;
const call = (handler: Handler, path: string, method = 'GET') =>
  handler(new NextRequest(`http://x${path}`, { method }), { params: Promise.resolve({ jobId: ID }) });

beforeEach(() => findUnique.mockReset());

describe('GET /api/search/properties/export-gbk/[jobId]', () => {
  it('reports a finished export whose file is on disk as ready', async () => {
    findUnique.mockResolvedValue(completed());
    const res = await call(status, `/api/search/properties/export-gbk/${ID}`);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      state: 'completed', ready: true, totalBgcs: 150, fileSizeBytes: 13,
      filename: `bgc-regions-${ID}.zip`,
    });
  });

  it.each([
    ['the file is gone', { output_path: join(dir, 'missing.zip') }],
    ['it has expired', { expires_at: new Date(Date.now() - 1000) }],
    ['it was deleted', { is_deleted: true }],
    ['it has no output path', { output_path: null }],
  ])('answers 410 when %s', async (_why, over) => {
    findUnique.mockResolvedValue(completed(over));
    const res = await call(status, `/api/search/properties/export-gbk/${ID}`);
    expect(res.status).toBe(410);
  });

  it('maps a running export to active', async () => {
    findUnique.mockResolvedValue(completed({ status: 'running', progress: 40 }));
    const res = await call(status, `/api/search/properties/export-gbk/${ID}`);
    expect(await res.json()).toMatchObject({ state: 'active', ready: false, progress: 40 });
  });

  it('answers 404 for an unknown job', async () => {
    findUnique.mockResolvedValue(null);
    const res = await call(status, `/api/search/properties/export-gbk/${ID}`);
    expect(res.status).toBe(404);
  });
});

describe('GET /api/search/properties/export-gbk/[jobId]/download', () => {
  it('serves the zip recorded on the export job', async () => {
    findUnique.mockResolvedValue(completed());
    const res = await call(download, `/api/search/properties/export-gbk/${ID}/download`, 'HEAD');
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Disposition')).toContain(`bgc-regions-${ID}.zip`);
    expect(res.headers.get('Content-Length')).toBe('13');
  });

  it('answers 410 for an expired export', async () => {
    findUnique.mockResolvedValue(completed({ expires_at: new Date(Date.now() - 1000) }));
    const res = await call(download, `/api/search/properties/export-gbk/${ID}/download`);
    expect(res.status).toBe(410);
  });
});
