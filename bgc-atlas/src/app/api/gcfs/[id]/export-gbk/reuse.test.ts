import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Asking for a GCF export already made or running within the hour reuses it. The
 * reader's email used to be dropped on that path: the dialog promised a mail and
 * nobody was mailed.
 */

const { recent, updateMany, ready } = vi.hoisted(() => ({
  recent: { current: null as Record<string, unknown> | null },
  updateMany: vi.fn(async () => ({ count: 1 })),
  ready: vi.fn(async () => {}),
}));

vi.mock('@/lib/prisma', () => ({
  default: {
    gcf: { findUnique: async () => ({ id: 'g1', name: 'GCF-v2b6-000006' }) },
    bgcGcf: { count: async () => 44 },
    gcfExportJob: { findFirst: async () => recent.current, updateMany },
  },
}));
vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: async () => ({ success: true, limit: 20, remaining: 19, reset: Date.now() }),
  exportRateLimit: {}, getClientIp: () => '10.0.0.1',
}));
vi.mock('@/lib/queue', () => ({ addExportJob: vi.fn() }));
vi.mock('@/lib/mail/export-notification', () => ({ sendExportReadyEmail: ready }));

const { POST } = await import('./route');
type Req = Parameters<typeof POST>[0];
const GCF = '51799eb7-32e7-5596-b5da-c0f980df67e0';
const call = async (email?: string) => {
  const res = await POST(
    new Request(`http://localhost/api/gcfs/${GCF}/export-gbk`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(email ? { email } : {}),
    }) as unknown as Req,
    { params: Promise.resolve({ id: GCF }) },
  );
  return { status: res.status, json: await res.json() as Record<string, unknown> };
};

beforeEach(() => { updateMany.mockReset().mockResolvedValue({ count: 1 }); ready.mockClear(); });

describe('reusing a recent GCF export', () => {
  it('mails a reader at once when the reused export is finished', async () => {
    recent.current = { id: 'e1', job_id: 'e1', status: 'completed', total_bgcs: 44, missing_files: 0 };
    const { json } = await call('a@example.org');
    expect(json).toMatchObject({ reused: true, emailed: true });
    expect(ready).toHaveBeenCalledWith({ to: 'a@example.org', exportJobId: 'e1', what: 'GCF-v2b6-000006' }, 44, 0);
  });

  it('attaches the reader to a running export that has no address yet', async () => {
    recent.current = { id: 'e2', job_id: 'e2', status: 'running' };
    const { json } = await call('a@example.org');
    expect(json).toMatchObject({ existing: true, emailRecorded: true });
    expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ id: 'e2' }), data: { user_email: 'a@example.org' } }));
  });

  it('says so when someone else is already on the running export', async () => {
    recent.current = { id: 'e3', job_id: 'e3', status: 'pending' };
    updateMany.mockResolvedValue({ count: 0 });
    const { json } = await call('b@example.org');
    expect(json).toMatchObject({ existing: true, emailRecorded: false });
    expect(String(json.message)).toMatch(/no email will be sent/);
  });

  it('changes nothing without an address', async () => {
    recent.current = { id: 'e4', job_id: 'e4', status: 'running' };
    await call();
    expect(updateMany).not.toHaveBeenCalled();
    expect(ready).not.toHaveBeenCalled();
  });
});
