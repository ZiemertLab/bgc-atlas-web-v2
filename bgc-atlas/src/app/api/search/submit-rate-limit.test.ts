import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { rmSync } from 'fs';
import { NextRequest } from 'next/server';

/**
 * The search submit routes charge the 10-an-hour search limit only for searches
 * they queue.
 *
 * A reader retrying a rejected file must not be locked out of both search tools:
 * the routes refund the slot of any request that ends without a job, and a looser
 * attempt limit (60/hour) counts every request so rejected uploads stay bounded.
 *
 * The limiters are in-memory fakes with Upstash's semantics, read from its
 * single-region sliding-window script: a positive rate is checked against the
 * limit and rejected without incrementing; a negative rate (refund) skips the
 * check and decrements.
 */

const { sessionRoot, limiters, queue, seqDb, bigsliceDb } = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const fs = require('fs') as typeof import('fs');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const os = require('os') as typeof import('os');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const path = require('path') as typeof import('path');
  const sessionRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'search-submit-test-'));
  // Read at module load by both routes.
  process.env.SESSION_DIR = path.join(sessionRoot, 'seq');
  process.env.BIGSLICE_SESSION_DIR = path.join(sessionRoot, 'bigslice');

  function fakeLimiter(tokens: number) {
    const used = new Map<string, number>();
    return {
      used,
      limit: async (id: string, opts?: { rate?: number }) => {
        const rate = opts?.rate ?? 1;
        const count = used.get(id) ?? 0;
        const reset = Date.now() + 3_600_000;
        if (rate > 0 && count >= tokens) {
          return { success: false, limit: tokens, remaining: 0, reset, pending: Promise.resolve() };
        }
        used.set(id, count + rate);
        return { success: true, limit: tokens, remaining: tokens - count - rate, reset, pending: Promise.resolve() };
      },
    };
  }

  return {
    sessionRoot,
    limiters: { search: fakeLimiter(10), attempt: fakeLimiter(60) },
    queue: { addSearchJob: vi.fn() },
    seqDb: { storeSearchSession: vi.fn(), checkDuplicateSearch: vi.fn() },
    bigsliceDb: { storeBigSliceSession: vi.fn(), checkDuplicateBigSliceSearch: vi.fn() },
  };
});

vi.mock('@/lib/redis-client', () => ({ default: {} }));
vi.mock('@/lib/alerts/rate-limit-blocks', () => ({ recordRateLimitBlock: vi.fn() }));
vi.mock('@/lib/prisma', () => ({ default: {}, prisma: {} }));
vi.mock('@/lib/rate-limit', async (orig) => ({
  ...(await orig<typeof import('@/lib/rate-limit')>()),
  searchRateLimit: limiters.search,
  searchAttemptRateLimit: limiters.attempt,
}));
// The routes queue through enqueueRecordedSearch, which wraps addSearchJob.
vi.mock('@/lib/queue', () => ({
  ...queue,
  enqueueRecordedSearch: (...args: unknown[]) => queue.addSearchJob(...args),
}));
vi.mock('@/lib/seqsearch/database', () => seqDb);
vi.mock('@/lib/bigslice/database', () => bigsliceDb);

import { POST as submitSequence } from './sequence/submit/route';
import { POST as submitBigSlice } from './bigslice/submit/route';

const IP = '203.0.113.7';
const PROTEIN = '>query\n' + 'MKTAYIAKQRQISFVKSHFSRQLEERLGLIEVQAPILSRVGDGTQDNLSGAEKAVQVKVKALPDAQFEVVHSLAKWKRQTLGQHDFSAGEGLYTHMKALRPDEDRLSPLHSVYVDQWDWERVMGDGERQFSTLKSTVEAIWAGIKATEAAVSEEFGLAPFLPDQIHFVHSQELLSRYPDLDAKGRERAIAKDLGAVFLVGIGGKLSDGHRHDVRAPDYDDWSAETYLLLEEPIEN';
// An antiSMASH region record, the only kind the route queues (lib/bigslice/genbank-usability.ts).
const GENBANK = [
  'LOCUS       query                    60 bp    DNA     linear   UNK 01-JAN-1980',
  'COMMENT     ##antiSMASH-Data-START##',
  '            Version      :: 7.0.0',
  '            ##antiSMASH-Data-END##',
  'FEATURES             Location/Qualifiers',
  '     source          1..60',
  '     protocluster    1..60',
  '                     /product="lassopeptide"',
  '     region          1..60',
  '                     /contig_edge="False"',
  '                     /product="lassopeptide"',
  'ORIGIN',
  '        1 atgaaaacag cgtatattgc gaaacagcgt cagattagct ttgtgaaaag ccattttagc',
  '//',
  '',
].join('\n');

function sequenceRequest(sequence: string, extra: Record<string, unknown> = {}) {
  return new NextRequest('http://localhost/api/search/sequence/submit', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-real-ip': IP },
    body: JSON.stringify({ sequence, ...extra }),
  });
}

async function bigsliceRequest(name: string, content: string) {
  const form = new FormData();
  form.append('files', new File([content], name, { type: '' }));
  // Let Request encode the multipart body, then hand the route the explicit
  // Content-Length it requires.
  const encoded = new Request('http://localhost', { method: 'POST', body: form });
  const body = new Uint8Array(await encoded.arrayBuffer());
  return new NextRequest('http://localhost/api/search/bigslice/submit', {
    method: 'POST',
    headers: {
      'content-type': encoded.headers.get('content-type')!,
      'content-length': String(body.byteLength),
      'x-real-ip': IP,
    },
    body,
  });
}

const searchesCharged = () => limiters.search.used.get(IP) ?? 0;
const attemptsCharged = () => limiters.attempt.used.get(IP) ?? 0;

beforeEach(() => {
  limiters.search.used.clear();
  limiters.attempt.used.clear();
  queue.addSearchJob.mockReset().mockResolvedValue({ id: 'job-1' });
  seqDb.checkDuplicateSearch.mockReset().mockResolvedValue(null);
  seqDb.storeSearchSession.mockReset().mockResolvedValue(undefined);
  bigsliceDb.checkDuplicateBigSliceSearch.mockReset().mockResolvedValue(null);
  bigsliceDb.storeBigSliceSession.mockReset().mockResolvedValue(undefined);
});

afterAll(() => {
  rmSync(sessionRoot, { recursive: true, force: true });
});

describe('sequence search submissions', () => {
  it('keeps the slot of a search it queued', async () => {
    const res = await submitSequence(sequenceRequest(PROTEIN));
    expect(res.status).toBe(200);
    expect(queue.addSearchJob).toHaveBeenCalledTimes(1);
    expect(searchesCharged()).toBe(1);
    expect(attemptsCharged()).toBe(1);
  });

  it('refunds a rejected submission', async () => {
    const res = await submitSequence(sequenceRequest('   '));
    expect(res.status).toBe(400);
    expect(searchesCharged()).toBe(0);
    expect(attemptsCharged()).toBe(1);
  });

  it('refunds a duplicate of a recent search, which runs nothing', async () => {
    seqDb.checkDuplicateSearch.mockResolvedValue('earlier-session');
    const res = await submitSequence(sequenceRequest(PROTEIN));
    expect(res.status).toBe(200);
    expect((await res.json()).duplicateSession).toBe('earlier-session');
    expect(queue.addSearchJob).not.toHaveBeenCalled();
    expect(searchesCharged()).toBe(0);
  });

  it('refunds a submission that failed on our side', async () => {
    queue.addSearchJob.mockRejectedValue(new Error('redis down'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await submitSequence(sequenceRequest(PROTEIN));
    expect(res.status).toBe(500);
    expect(searchesCharged()).toBe(0);
  });

  it('rejects a non-numeric threshold before queueing anything', async () => {
    // A string maxResults passed the old range check (NaN compares false) and reached the
    // remote shell that runs DIAMOND.
    for (const extra of [
      { maxResults: '1 $(touch /tmp/pwned)' },
      { minIdentity: '50; id' },
      { eValue: '1e-5`id`' },
      { sequenceType: 'protein; id' },
    ]) {
      const res = await submitSequence(sequenceRequest(PROTEIN, extra));
      expect(res.status).toBe(400);
    }
    expect(queue.addSearchJob).not.toHaveBeenCalled();
    expect(searchesCharged()).toBe(0);
  });

  it('refuses a body over the size cap before reading it, and refunds the slot', async () => {
    const req = new NextRequest('http://localhost/api/search/sequence/submit', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-real-ip': IP,
        'content-length': String(32 * 1024 * 1024 + 1),
      },
      body: JSON.stringify({ sequence: PROTEIN }),
    });
    const res = await submitSequence(req);
    expect(res.status).toBe(413);
    expect(queue.addSearchJob).not.toHaveBeenCalled();
    expect(searchesCharged()).toBe(0);
    expect(attemptsCharged()).toBe(1);
  });

  it('accepts a body exactly at the size cap', async () => {
    const req = new NextRequest('http://localhost/api/search/sequence/submit', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-real-ip': IP,
        'content-length': String(32 * 1024 * 1024),
      },
      body: JSON.stringify({ sequence: PROTEIN }),
    });
    expect((await submitSequence(req)).status).toBe(200);
  });

  it('asks for a duplicate with the same parameters, not the same sequence alone', async () => {
    // A resubmission at other thresholds used to get the earlier session back.
    await submitSequence(sequenceRequest(PROTEIN, { minIdentity: 30, minCoverage: 60, maxResults: 200, eValue: '1e-3' }));
    expect(seqDb.checkDuplicateSearch).toHaveBeenCalledWith(
      expect.any(String),
      { sequenceType: 'protein', eValue: 0.001, minIdentity: 30, minCoverage: 60, maxResults: 200 },
      24,
    );
  });

  it('queues numeric thresholds as numbers', async () => {
    const res = await submitSequence(sequenceRequest(PROTEIN, { maxResults: '250', minIdentity: 70 }));
    expect(res.status).toBe(200);
    expect(queue.addSearchJob.mock.calls[0][0].parameters).toMatchObject({ maxResults: 250, identity: 70 });
  });

  it('turns away the eleventh queued search without refunding a slot it never charged', async () => {
    for (let i = 0; i < 10; i++) {
      expect((await submitSequence(sequenceRequest(PROTEIN))).status).toBe(200);
    }
    const res = await submitSequence(sequenceRequest(PROTEIN));
    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBeTruthy();
    // A refund here would hand back one of the ten real searches.
    expect(searchesCharged()).toBe(10);
  });
});

describe('BiG-SLiCE submissions', () => {
  it('refunds a file rejected for a missing LOCUS header', async () => {
    const res = await submitBigSlice(await bigsliceRequest('region001.gbk', 'not a genbank record\n'));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/missing the required LOCUS header/);
    expect(searchesCharged()).toBe(0);
    expect(attemptsCharged()).toBe(1);
  });

  it('refunds a GenBank file that is not antiSMASH output', async () => {
    const plain = GENBANK.replace(/^COMMENT.*\n(?: {12}.*\n)*/m, '').replace(/^ {5}(protocluster|region)[\s\S]*?(?=^ORIGIN)/m, '');
    const res = await submitBigSlice(await bigsliceRequest('gene.gbk', plain));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/is plain GenBank, not antiSMASH output/);
    expect(queue.addSearchJob).not.toHaveBeenCalled();
    expect(searchesCharged()).toBe(0);
  });

  it('names FASTA and EMBL uploads rather than calling them broken GenBank', async () => {
    const fasta = await submitBigSlice(await bigsliceRequest('query.gbk', '>q\nMKTAYIAKQRQISFVKSHFS\n'));
    expect((await fasta.json()).error).toMatch(/is FASTA, not GenBank.*Sequence similarity/);
    const embl = await submitBigSlice(await bigsliceRequest('query.gbk', 'ID   XXX; XXX; linear; genomic DNA; XXX; XXX; 60 BP.\n'));
    expect((await embl.json()).error).toMatch(/is in EMBL format/);
    expect(searchesCharged()).toBe(0);
  });

  it('rejects a MIBiG download as it is, without editing it', async () => {
    const mibig = GENBANK
      .replace('Version      :: 7.0.0', 'Version      :: False')
      .replace(/ {5}protocluster[^\n]*\n[^\n]*\n/, '     subregion       1..60\n                     /aStool="mibig"\n                     /label="NRPS"\n');
    const res = await submitBigSlice(await bigsliceRequest('BGC0002750.gbk', mibig));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/is a MIBiG GenBank download/);
    expect(queue.addSearchJob).not.toHaveBeenCalled();
    expect(searchesCharged()).toBe(0);
  });

  it('keeps the slot of a search it queued', async () => {
    const res = await submitBigSlice(await bigsliceRequest('region001.gbk', GENBANK));
    expect(res.status).toBe(200);
    expect(queue.addSearchJob).toHaveBeenCalledTimes(1);
    expect(searchesCharged()).toBe(1);
  });

  it('lets a reader who retried a bad file twelve times still search', async () => {
    for (let i = 0; i < 12; i++) {
      const res = await submitBigSlice(await bigsliceRequest('region001.gbk', 'not a genbank record\n'));
      expect(res.status).toBe(400);
    }
    expect(searchesCharged()).toBe(0);
    // The same budget covers sequence search, which they then tried.
    expect((await submitSequence(sequenceRequest(PROTEIN))).status).toBe(200);
  });
});

describe('the attempt limit', () => {
  it('bounds rejected submissions at 60 an hour, and does not touch the search budget when it bites', async () => {
    for (let i = 0; i < 60; i++) {
      expect((await submitSequence(sequenceRequest('   '))).status).toBe(400);
    }
    const res = await submitSequence(sequenceRequest('   '));
    expect(res.status).toBe(429);
    expect(attemptsCharged()).toBe(60);
    expect(searchesCharged()).toBe(0);
  });
});
