import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * HEAD on a single-BGC download. Next runs the GET handler for it and drops the
 * body, so a HEAD did the whole region read (up to 72 s of tar on the run-tarball
 * path) and spent one of the client's downloads.
 */

const { findUnique, limiter, readRegion, combined } = vi.hoisted(() => ({
  findUnique: vi.fn(),
  limiter: vi.fn(async () => ({ success: true, limit: 300, remaining: 299, reset: Date.now() + 60_000 })),
  readRegion: vi.fn(async () => Buffer.from('LOCUS x\n//\n')),
  combined: vi.fn(async () => null),
}));

vi.mock('@/lib/prisma', () => ({ default: { bgc: { findUnique } } }));
vi.mock('@/lib/bgc/redirect', () => ({ findBgcRedirect: async () => null, redirectToTwin: () => new Response(null) }));
vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: limiter, downloadRateLimit: {}, DOWNLOAD_REFILL_PER_MINUTE: 5, getClientIp: () => '10.0.0.1',
}));
vi.mock('@/lib/bgc-download/read-region', () => ({
  readRegionGbk: readRegion, RegionBusyError: class extends Error {}, RegionNotFoundError: class extends Error {},
}));
vi.mock('@/lib/bgc-download/combined-archive', () => ({ readCombinedRegion: combined }));
vi.mock('@/lib/export/region-sources', () => ({ exportRegionsByIds: async () => [] }));
vi.mock('@/lib/releases/read', () => ({ readReleases: async () => [] }));

const { GET } = await import('./route');
type Req = Parameters<typeof GET>[0];
const ID = '22222222-2222-4222-8222-222222222222';
const call = (method: string) => GET(
  Object.assign(new Request(`http://localhost/api/bgcs/${ID}/download?format=gbk`, { method }), {
    nextUrl: new URL(`http://localhost/api/bgcs/${ID}/download?format=gbk`),
  }) as unknown as Req,
  { params: Promise.resolve({ id: ID }) },
);

beforeEach(() => {
  findUnique.mockReset().mockResolvedValue({ id: ID, filename: 'GB_X.region001', antismash_run: { id: 'r', file_path: '/x' } });
  limiter.mockClear(); readRegion.mockClear(); combined.mockClear();
});

describe('GET /api/bgcs/[id]/download on HEAD', () => {
  it('answers from the row: no region read, no download spent', async () => {
    const res = await call('HEAD');
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Disposition')).toMatch(/GB_X\.region001\.gbk/);
    expect(readRegion).not.toHaveBeenCalled();
    expect(combined).not.toHaveBeenCalled();
    expect(limiter).not.toHaveBeenCalled();
  });

  it('answers 404 for a BGC that does not exist', async () => {
    findUnique.mockResolvedValue(null);
    expect((await call('HEAD')).status).toBe(404);
  });

  it('still reads and charges on GET', async () => {
    const res = await call('GET');
    expect(res.status).toBe(200);
    expect(limiter).toHaveBeenCalledTimes(1);
    expect(readRegion).toHaveBeenCalledTimes(1);
  });
});
