import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

import { afterAll, describe, expect, it, vi } from 'vitest';

/** An export past expires_at is not offered for download, though its file may still exist. */

const { job } = vi.hoisted(() => ({ job: { current: null as Record<string, unknown> | null } }));
vi.mock('@/lib/prisma', () => ({ default: { gcfExportJob: { findUnique: async () => job.current } } }));

const { GET } = await import('./route');
type Req = Parameters<typeof GET>[0];
const ID = '33333333-3333-4333-8333-333333333333';
const dir = mkdtempSync(path.join(tmpdir(), 'export-status-'));
const zip = path.join(dir, 'x.zip');
writeFileSync(zip, 'zip');
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const status = async (expiresAt: Date) => {
  job.current = {
    id: ID, kind: 'gcf', status: 'completed', output_path: zip, output_filename: 'x.zip', is_deleted: false,
    expires_at: expiresAt, created_at: new Date(), gcf: { id: 'g', name: 'GCF-x' },
  };
  const res = await GET(new Request(`http://localhost/api/exports/${ID}`) as unknown as Req, { params: Promise.resolve({ jobId: ID }) });
  return (await res.json()).data as { fileExists: boolean; downloadUrl: string | null };
};

describe('GET /api/exports/[jobId] near expiry', () => {
  it('offers the zip before it expires', async () => {
    expect(await status(new Date(Date.now() + 3_600_000))).toMatchObject({ fileExists: true });
  });
  it('does not offer it once expired, though the nightly sweep has not run yet', async () => {
    expect(await status(new Date(Date.now() - 1000))).toMatchObject({ fileExists: false, downloadUrl: null });
  });
});
