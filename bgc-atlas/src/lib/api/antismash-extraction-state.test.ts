import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { execFileSync } from 'child_process';
import { access, mkdir, mkdtemp, rm, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';

// antismash.ts imports Prisma, which reads .env and would connect to the live
// database; nothing here needs it.
vi.mock('@/lib/prisma', () => ({ default: {} }));

import {
  getAntismashExtractionState,
  getAntismashRunExtractionDir,
  startAntismashRunExtraction,
  type AntismashRunRecord,
} from './antismash';

/**
 * The in-memory extraction state must not outlive the files it describes.
 *
 * The hourly eviction sweep deletes extracted runs from disk without telling
 * this module. A `ready` entry left in the map then answered every later
 * request: the JSON route searched an empty directory and returned "antiSMASH
 * results JSON not found in archive" until the server restarted, and no
 * request ever extracted the run again.
 */

const RUN_ID = '44444444-4444-5444-8444-444444444444';

let root: string;
let archive: string;
let previousRoot: string | undefined;

const run = (): AntismashRunRecord => ({
  id: RUN_ID,
  name: 'RUN',
  file_path: archive,
  num_bgcs: 1,
  pipeline_version: null,
  antismash_version: null,
  status: null,
  assembly: null,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  extraction: { isExtracted: false, directory: null, indexRelativePath: null, regionsRelativePath: null },
  bgcs: [],
});

async function waitForReady() {
  for (let i = 0; i < 200; i++) {
    const state = await getAntismashExtractionState(RUN_ID);
    if (state?.status === 'ready') return state;
    if (state?.status === 'error') throw new Error(state.message);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error('extraction never became ready');
}

beforeEach(async () => {
  previousRoot = process.env.ANTISMASH_TMP_DIR;
  const scratch = await mkdtemp(path.join(os.tmpdir(), 'antismash-state-'));
  root = path.join(scratch, 'cache');
  process.env.ANTISMASH_TMP_DIR = root;

  const source = path.join(scratch, 'source');
  await mkdir(path.join(source, 'RUN', 'RUN'), { recursive: true });
  await writeFile(path.join(source, 'RUN', 'RUN', 'index.html'), '<html></html>', 'utf8');
  await writeFile(path.join(source, 'RUN', 'RUN', 'RUN.json'), '{"records": []}', 'utf8');
  archive = path.join(scratch, 'RUN.tar.gz');
  execFileSync('tar', ['-czf', archive, '-C', source, 'RUN']);
});

afterEach(async () => {
  if (previousRoot === undefined) delete process.env.ANTISMASH_TMP_DIR;
  else process.env.ANTISMASH_TMP_DIR = previousRoot;
  await rm(path.dirname(root), { recursive: true, force: true });
});

describe('extraction state after the files are removed', () => {
  it('stops reporting ready once the extraction is gone from disk', async () => {
    await startAntismashRunExtraction(run());
    await waitForReady();

    await rm(getAntismashRunExtractionDir(RUN_ID), { recursive: true, force: true });

    expect(await getAntismashExtractionState(RUN_ID)).toBeNull();
  });

  it('extracts again when asked after an eviction', async () => {
    await startAntismashRunExtraction(run());
    await waitForReady();

    await rm(getAntismashRunExtractionDir(RUN_ID), { recursive: true, force: true });

    const restarted = await startAntismashRunExtraction(run());
    expect(restarted.status).toBe('extracting');
    await waitForReady();
    await access(path.join(getAntismashRunExtractionDir(RUN_ID), 'RUN', 'RUN', 'RUN.json'));
  });
});
