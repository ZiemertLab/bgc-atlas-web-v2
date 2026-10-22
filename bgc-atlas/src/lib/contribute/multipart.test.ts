import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { receiveMultipart, type FilePolicy } from './multipart';

const BOUNDARY = '----atlas-test-boundary';
const enc = new TextEncoder();

type Part =
  | { name: string; value: string }
  | { name: string; filename: string; type?: string; content: string | { repeat: string; bytes: number } };

/**
 * A multipart body as a stream, generated as it is read, so a large file never
 * exists in memory on the sending side either. `pulled` counts what was read.
 */
function multipart(parts: Part[]) {
  const stats = { pulled: 0 };
  async function* chunks() {
    for (const part of parts) {
      if ('value' in part) {
        yield enc.encode(`--${BOUNDARY}\r\nContent-Disposition: form-data; name="${part.name}"\r\n\r\n${part.value}\r\n`);
        continue;
      }
      yield enc.encode(`--${BOUNDARY}\r\nContent-Disposition: form-data; name="${part.name}"; filename="${part.filename}"\r\n`
        + `Content-Type: ${part.type ?? 'text/plain'}\r\n\r\n`);
      if (typeof part.content === 'string') {
        yield enc.encode(part.content);
      } else {
        const block = enc.encode(part.content.repeat.repeat(Math.ceil(65536 / part.content.repeat.length)).slice(0, 65536));
        for (let sent = 0; sent < part.content.bytes; sent += block.length) {
          yield block.subarray(0, Math.min(block.length, part.content.bytes - sent));
        }
      }
      yield enc.encode('\r\n');
    }
    yield enc.encode(`--${BOUNDARY}--\r\n`);
  }
  const it = chunks();
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      const { value, done } = await it.next();
      if (done) controller.close();
      else { stats.pulled += value.length; controller.enqueue(value); }
    },
  });
  const request = new Request('http://localhost/api/contribute', {
    method: 'POST',
    headers: { 'content-type': `multipart/form-data; boundary=${BOUNDARY}` },
    body,
    // @ts-expect-error -- required by undici for a stream body, absent from the DOM type
    duplex: 'half',
  });
  return { request, stats };
}

const policy = (over: Partial<FilePolicy> = {}): FilePolicy => ({
  maxCount: 1,
  tooMany: (n) => `too many (${n})`,
  maxBytes: 1024 * 1024,
  check: (filename) => (/\.fasta$/.test(filename) ? null : `'${filename}' is not FASTA`),
  tooLarge: (filename) => `'${filename}' is too large`,
  ...over,
});

let root: string;
let dir: string;
beforeEach(() => { root = mkdtempSync(path.join(tmpdir(), 'multipart-')); dir = path.join(root, 'sub'); });
afterEach(() => rmSync(root, { recursive: true, force: true }));

const receive = (request: Request, files: Record<string, FilePolicy> = { assemblies: policy() }, extra = {}) =>
  receiveMultipart(request, { dir, files, safeName: (n) => n.replace(/[^a-zA-Z0-9._-]/g, '_'), ...extra });

describe('receiveMultipart', () => {
  it('returns the fields and writes each file under dir', async () => {
    const { request } = multipart([
      { name: 'email', value: 'a@example.org' },
      { name: 'assemblies', filename: 'a b.fasta', content: '>c1\nACGT\n' },
      { name: 'metadata', filename: 'm.tsv', content: 'sample_alias\nS1\n' },
    ]);
    const result = await receive(request, {
      assemblies: policy(),
      metadata: policy({ check: () => null, keepContent: true }),
    });

    expect(result.fields).toEqual({ email: 'a@example.org' });
    expect(result.files.map((f) => [f.field, f.filename, f.savedName, f.bytes]))
      .toEqual([['assemblies', 'a b.fasta', 'a_b.fasta', 9], ['metadata', 'm.tsv', 'm.tsv', 16]]);
    expect(readFileSync(path.join(dir, 'a_b.fasta'), 'utf8')).toBe('>c1\nACGT\n');
    expect(result.files[1].content?.toString()).toBe('sample_alias\nS1\n');
    expect(result.files[0].content).toBeUndefined();
  });

  it('streams a large file to disk without holding it in memory', async () => {
    const bytes = 200 * 1024 * 1024;
    const { request } = multipart([
      { name: 'assemblies', filename: 'big.fasta', content: { repeat: 'ACGT', bytes } },
    ]);
    const before = process.memoryUsage().arrayBuffers;
    let peak = before;
    const timer = setInterval(() => { peak = Math.max(peak, process.memoryUsage().arrayBuffers); }, 5);
    try {
      const result = await receive(request, { assemblies: policy({ maxBytes: bytes }) });
      expect(result.files[0].bytes).toBe(bytes);
    } finally {
      clearInterval(timer);
    }
    expect(statSync(path.join(dir, 'big.fasta')).size).toBe(bytes);
    // formData() would have held all 200 MB at least once.
    expect(peak - before).toBeLessThan(50 * 1024 * 1024);
  }, 60_000);

  it('stops reading the moment a file passes its limit', async () => {
    const { request, stats } = multipart([
      { name: 'assemblies', filename: 'big.fasta', content: { repeat: 'ACGT', bytes: 50 * 1024 * 1024 } },
    ]);
    await expect(receive(request)).rejects.toMatchObject({ message: "'big.fasta' is too large", status: 413 });
    expect(stats.pulled).toBeLessThan(10 * 1024 * 1024);
  });

  it('refuses a file its policy rejects before writing it, and reads no further', async () => {
    const { request, stats } = multipart([
      { name: 'assemblies', filename: 'notes.docx', content: { repeat: 'x', bytes: 20 * 1024 * 1024 } },
    ]);
    await expect(receive(request)).rejects.toMatchObject({ message: "'notes.docx' is not FASTA", status: 400 });
    expect(existsSync(path.join(dir, 'notes.docx'))).toBe(false);
    expect(stats.pulled).toBeLessThan(10 * 1024 * 1024);
  });

  it('refuses a form whose fields are already wrong before storing its file', async () => {
    const { request } = multipart([
      { name: 'email', value: 'a@example.org, b@example.org' },
      { name: 'assemblies', filename: 'a.fasta', content: '>c1\nACGT\n' },
    ]);
    await expect(receive(request, undefined, {
      checkFieldsBeforeFile: (f: Record<string, string>) => (f.email.includes(',') ? 'one address' : null),
    })).rejects.toMatchObject({ message: 'one address', status: 400 });
    expect(existsSync(dir) ? readdirSync(dir) : []).toEqual([]);
  });

  it('refuses more files than the field takes', async () => {
    const { request } = multipart([
      { name: 'assemblies', filename: 'a.fasta', content: '>a\nACGT\n' },
      { name: 'assemblies', filename: 'b.fasta', content: '>b\nACGT\n' },
    ]);
    await expect(receive(request)).rejects.toMatchObject({ message: 'too many (2)', status: 400 });
  });

  it('skips an empty file and a part the form does not take', async () => {
    const { request } = multipart([
      { name: 'assemblies', filename: 'empty.fasta', content: '' },
      { name: 'other', filename: 'x.fasta', content: 'ignored' },
    ]);
    const result = await receive(request);
    expect(result.files).toEqual([]);
    expect(existsSync(path.join(dir, 'empty.fasta'))).toBe(false);
    expect(existsSync(path.join(dir, 'x.fasta'))).toBe(false);
  });

  it('answers a body that is not multipart with a 400, not a crash', async () => {
    const request = new Request('http://localhost/api/contribute', {
      method: 'POST',
      headers: { 'content-type': `multipart/form-data; boundary=${BOUNDARY}` },
      body: '--not-the-boundary\r\nrubbish',
    });
    await expect(receive(request)).rejects.toMatchObject({ status: 400 });
  });
});
