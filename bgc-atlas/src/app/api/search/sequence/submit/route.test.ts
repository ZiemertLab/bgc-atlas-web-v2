import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * POST /api/search/sequence/submit: input it must refuse before queueing.
 * The queue, the database and the rate limiter are mocked.
 */

const { addSearchJob, refund } = vi.hoisted(() => ({
  addSearchJob: vi.fn(async () => ({ id: 'job-1' })),
  refund: vi.fn(async () => {}),
}));

// The routes queue through enqueueRecordedSearch, which wraps addSearchJob.
vi.mock('@/lib/queue', () => ({ addSearchJob, enqueueRecordedSearch: addSearchJob }));
vi.mock('@/lib/seqsearch/database', () => ({
  storeSearchSession: vi.fn(async () => {}),
  checkDuplicateSearch: vi.fn(async () => null),
}));
vi.mock('@/lib/search-submission-limit', () => ({
  chargeSearchSubmission: async () => null,
  refundSearchSubmission: refund,
}));
vi.mock('@/lib/rate-limit', () => ({ getClientIp: () => '10.0.0.1' }));
vi.mock('fs/promises', async (orig) => ({
  ...(await orig<typeof import('fs/promises')>()),
  mkdir: vi.fn(async () => undefined),
  writeFile: vi.fn(async () => undefined),
}));

const { POST } = await import('./route');
type Req = Parameters<typeof POST>[0];

beforeEach(() => { addSearchJob.mockClear(); refund.mockClear(); });

const submit = async (fields: Record<string, string>) => {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  const res = await POST(new Request('http://localhost/api/search/sequence/submit', { method: 'POST', body: form }) as unknown as Req);
  return { status: res.status, json: await res.json() as Record<string, unknown> };
};

const protein = 'MLRRKLLYLLLTVPLYAWLISMTKIELVALFLGYVFIFSQLNRIQEQSILEVCIFSISIELF';
const dna = 'ATGCGTACGTTAGCATCGATCGATGCTAGCTAGCTAGCATCGATCGATCGATGCATGCATGCTAGCTAGC';

const record = (name: string) => [
  `LOCUS       ${name}                 60 bp    DNA     linear   UNK 01-JAN-1980`,
  'FEATURES             Location/Qualifiers',
  '     CDS             1..60',
  '                     /locus_tag="g1"',
  `                     /translation="${protein}"`,
  'ORIGIN',
  '        1 atgaaaacag cgtatattgc gaaacagcgt cagattagct ttgtgaaaag ccattttagc',
  '//',
].join('\n');

describe('POST /api/search/sequence/submit refusals', () => {
  it('refuses a GenBank file of several records instead of searching the first', async () => {
    const { status, json } = await submit({ sequence: `${record('c1')}\n${record('c2')}\n${record('c3')}` });
    expect(status).toBe(400);
    expect(String(json.error)).toMatch(/has 3 records; sequence search reads one/);
    expect(addSearchJob).not.toHaveBeenCalled();
    expect(refund).toHaveBeenCalledTimes(1);
  });

  it('writes the session record before queueing, under the job id it is queued with', async () => {
    const db = vi.mocked(await import('@/lib/seqsearch/database'));
    db.storeSearchSession.mockClear();
    const { status, json } = await submit({ sequence: `>q\n${protein}` });
    expect(status).toBe(200);
    const stored = db.storeSearchSession.mock.calls[0][0];
    expect(stored.jobId).toBe(json.sessionId);
    expect(db.storeSearchSession.mock.invocationCallOrder[0]).toBeLessThan(addSearchJob.mock.invocationCallOrder[0]);
  });

  it('still searches a single-record GenBank file', async () => {
    const { status } = await submit({ sequence: record('c1') });
    expect(status).toBe(200);
    expect(addSearchJob).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['DNA sent as protein', 'protein', `>q\n${dna}`, /You chose protein, but this looks like a nucleotide sequence/],
    ['protein sent as nucleotide', 'dna', `>q\n${protein}`, /You chose nucleotide, but this looks like a protein sequence/],
  ])('refuses %s', async (_label, sequenceType, sequence, message) => {
    const { status, json } = await submit({ sequence, sequenceType });
    expect(status).toBe(400);
    expect(String(json.error)).toMatch(message);
    expect(addSearchJob).not.toHaveBeenCalled();
  });

  it('accepts a matching type, and auto-detect', async () => {
    expect((await submit({ sequence: `>q\n${protein}`, sequenceType: 'protein' })).status).toBe(200);
    expect((await submit({ sequence: `>q\n${dna}`, sequenceType: 'dna' })).status).toBe(200);
    expect((await submit({ sequence: `>q\n${dna}`, sequenceType: 'auto' })).status).toBe(200);
  });
});
