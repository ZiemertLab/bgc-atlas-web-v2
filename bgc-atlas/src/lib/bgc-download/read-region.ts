import { spawn } from 'child_process';
import { constants } from 'fs';
import { access, readFile } from 'fs/promises';
import path from 'path';

import { getAntismashRunExtractionDir, isAntismashRunExtracted } from '@/lib/api/antismash';

import { escapeTarGlob, regionMemberName } from './region-member';

// Reads from the extracted run if cached, else streams the one member with `tar --occurrence=1`
// (cost is decompressing up to the member). Concurrency-limited and killed after TIMEOUT_MS.

const MAX_CONCURRENT = 3;
const TIMEOUT_MS = 120_000;
/** The largest region in the corpus is ~4 MB of GenBank; anything far past that is not one region. */
const MAX_BYTES = 64 * 1024 * 1024;

let active = 0;

export class RegionBusyError extends Error {}
export class RegionNotFoundError extends Error {}

export interface RegionSource {
  runId: string | null;
  archivePath: string | null;
  filename: string;
}

const readable = async (p: string) => {
  try {
    await access(p, constants.R_OK);
    return true;
  } catch {
    return false;
  }
};

async function fromExtraction(source: RegionSource, member: string): Promise<Buffer | null> {
  if (!source.runId || !(await isAntismashRunExtracted(source.runId))) return null;
  const dir = getAntismashRunExtractionDir(source.runId);
  const base = source.archivePath ? path.basename(source.archivePath, '.tar.gz') : null;
  if (!base) return null;
  // The three layouts the GCF export also knows (lib/queue/gcf-export.ts).
  for (const candidate of [
    path.join(dir, base, 'antismash', member),
    path.join(dir, base, base, member),
    path.join(dir, base, member),
  ]) {
    if (await readable(candidate)) return readFile(candidate);
  }
  return null;
}

function fromArchive(archivePath: string, member: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      'tar',
      ['-xzOf', archivePath, '--wildcards', '--occurrence=1', `*/${escapeTarGlob(member)}`],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );
    const chunks: Buffer[] = [];
    let size = 0;
    let stderr = '';
    let settled = false;
    const finish = (err: Error | null, value?: Buffer) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (err) reject(err);
      else resolve(value as Buffer);
    };
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      finish(new Error(`tar timed out after ${TIMEOUT_MS}ms on ${archivePath}`));
    }, TIMEOUT_MS);

    child.stdout.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BYTES) {
        child.kill('SIGKILL');
        finish(new Error(`region member over ${MAX_BYTES} bytes in ${archivePath}`));
        return;
      }
      chunks.push(chunk);
    });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('error', (err) => finish(err));
    child.on('close', (code) => {
      const out = Buffer.concat(chunks);
      // tar exits 2 with "Not found in archive" when no member matches.
      if (out.length === 0) {
        finish(new RegionNotFoundError(`${member} not in ${archivePath}: ${stderr.trim().slice(0, 300)}`));
      } else if (code !== 0 && !/Not found in archive/.test(stderr)) {
        finish(new Error(`tar exited ${code} on ${archivePath}: ${stderr.trim().slice(0, 300)}`));
      } else {
        finish(null, out);
      }
    });
  });
}

export async function readRegionGbk(source: RegionSource): Promise<Buffer> {
  const member = regionMemberName(source.filename, source.archivePath);

  const cached = await fromExtraction(source, member);
  if (cached) return cached;

  if (!source.archivePath || !(await readable(source.archivePath))) {
    throw new RegionNotFoundError(`archive missing for ${source.filename}`);
  }
  if (active >= MAX_CONCURRENT) {
    throw new RegionBusyError('too many region extractions in flight');
  }
  active += 1;
  try {
    return await fromArchive(source.archivePath, member);
  } finally {
    active -= 1;
  }
}
