import { execFileSync } from 'child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/api/antismash', () => ({
  isAntismashRunExtracted: async () => false,
  getAntismashRunExtractionDir: (id: string) => `/nonexistent/${id}`,
}));

const { createRegionZip, zipEntryName } = await import('./region-zip');
const { RegionBusyError, readRegionGbk } = await import('@/lib/bgc-download/read-region');
const { CombinedArchiveMismatch } = await import('@/lib/bgc-download/combined-archive');

let dir: string;
let archive: string;

beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'bgc-zip-'));
  const root = path.join(dir, 'src', 'GB_TEST.1', 'antismash');
  mkdirSync(root, { recursive: true });
  writeFileSync(path.join(root, 'CM1.1.region001.gbk'), 'LOCUS region001\n//\n');
  writeFileSync(path.join(root, 'CM1.1.region002.gbk'), 'LOCUS region002\n//\n');
  archive = path.join(dir, 'GB_TEST.1.tar.gz');
  execFileSync('tar', ['-czf', archive, '-C', path.join(dir, 'src'), 'GB_TEST.1']);
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const region = (n: string, archivePath: string | null = archive, gbkOffset: number | null = null) => ({
  bgcId: `b${n}`, runId: 'r', archivePath, filename: `GB_TEST.1_CM1.1.region${n}`,
  gbkOffset, gbkLength: gbkOffset == null ? null : 100,
});

const listZip = (zip: string) =>
  execFileSync('unzip', ['-Z1', zip]).toString().trim().split('\n').sort();

describe('createRegionZip', () => {
  it('packages each region from its archive and counts the unreadable ones as missing', async () => {
    const out = path.join(dir, 'a.zip');
    const progress: number[] = [];
    const result = await createRegionZip(
      [region('001'), region('002'), region('009'), region('003', null)],
      out,
      async (n) => { progress.push(n); },
    );

    expect(result.missingFiles).toBe(2);
    expect(result.totalSize).toBeGreaterThan(0);
    expect(listZip(out)).toEqual(['GB_TEST.1_CM1.1.region001.gbk', 'GB_TEST.1_CM1.1.region002.gbk']);
    expect(execFileSync('unzip', ['-p', out, 'GB_TEST.1_CM1.1.region002.gbk']).toString())
      .toBe('LOCUS region002\n//\n');
    expect(progress.at(-1)).toBe(4);
  });

  it('waits for a free tar slot instead of counting a busy region as missing', async () => {
    let calls = 0;
    const busyTwice: typeof readRegionGbk = async (source) => {
      calls += 1;
      if (calls <= 2) throw new RegionBusyError('busy');
      return readRegionGbk(source);
    };
    const out = path.join(dir, 'b.zip');
    const result = await createRegionZip([region('001')], out, undefined, busyTwice, 1);

    expect(calls).toBe(3);
    expect(result.missingFiles).toBe(0);
    expect(listZip(out)).toEqual(['GB_TEST.1_CM1.1.region001.gbk']);
  });
});

describe('createRegionZip with the combined archive', () => {
  it('reads indexed regions from the combined archive, and falls back to the run tarball for a stale offset', async () => {
    const asked: string[] = [];
    const combined = async () => ({
      read: async (bgcId: string) => {
        asked.push(bgcId);
        if (bgcId === 'b002') throw new CombinedArchiveMismatch('member is someone-else.gbk');
        return Buffer.from(`LOCUS combined ${bgcId}\n//\n`);
      },
      close: async () => {},
    });
    const out = path.join(dir, 'c.zip');
    const result = await createRegionZip(
      [region('001', archive, 0), region('002', archive, 512), region('003', null)],
      out, undefined, readRegionGbk, 1, combined,
    );

    expect(asked).toEqual(['b001', 'b002']); // b003 has no offset: never asked
    expect(result).toMatchObject({ fromCombined: 1, fromRuns: 1, missingFiles: 1 });
    expect(execFileSync('unzip', ['-p', out, 'GB_TEST.1_CM1.1.region001.gbk']).toString())
      .toBe('LOCUS combined b001\n//\n');
    expect(execFileSync('unzip', ['-p', out, 'GB_TEST.1_CM1.1.region002.gbk']).toString())
      .toBe('LOCUS region002\n//\n');
  });

  it('reads run tarballs when the combined archive cannot be opened', async () => {
    const out = path.join(dir, 'd.zip');
    const result = await createRegionZip([region('001', archive, 0)], out, undefined, readRegionGbk, 1,
      async () => { throw new Error('ENOENT'); });
    expect(result).toMatchObject({ fromCombined: 0, fromRuns: 1, missingFiles: 0 });
  });
});

describe('zipEntryName', () => {
  it('adds .gbk once', () => {
    expect(zipEntryName('x.region001')).toBe('x.region001.gbk');
    expect(zipEntryName('x.region001.gbk')).toBe('x.region001.gbk');
  });
});
