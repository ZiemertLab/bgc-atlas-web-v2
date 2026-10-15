import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const { rate, prisma, region, combined } = vi.hoisted(() => ({
  rate: { success: true },
  prisma: { bgc: { findUnique: vi.fn() } },
  region: { read: vi.fn() },
  combined: { lookup: vi.fn(), read: vi.fn() },
}));

vi.mock('@/lib/rate-limit', () => ({
  downloadRateLimit: {},
  DOWNLOAD_REFILL_PER_MINUTE: 5,
  getClientIp: () => '203.0.113.9',
  checkRateLimit: async () => ({
    success: rate.success, limit: 300, remaining: 0, reset: Date.now() + 60_000,
    error: rate.success ? undefined : 'Too many requests. Please try again in 1 minute.',
  }),
}));
vi.mock('@/lib/prisma', () => ({ default: prisma }));
vi.mock('@/lib/bgc-download/read-region', async () => {
  class RegionBusyError extends Error {}
  class RegionNotFoundError extends Error {}
  return { readRegionGbk: region.read, RegionBusyError, RegionNotFoundError };
});

vi.mock('@/lib/export/region-sources', () => ({ exportRegionsByIds: combined.lookup }));
vi.mock('@/lib/bgc-download/combined-archive', () => ({ readCombinedRegion: combined.read }));

const { GET } = await import('./[id]/download/route');
const { RegionBusyError, RegionNotFoundError } = await import('@/lib/bgc-download/read-region');

const ID = '8c9a16f5-cfe5-5d63-b5b4-cd6e77dd4587';
const GBK = `LOCUS       contig_1   12 bp    DNA
FEATURES             Location/Qualifiers
     CDS             1..12
                     /locus_tag="ctg1_1"
                     /translation="MKLV"
ORIGIN
        1 atgaaactgg tg
//
`;
const call = (id: string, format?: string) =>
  GET(new NextRequest(`http://localhost/api/bgcs/${id}/download${format ? `?format=${format}` : ''}`), {
    params: Promise.resolve({ id }),
  });

beforeEach(() => {
  rate.success = true;
  vi.clearAllMocks();
  prisma.bgc.findUnique.mockResolvedValue({
    id: ID, filename: 'MFD01275_contig_5500.region020',
    antismash_run: { id: 'run-1', file_path: '/x/MFD01275.tar.gz' },
  });
  region.read.mockResolvedValue(Buffer.from(GBK));
  combined.lookup.mockResolvedValue([]);
});

describe('GET /api/bgcs/[id]/download from the combined archive', () => {
  it('reads the region by its offset and never opens the run tarball', async () => {
    combined.lookup.mockResolvedValue([{ bgcId: ID, gbkOffset: 1024, gbkLength: 300 }]);
    combined.read.mockResolvedValue(Buffer.from(GBK));
    const res = await call(ID);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(GBK);
    expect(combined.read).toHaveBeenCalledWith(ID, 1024, 300);
    expect(region.read).not.toHaveBeenCalled();
  });

  it('falls back to the run tarball when the offset no longer matches', async () => {
    combined.lookup.mockResolvedValue([{ bgcId: ID, gbkOffset: 1024, gbkLength: 300 }]);
    combined.read.mockRejectedValue(new Error('member is someone-else.gbk'));
    const res = await call(ID);
    expect(res.status).toBe(200);
    expect(region.read).toHaveBeenCalledTimes(1);
  });
});

describe('GET /api/bgcs/[id]/download', () => {
  it('serves the region GenBank as an attachment named after the region', async () => {
    const res = await call(ID);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Disposition')).toBe('attachment; filename="MFD01275_contig_5500.region020.gbk"');
    expect(await res.text()).toBe(GBK);
    expect(region.read).toHaveBeenCalledWith({ runId: 'run-1', archivePath: '/x/MFD01275.tar.gz', filename: 'MFD01275_contig_5500.region020' });
  });

  it('tells the client where it stands with the limiter on a successful download', async () => {
    const res = await call(ID);
    expect(res.status).toBe(200);
    expect(res.headers.get('X-RateLimit-Limit')).toBe('300');
    expect(res.headers.get('X-RateLimit-Remaining')).toBe('0');
    expect(Date.parse(res.headers.get('X-RateLimit-Reset') ?? '')).toBeGreaterThan(Date.now());
  });

  it('derives nucleotide FASTA from the same file', async () => {
    const res = await call(ID, 'fna');
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Disposition')).toContain('.fna"');
    expect(await res.text()).toBe(`>${ID} MFD01275_contig_5500.region020\nATGAAACTGGTG\n`);
  });

  it('derives protein FASTA from the CDS translations', async () => {
    const res = await call(ID, 'faa');
    expect(await res.text()).toBe(`>${ID}|ctg1_1 1..12\nMKLV\n`);
  });

  it.each([['not-a-uuid', 'gbk'], [ID, 'exe']])('refuses id=%s format=%s with 400', async (id, format) => {
    const res = await call(id, format);
    expect(res.status).toBe(400);
    expect(region.read).not.toHaveBeenCalled();
  });

  it('returns 429 with Retry-After before touching the archive', async () => {
    rate.success = false;
    const res = await call(ID);
    expect(res.status).toBe(429);
    expect(Number(res.headers.get('Retry-After'))).toBeGreaterThan(0);
    expect(prisma.bgc.findUnique).not.toHaveBeenCalled();
    expect(combined.read).not.toHaveBeenCalled();
  });

  it('points a client at the limit to the bulk downloads, on the public host', async () => {
    rate.success = false;
    const body = await (await call(ID)).json();
    expect(body.error).toMatch(
      /^Download limit reached: 300 BGC files at once, then 5 a minute, per address\. The next one is available in \d+ seconds \(Retry-After\)\./,
    );
    expect(body.error).toContain('see bulkDownloads');
    expect(Object.keys(body.bulkDownloads)).toEqual(['byProperty', 'byFamily', 'everything', 'fromTheArchive']);
    expect(body.bulkDownloads.everything)
      .toMatch(/^https:\/\/bgc-atlas\.cs\.uni-tuebingen\.de\/downloads\/all_regions_gbk\.tar\.gz /);
    expect(JSON.stringify(body)).not.toContain('localhost');
  });

  it('404s an unknown BGC and a region missing from its archive', async () => {
    prisma.bgc.findUnique.mockResolvedValueOnce(null);
    expect((await call(ID)).status).toBe(404);
    region.read.mockRejectedValueOnce(new RegionNotFoundError('gone'));
    expect((await call(ID)).status).toBe(404);
  });

  it('503s with Retry-After when too many extractions are running', async () => {
    region.read.mockRejectedValueOnce(new RegionBusyError('busy'));
    const res = await call(ID);
    expect(res.status).toBe(503);
    expect(res.headers.get('Retry-After')).toBe('10');
  });

  it('does not echo internal error text in a 500', async () => {
    region.read.mockRejectedValueOnce(new Error('tar exited 2 on /ceph/secret/path'));
    const res = await call(ID);
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe('Could not prepare the download.');
  });
});
