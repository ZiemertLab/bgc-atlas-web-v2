import { existsSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The sweep never touches the database; the mock keeps this file off the live DB.
vi.mock('@/lib/prisma', () => ({ default: {} }));

const { sweepStalePartialExports } = await import('./export-cleanup');
const { gcfExportPath, EXPORT_DIR } = await import('@/lib/export/export-dir');

const DAY = 24 * 60 * 60 * 1000;
let dir: string;
const now = Date.now();

const file = (name: string, ageMs: number) => {
  const p = path.join(dir, name);
  writeFileSync(p, 'x');
  const t = (now - ageMs) / 1000;
  utimesSync(p, t, t);
  return p;
};

beforeEach(() => { dir = mkdtempSync(path.join(tmpdir(), 'export-sweep-')); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('sweepStalePartialExports', () => {
  it('deletes only partial files untouched for a day', async () => {
    const stale = file('gcf-a.zip.partial', DAY + 60_000);
    const writing = file('gcf-b.zip.partial', 60_000);
    const oldZip = file('gcf-c.zip', 30 * DAY);
    const other = file('notes.partial.txt', 30 * DAY);

    const result = await sweepStalePartialExports(dir, now);

    expect(result).toEqual({ deleted: [stale], errors: [] });
    expect(existsSync(stale)).toBe(false);
    expect(existsSync(writing)).toBe(true);
    expect(existsSync(oldZip)).toBe(true);
    expect(existsSync(other)).toBe(true);
  });

  it('leaves a directory that happens to end in .partial alone', async () => {
    const sub = path.join(dir, 'x.partial');
    mkdirSync(sub);
    const t = (now - 2 * DAY) / 1000;
    utimesSync(sub, t, t);

    expect(await sweepStalePartialExports(dir, now)).toEqual({ deleted: [], errors: [] });
    expect(existsSync(sub)).toBe(true);
  });

  it('is a no-op when the export directory does not exist yet', async () => {
    expect(await sweepStalePartialExports(path.join(dir, 'missing'), now)).toEqual({ deleted: [], errors: [] });
  });
});

describe('gcfExportPath', () => {
  it('gives each export job its own file in the export directory', () => {
    const a = gcfExportPath('11111111-1111-1111-1111-111111111111');
    const b = gcfExportPath('22222222-2222-2222-2222-222222222222');
    expect(a).toBe(path.join(EXPORT_DIR, 'gcf-11111111-1111-1111-1111-111111111111.zip'));
    expect(a).not.toBe(b);
  });
});

describe('cleanupExpiredExports when a delete fails', () => {
  it('keeps the record for the next sweep instead of marking it deleted', async () => {
    vi.resetModules();
    const update = vi.fn(async () => ({}));
    vi.doMock('@/lib/prisma', () => ({
      default: {
        gcfExportJob: {
          findMany: async () => [
            { id: 'locked', output_path: '/nonexistent-dir-for-test/locked.zip', output_filename: 'a', expires_at: new Date(0) },
            { id: 'gone', output_path: '/tmp/definitely-not-here-export-cleanup.zip', output_filename: 'b', expires_at: new Date(0) },
          ],
          update,
        },
      },
    }));
    vi.doMock('fs/promises', async (orig) => ({
      ...(await orig<typeof import('fs/promises')>()),
      unlink: async (p: string) => {
        throw Object.assign(new Error('denied'), { code: p.includes('locked') ? 'EACCES' : 'ENOENT' });
      },
    }));
    const { cleanupExpiredExports } = await import('./export-cleanup');
    const result = await cleanupExpiredExports();
    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'gone' } }));
    expect(result.failedCount).toBe(1);
    vi.doUnmock('@/lib/prisma');
    vi.doUnmock('fs/promises');
  });
});
