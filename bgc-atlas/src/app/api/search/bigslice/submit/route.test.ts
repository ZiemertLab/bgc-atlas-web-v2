import { existsSync, readdirSync, readFileSync } from 'fs';

import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * POST /api/search/bigslice/submit, streamed through lib/contribute/multipart.ts.
 * The queue, the database, the rate limiter and Redis are mocked; uploads land in
 * a temp session directory.
 */

const { sessions, addSearchJob, store, duplicate, refund } = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const fs = require('fs') as typeof import('fs');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const os = require('os') as typeof import('os');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const p = require('path') as typeof import('path');
  const sessions = fs.mkdtempSync(p.join(os.tmpdir(), 'bigslice-submit-'));
  process.env.BIGSLICE_SESSION_DIR = sessions;
  return {
    sessions,
    addSearchJob: vi.fn(async () => ({ id: 'job-1' })),
    store: vi.fn(async () => {}),
    duplicate: { id: null as string | null },
    refund: vi.fn(async () => {}),
  };
});

vi.mock('@/lib/redis-client', () => ({ default: { get: async () => null } }));
// The routes queue through enqueueRecordedSearch, which wraps addSearchJob.
vi.mock('@/lib/queue', () => ({ addSearchJob, enqueueRecordedSearch: addSearchJob }));
vi.mock('@/lib/bigslice/database', () => ({
  storeBigSliceSession: store,
  checkDuplicateBigSliceSearch: async () => duplicate.id,
}));
vi.mock('@/lib/search-submission-limit', () => ({
  chargeSearchSubmission: async () => null,
  refundSearchSubmission: refund,
}));
vi.mock('@/lib/rate-limit', () => ({ getClientIp: () => '10.0.0.1' }));

const { POST } = await import('./route');
type Req = Parameters<typeof POST>[0];

afterAll(async () => (await import('fs')).rmSync(sessions, { recursive: true, force: true }));
beforeEach(() => { addSearchJob.mockClear(); store.mockClear(); refund.mockClear(); duplicate.id = null; });

const regionGbk = (name = 'query') => [
  `LOCUS       ${name}                 120 bp    DNA     linear   UNK 01-JAN-1980`,
  'DEFINITION  test record.',
  'COMMENT     ##antiSMASH-Data-START##',
  '            Version      :: 7.1.0',
  '            ##antiSMASH-Data-END##',
  'FEATURES             Location/Qualifiers',
  '     source          1..120',
  '     protocluster    1..120',
  '                     /category="RiPP"',
  '                     /product="lassopeptide"',
  '     region          1..120',
  '                     /contig_edge="False"',
  '                     /product="lassopeptide"',
  '                     /region_number="1"',
  '     CDS             1..120',
  '                     /locus_tag="ctg1_1"',
  '                     /translation="MKTAYIAKQRQISFVKSHFS"',
  'ORIGIN',
  '        1 atgaaaacag cgtatattgc gaaacagcgt cagattagct ttgtgaaaag ccattttagc',
  '       61 atgaaaacag cgtatattgc gaaacagcgt cagattagct ttgtgaaaag ccattttagc',
  '//',
  '',
].join('\n');

const submit = async (files: { name: string; content: string; type?: string }[]) => {
  const form = new FormData();
  for (const f of files) form.append('files', new File([f.content], f.name, { type: f.type ?? 'text/plain' }));
  const req = new Request('http://localhost/api/search/bigslice/submit', { method: 'POST', body: form });
  const body = await req.arrayBuffer();
  const res = await POST(new Request('http://localhost/api/search/bigslice/submit', {
    method: 'POST',
    headers: { 'content-type': req.headers.get('content-type')!, 'content-length': String(body.byteLength) },
    body,
  }) as unknown as Req);
  return { status: res.status, json: await res.json() as Record<string, unknown> };
};

const sessionDirs = () => readdirSync(sessions);

describe('POST /api/search/bigslice/submit', () => {
  it('stores each file under its query name, maps it back, and queues one job', async () => {
    const before = sessionDirs().length;
    const { status, json } = await submit([
      { name: 'my sample.region001.gbk', content: regionGbk('a') },
      { name: 'other.region002.gbk', content: regionGbk('b') },
    ]);
    expect(status).toBe(200);
    expect(addSearchJob).toHaveBeenCalledTimes(1);
    const job = (addSearchJob.mock.calls[0] as unknown as [{ sessionId: string; genbankFiles: string[] }])[0];
    expect(json.sessionId).toBe(job.sessionId);
    // The record first, carrying the id the job is queued under (the session's).
    expect((store.mock.calls[0] as unknown as [{ jobId: string }])[0].jobId).toBe(job.sessionId);
    expect(store.mock.invocationCallOrder[0]).toBeLessThan(addSearchJob.mock.invocationCallOrder[0]);
    expect(job.genbankFiles).toHaveLength(2);
    for (const file of job.genbankFiles) expect(existsSync(file)).toBe(true);
    const map = JSON.parse(readFileSync(`${sessions}/${job.sessionId}/filename_map.json`, 'utf8'));
    expect(Object.values(map).sort()).toEqual(['my sample.region001.gbk', 'other.region002.gbk']);
    expect(Object.keys(map).every((q) => job.genbankFiles.some((f) => f.endsWith(`/${q}`)))).toBe(true);
    expect((store.mock.calls[0] as unknown as [{ numFiles: number }])[0].numFiles).toBe(2);
    expect(sessionDirs().length).toBe(before + 1);
    expect(refund).not.toHaveBeenCalled();
  });

  it('keeps two uploads that share a name apart, under distinct names', async () => {
    const { status } = await submit([
      { name: 'region001.gbk', content: regionGbk('a') },
      { name: 'region001.gbk', content: regionGbk('b') },
      { name: 'region001.gbk', content: regionGbk('c') },
    ]);
    expect(status).toBe(200);
    const job = (addSearchJob.mock.calls[0] as unknown as [{ sessionId: string; genbankFiles: string[] }])[0];
    const map = JSON.parse(readFileSync(`${sessions}/${job.sessionId}/filename_map.json`, 'utf8'));
    expect(Object.values(map).sort()).toEqual(['region001.gbk', 'region001.gbk (2)', 'region001.gbk (3)']);
    expect(new Set(Object.keys(map)).size).toBe(3);
  });

  it.each([
    ['no files', [], 400, /No files provided/],
    ['an empty file', [{ name: 'x.region001.gbk', content: '' }], 400, /is empty/],
    ['a wrong extension', [{ name: 'x.fasta', content: regionGbk() }], 400, /GenBank extension/],
    ['an unsupported type', [{ name: 'x.gbk', content: regionGbk(), type: 'image/png' }], 400, /unsupported content type/],
    ['FASTA under a .gbk name', [{ name: 'x.gbk', content: '>q\nMKV\n' }], 400, /is FASTA, not GenBank/],
    ['an EMBL file', [{ name: 'x.gbk', content: 'ID   X; SV 1;\n' }], 400, /EMBL format/],
    ['no LOCUS header', [{ name: 'x.gbk', content: 'hello\n' }], 400, /missing the required LOCUS/],
    ['a file BiG-SLiCE finds no BGC in', [{ name: 'x.gbk', content: regionGbk().replace(/ {5}region[\s\S]*?region_number="1"\n/, '') }], 400, /./],
  ] as const)('refuses %s, keeps nothing and refunds the slot', async (_label, files, code, message) => {
    const before = sessionDirs().length;
    const { status, json } = await submit(files as unknown as { name: string; content: string; type?: string }[]);
    expect(status).toBe(code);
    expect(String(json.error)).toMatch(message);
    expect(addSearchJob).not.toHaveBeenCalled();
    expect(sessionDirs().length).toBe(before);
    expect(refund).toHaveBeenCalledTimes(1);
  });

  it('refuses more than 100 files', async () => {
    const files = Array.from({ length: 101 }, (_, i) => ({ name: `f${i}.region001.gbk`, content: regionGbk(`r${i}`) }));
    const { status, json } = await submit(files);
    expect(status).toBe(400);
    expect(String(json.error)).toMatch(/Too many files \(101\)/);
    expect(addSearchJob).not.toHaveBeenCalled();
  });

  it('answers a repeat of a recent search with that session, queueing nothing', async () => {
    duplicate.id = 'earlier-session';
    const before = sessionDirs().length;
    const { status, json } = await submit([{ name: 'a.region001.gbk', content: regionGbk() }]);
    expect(status).toBe(200);
    expect(json).toMatchObject({ success: true, sessionId: 'earlier-session', duplicateSession: 'earlier-session' });
    expect(addSearchJob).not.toHaveBeenCalled();
    expect(sessionDirs().length).toBe(before);
  });

  it('streams a large file to disk without holding the upload in memory', async () => {
    // A valid region whose ORIGIN is ~45 MB, sent as a stream so the test does not
    // hold it either. formData() held every byte before the first check ran.
    const line = '        1 atgaaaacag cgtatattgc gaaacagcgt cagattagct ttgtgaaaag ccattttagc\n';
    const [headPart, tail] = regionGbk().split('ORIGIN\n');
    const boundary = '----bigslice-test';
    const enc = new TextEncoder();
    const lines = Math.ceil((45 * 1024 * 1024) / line.length);
    async function* chunks() {
      yield enc.encode(`--${boundary}\r\nContent-Disposition: form-data; name="files"; filename="big.region001.gbk"\r\n`
        + `Content-Type: text/plain\r\n\r\n${headPart}ORIGIN\n`);
      const block = enc.encode(line.repeat(1000));
      for (let i = 0; i < lines; i += 1000) yield block;
      yield enc.encode(`${tail.slice(tail.indexOf('//'))}\r\n--${boundary}--\r\n`);
    }
    const it = chunks();
    const length = 4096 + Math.ceil(lines / 1000) * line.length * 1000;
    const body = new ReadableStream<Uint8Array>({
      async pull(c) { const { value, done } = await it.next(); if (done) c.close(); else c.enqueue(value); },
    });
    const before = process.memoryUsage().arrayBuffers;
    let peak = before;
    const timer = setInterval(() => { peak = Math.max(peak, process.memoryUsage().arrayBuffers); }, 5);
    let status: number;
    try {
      const res = await POST(new Request('http://localhost/api/search/bigslice/submit', {
        method: 'POST',
        headers: { 'content-type': `multipart/form-data; boundary=${boundary}`, 'content-length': String(length) },
        body,
        // @ts-expect-error -- undici needs this for a stream body; the DOM type lacks it
        duplex: 'half',
      }) as unknown as Req);
      status = res.status;
    } finally {
      clearInterval(timer);
    }
    expect(status).toBe(200);
    expect(peak - before).toBeLessThan(30 * 1024 * 1024);
  }, 60_000);
});
