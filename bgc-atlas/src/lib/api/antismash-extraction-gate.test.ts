import { EventEmitter } from 'events';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import os from 'os';
import path from 'path';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

/**
 * Box-wide cap on run extractions. The per-run dedup did nothing against many
 * DIFFERENT runs: an anonymous visitor could start one `tar` per BGC id. `tar` is
 * a fake here that runs until the test lets it exit.
 */

const { tars } = vi.hoisted(() => ({ tars: [] as EventEmitter[] }));

vi.mock('@/lib/prisma', () => ({ default: {} }));
vi.mock('child_process', async (orig) => ({
  ...(await orig<typeof import('child_process')>()),
  spawn: vi.fn((cmd: string) => {
    const child = new EventEmitter();
    if (cmd === 'tar') tars.push(child);
    return child;
  }),
}));

const {
  ensureAntismashRunExtraction, startAntismashRunExtraction, antismashExtractionLineFull,
  ANTISMASH_VIEWER_BUSY_MESSAGE,
} = await import('./antismash');
type Run = Parameters<typeof ensureAntismashRunExtraction>[0];

let root: string;
let archive: string;
beforeAll(() => {
  root = mkdtempSync(path.join(os.tmpdir(), 'antismash-gate-'));
  archive = path.join(root, 'run.tar.gz');
  writeFileSync(archive, 'not really a tarball');
  process.env.ANTISMASH_TMP_DIR = path.join(root, 'cache');
});
afterAll(() => rmSync(root, { recursive: true, force: true }));

const run = (n: number): Run => ({
  id: `00000000-0000-5000-8000-${String(n).padStart(12, '0')}`,
  name: `RUN${n}`, file_path: archive, num_bgcs: 1, pipeline_version: null, antismash_version: null,
  status: null, assembly: null, created_at: '', updated_at: '',
  extraction: { isExtracted: false, directory: null, indexRelativePath: null, regionsRelativePath: null },
  bgcs: [],
}) as unknown as Run;

const settle = () => new Promise((resolve) => setTimeout(resolve, 50));

describe('extraction gate', () => {
  it('runs two tars at once, queues eight, and refuses the next at once', async () => {
    const pending = Array.from({ length: 10 }, (_, i) => ensureAntismashRunExtraction(run(i)));
    await settle();
    expect(tars).toHaveLength(2);
    expect(antismashExtractionLineFull()).toBe(true);

    await expect(ensureAntismashRunExtraction(run(10))).resolves.toMatchObject({
      status: 'error', busy: true, message: ANTISMASH_VIEWER_BUSY_MESSAGE,
    });
    // startAntismashRunExtraction answers synchronously, and records nothing to retry.
    await expect(startAntismashRunExtraction(run(11))).resolves.toMatchObject({ status: 'error', busy: true });

    // A finished tar hands its slot to the next run in line, never a third at once.
    tars[0].emit('exit', 1);
    await settle();
    expect(tars).toHaveLength(3);
    expect(antismashExtractionLineFull()).toBe(false);

    for (let i = 1; i < 10; i++) {
      tars[i].emit('exit', 1);
      await settle();
    }
    const results = await Promise.all(pending);
    expect(results.every((r) => r.status === 'error' && !r.busy)).toBe(true);
    expect(tars).toHaveLength(10);
  });
});
