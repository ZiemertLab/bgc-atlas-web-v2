import { execFileSync } from 'child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { CombinedArchiveMismatch, openCombinedArchive } from './combined-archive';

const REPO = path.resolve(__dirname, '../../../..');
const A = 'ef1e0ff2-a653-52b8-a80a-6026c43c8374';
const B = '5fefcc41-8f4b-572f-8f9a-616aa05777e6';
const LONG = `${'x'.repeat(150)}`;

let dir: string;
let archive: string;
let index: Map<string, { offset: number; length: number }>;

beforeAll(() => {
  // A small all_regions_gbk.tar.gz built the real way: tar, then the repacker.
  dir = mkdtempSync(path.join(tmpdir(), 'combined-gbk-'));
  const src = path.join(dir, 'src');
  mkdirSync(src);
  writeFileSync(path.join(src, `${A}.gbk`), 'LOCUS a\n'.repeat(500));
  writeFileSync(path.join(src, `${B}.gbk`), 'LOCUS b\n');
  writeFileSync(path.join(src, `${LONG}.gbk`), 'LOCUS long\n');
  const tar = execFileSync('tar', ['--format=gnu', '-cf', '-', '-C', src, `${A}.gbk`, `${B}.gbk`, `${LONG}.gbk`]);
  archive = path.join(dir, 'all.tar.gz');
  const idx = path.join(dir, 'all.index.tsv');
  execFileSync('python3', ['-m', 'scripts.export.repack_regions_gbk', '--out', archive, '--index', idx, '--workers', '1'],
    { cwd: REPO, input: tar, stdio: ['pipe', 'ignore', 'ignore'] });
  index = new Map(readFileSync(idx, 'utf8').trim().split('\n').map((line) => {
    const [name, offset, length] = line.split('\t');
    return [name.replace(/\.gbk$/, ''), { offset: Number(offset), length: Number(length) }];
  }));
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('openCombinedArchive', () => {
  it('reads each region by its offset', async () => {
    const reader = await openCombinedArchive(archive);
    try {
      const a = index.get(A)!;
      expect((await reader.read(A, a.offset, a.length)).toString()).toBe('LOCUS a\n'.repeat(500));
      const b = index.get(B)!;
      expect((await reader.read(B, b.offset, b.length)).toString()).toBe('LOCUS b\n');
      const l = index.get(LONG)!;
      expect((await reader.read(LONG, l.offset, l.length)).toString()).toBe('LOCUS long\n');
    } finally {
      await reader.close();
    }
  });

  it('refuses an offset that lands on another region, as after a rebuild', async () => {
    const reader = await openCombinedArchive(archive);
    try {
      const b = index.get(B)!;
      await expect(reader.read(A, b.offset, b.length)).rejects.toBeInstanceOf(CombinedArchiveMismatch);
      await expect(reader.read(A, b.offset + 1, b.length)).rejects.toBeInstanceOf(CombinedArchiveMismatch);
      await expect(reader.read(A, 0, 0)).rejects.toBeInstanceOf(CombinedArchiveMismatch);
    } finally {
      await reader.close();
    }
  });

  it('is still an ordinary tar.gz', () => {
    const listed = execFileSync('tar', ['-tzf', archive]).toString().trim().split('\n');
    expect(listed).toEqual([`${A}.gbk`, `${B}.gbk`, `${LONG}.gbk`]);
  });
});
