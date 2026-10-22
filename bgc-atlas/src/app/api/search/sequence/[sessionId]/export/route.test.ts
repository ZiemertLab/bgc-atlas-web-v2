import { beforeEach, describe, expect, it, vi } from 'vitest';

/** The results CSV follows the filters on screen, as the GBK zip beside it does. */

const { getAllSessionHits } = vi.hoisted(() => ({ getAllSessionHits: vi.fn(async () => [
  { queryId: '=cmd()', rank: 1, bgcId: null, targetId: 't', cdsLabel: 'c', identity: 90, coverage: 80,
    eValue: 1e-30, bitScore: 100, alignmentLength: 50, queryStart: 1, queryEnd: 50, queryLength: 50,
    targetStart: 1, targetEnd: 50, targetLength: 50 },
]) }));

vi.mock('@/lib/seqsearch/database', async (orig) => ({
  ...(await orig<typeof import('@/lib/seqsearch/database')>()),
  getAllSessionHits,
  getSessionMetadata: async () => ({ sessionId: 's' }),
}));
vi.mock('@/lib/seqsearch/hydrate', () => ({ hydrateBgcs: async () => ({}) }));
vi.mock('@/lib/prisma', () => ({ default: {} }));

const { GET } = await import('./route');
type Req = Parameters<typeof GET>[0];
const SID = '44444444-4444-4444-8444-444444444444';
const call = (query: string) => {
  const url = `http://localhost/api/search/sequence/${SID}/export${query}`;
  return GET(Object.assign(new Request(url), { nextUrl: new URL(url) }) as unknown as Req, { params: Promise.resolve({ sessionId: SID }) });
};

beforeEach(() => getAllSessionHits.mockClear());

describe('GET /api/search/sequence/[sessionId]/export', () => {
  it('passes identity, coverage and the locus through', async () => {
    await call('?minIdentity=60&minCoverage=90&queryFrom=1000&queryTo=2500');
    expect(getAllSessionHits).toHaveBeenCalledWith(SID, { minIdentity: 60, minCoverage: 90, queryFrom: 1000, queryTo: 2500 });
  });

  it('exports the whole session without filters', async () => {
    await call('');
    expect(getAllSessionHits).toHaveBeenCalledWith(SID, { minIdentity: undefined, minCoverage: undefined });
  });

  it('neutralises a query id a spreadsheet would run', async () => {
    const text = await (await call('')).text();
    expect(text.split('\n')[1].startsWith("'=cmd()")).toBe(true);
  });
});
