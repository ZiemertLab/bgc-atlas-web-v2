import { execFileSync } from 'child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/api/antismash', () => ({
  isAntismashRunExtracted: async () => false,
  getAntismashRunExtractionDir: (id: string) => `/nonexistent/${id}`,
}));

const { readRegionGbk, RegionNotFoundError } = await import('./read-region');

let dir: string;
let archive: string;

beforeAll(() => {
  // A run archive laid out like a GTDB one: {ARCHIVE}/antismash/{CONTIG}.regionNNN.gbk
  dir = mkdtempSync(path.join(tmpdir(), 'bgc-region-'));
  const root = path.join(dir, 'src', 'GB_TEST.1', 'antismash');
  mkdirSync(root, { recursive: true });
  writeFileSync(path.join(root, 'CM1.1.region001.gbk'), 'LOCUS region001\n//\n');
  writeFileSync(path.join(root, 'CM1.1.region002.gbk'), 'LOCUS region002\n//\n');
  writeFileSync(path.join(root, 'CM1.1.gbk'), 'LOCUS whole-record\n//\n');
  archive = path.join(dir, 'GB_TEST.1.tar.gz');
  execFileSync('tar', ['-czf', archive, '-C', path.join(dir, 'src'), 'GB_TEST.1']);
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('readRegionGbk from an archive', () => {
  it('extracts exactly the requested region member', async () => {
    const buf = await readRegionGbk({ runId: 'r', archivePath: archive, filename: 'GB_TEST.1_CM1.1.region002' });
    expect(buf.toString()).toBe('LOCUS region002\n//\n');
  });

  it('reports a missing member as not found', async () => {
    await expect(
      readRegionGbk({ runId: 'r', archivePath: archive, filename: 'GB_TEST.1_CM1.1.region009' }),
    ).rejects.toBeInstanceOf(RegionNotFoundError);
  });

  it('treats glob characters in the name literally', async () => {
    await expect(
      readRegionGbk({ runId: 'r', archivePath: archive, filename: 'GB_TEST.1_CM1.1.region00*' }),
    ).rejects.toBeInstanceOf(RegionNotFoundError);
  });

  it('reports a missing archive as not found', async () => {
    await expect(
      readRegionGbk({ runId: 'r', archivePath: path.join(dir, 'nope.tar.gz'), filename: 'x.region001' }),
    ).rejects.toBeInstanceOf(RegionNotFoundError);
  });
});
