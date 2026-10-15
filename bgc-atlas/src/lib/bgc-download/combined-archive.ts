import { open, type FileHandle } from 'fs/promises';
import { gunzipSync } from 'zlib';

// Reads one region from all_regions_gbk.tar.gz by bgc_browse's gbk_offset/gbk_length (one gzip
// member per file). Offsets belong to one archive build, so the member's tar header must name this
// BGC; otherwise the caller falls back to the run tarball.

export const COMBINED_GBK_ARCHIVE =
  process.env.COMBINED_GBK_ARCHIVE ||
  '/data/bgc-atlas/data-v2/populator-out-sequences/all_regions_gbk.tar.gz';

/** No gzip member of one region comes near this; a larger length is not one. */
const MAX_MEMBER_BYTES = 32 * 1024 * 1024;

export class CombinedArchiveMismatch extends Error {}

const BLOCK = 512;
const text = (buf: Buffer, start: number, end: number) => {
  const field = buf.subarray(start, end);
  const nul = field.indexOf(0);
  return field.subarray(0, nul === -1 ? field.length : nul).toString('utf8');
};
const octal = (buf: Buffer, start: number, end: number) => {
  const digits = text(buf, start, end).trim();
  return digits ? parseInt(digits, 8) : 0;
};

// Handles the GNU longname and pax headers the repacker keeps in the same member as their file.
export function fileFromTarMember(member: Buffer): { name: string; data: Buffer } {
  let pos = 0;
  let longName: string | null = null;
  while (pos + BLOCK <= member.length) {
    const hdr = member.subarray(pos, pos + BLOCK);
    const size = octal(hdr, 124, 136);
    const type = String.fromCharCode(hdr[156] || 0x30);
    const bodyStart = pos + BLOCK;
    const next = bodyStart + Math.ceil(size / BLOCK) * BLOCK;
    if (type === 'L') {
      longName = text(member, bodyStart, bodyStart + size);
    } else if (type === 'x') {
      const path = member.subarray(bodyStart, bodyStart + size).toString('utf8')
        .split('\n').map((r) => r.slice(r.indexOf(' ') + 1)).find((kv) => kv.startsWith('path='));
      if (path) longName = path.slice(5);
    } else if (type !== 'K' && type !== 'g') {
      let name = text(hdr, 0, 100);
      if (hdr.subarray(257, 262).toString() === 'ustar') {
        const prefix = text(hdr, 345, 500);
        if (prefix) name = `${prefix}/${name}`;
      }
      if (bodyStart + size > member.length) throw new CombinedArchiveMismatch('member shorter than its header says');
      return { name: longName ?? name, data: member.subarray(bodyStart, bodyStart + size) };
    }
    pos = next;
  }
  throw new CombinedArchiveMismatch('no file header in member');
}

export interface CombinedArchiveReader {
  read(bgcId: string, offset: number, length: number): Promise<Buffer>;
  close(): Promise<void>;
}

/** One open handle for a whole export; reads are positional, so they may overlap. */
export async function openCombinedArchive(path: string = COMBINED_GBK_ARCHIVE): Promise<CombinedArchiveReader> {
  const fh: FileHandle = await open(path, 'r');
  return {
    async read(bgcId, offset, length) {
      if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(length)
        || length <= 0 || length > MAX_MEMBER_BYTES) {
        throw new CombinedArchiveMismatch(`bad offset/length ${offset}/${length}`);
      }
      const buf = Buffer.alloc(length);
      const { bytesRead } = await fh.read(buf, 0, length, offset);
      if (bytesRead !== length) throw new CombinedArchiveMismatch('read past the end of the archive');
      let member: Buffer;
      try {
        member = gunzipSync(buf);
      } catch {
        throw new CombinedArchiveMismatch('offset does not start a gzip member');
      }
      const { name, data } = fileFromTarMember(member);
      if (name !== `${bgcId}.gbk`) throw new CombinedArchiveMismatch(`member is ${name}, not ${bgcId}.gbk`);
      return data;
    },
    close: () => fh.close(),
  };
}

export async function readCombinedRegion(
  bgcId: string,
  offset: number,
  length: number,
  path: string = COMBINED_GBK_ARCHIVE,
): Promise<Buffer> {
  const reader = await openCombinedArchive(path);
  try {
    return await reader.read(bgcId, offset, length);
  } finally {
    await reader.close();
  }
}
