import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * POST /api/gcfs/[id]/export-gbk: the gates that keep one request from queueing
 * hours of work on the export queue or mailing arbitrary addresses.
 */

const { rate, prisma, addExportJob } = vi.hoisted(() => ({
  rate: { success: true },
  prisma: {
    gcf: { findUnique: vi.fn() },
    bgcGcf: { count: vi.fn() },
    gcfExportJob: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
  },
  addExportJob: vi.fn(async () => ({ id: 'job-1' })),
}));

vi.mock('@/lib/rate-limit', () => ({
  exportRateLimit: {},
  getClientIp: () => '203.0.113.9',
  checkRateLimit: async () => ({
    success: rate.success,
    limit: 20,
    remaining: rate.success ? 19 : 0,
    reset: Date.now() + 60_000,
    error: rate.success ? undefined : 'Too many requests. Please try again in 1 minute.',
  }),
}));
vi.mock('@/lib/prisma', () => ({ default: prisma }));
vi.mock('@/lib/queue', () => ({ addExportJob }));

const { POST } = await import('./[id]/export-gbk/route');
const { GCF_GBK_EXPORT_MAX_MEMBERS } = await import('@/lib/gcf/export-limits');

const ID = '5281d9f5-0000-4000-8000-000000000001';
const call = (id: string, body?: unknown) =>
  POST(
    new NextRequest(`http://localhost/api/gcfs/${id}/export-gbk`, {
      method: 'POST',
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    { params: Promise.resolve({ id }) },
  );

beforeEach(() => {
  rate.success = true;
  vi.clearAllMocks();
  prisma.gcf.findUnique.mockResolvedValue({ id: ID, name: 'GCF-000001' });
  prisma.bgcGcf.count.mockResolvedValue(120);
  prisma.gcfExportJob.findFirst.mockResolvedValue(null);
  prisma.gcfExportJob.create.mockResolvedValue({ id: 'export-1' });
  prisma.gcfExportJob.update.mockResolvedValue({});
});

describe('GCF GBK export gates', () => {
  it('returns 429 with Retry-After when the export limiter refuses, before any DB work', async () => {
    rate.success = false;
    const res = await call(ID);
    expect(res.status).toBe(429);
    expect(Number(res.headers.get('Retry-After'))).toBeGreaterThan(0);
    expect((await res.json()).success).toBe(false);
    expect(prisma.gcf.findUnique).not.toHaveBeenCalled();
    expect(addExportJob).not.toHaveBeenCalled();
  });

  it('returns 400, not a Prisma 500, for a non-UUID id', async () => {
    const res = await call('not-a-uuid');
    expect(res.status).toBe(400);
    expect(prisma.gcf.findUnique).not.toHaveBeenCalled();
  });

  it('refuses a family over the member cap and points at /downloads', async () => {
    prisma.bgcGcf.count.mockResolvedValue(GCF_GBK_EXPORT_MAX_MEMBERS + 1);
    const res = await call(ID);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.downloadsUrl).toBe('/downloads');
    expect(json.cap).toBe(GCF_GBK_EXPORT_MAX_MEMBERS);
    expect(addExportJob).not.toHaveBeenCalled();
  });

  it('accepts a family exactly at the cap', async () => {
    prisma.bgcGcf.count.mockResolvedValue(GCF_GBK_EXPORT_MAX_MEMBERS);
    const res = await call(ID);
    expect(res.status).toBe(200);
    expect(addExportJob).toHaveBeenCalledOnce();
  });

  it.each(['a@x.org, b@y.org', 'not-an-email', 'a@x.org;b@y.org'])(
    'refuses %j as a notification address with no job queued',
    async (email) => {
      const res = await call(ID, { email });
      expect(res.status).toBe(400);
      expect(addExportJob).not.toHaveBeenCalled();
    },
  );

  it('queues with one valid address, trimmed', async () => {
    const res = await call(ID, { email: '  someone@uni-tuebingen.de ' });
    expect(res.status).toBe(200);
    expect(addExportJob).toHaveBeenCalledWith(expect.objectContaining({ userEmail: 'someone@uni-tuebingen.de' }));
  });

  it('does not echo internal error text in a 500', async () => {
    prisma.gcfExportJob.create.mockRejectedValue(new Error('Invalid prisma.gcfExportJob.create() invocation'));
    const res = await call(ID);
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toMatch(/^Something went wrong on our side\. Please try again in a few minutes\. \(ref [0-9a-f]{6}\)$/);
    expect(JSON.stringify(body)).not.toContain('prisma');
  });
});
