import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

// The limiter is Redis shared with the running site: stub the gate, as the other
// export-route tests do, so this suite never spends the live export budget.
vi.mock('@/lib/rate-limit', () => ({
  exportRateLimit: {},
  getClientIp: () => '127.0.0.1',
  checkRateLimit: async () => ({ success: true, limit: 10, remaining: 9, reset: 0 }),
}));

const { addExportJob, createRecord, updateRecord, getSessionMetadata, getHitBgcIds } = vi.hoisted(() => ({
  addExportJob: vi.fn(async () => ({ id: 'job-1' })),
  createRecord: vi.fn(async () => ({})),
  updateRecord: vi.fn(async () => ({})),
  getSessionMetadata: vi.fn(),
  getHitBgcIds: vi.fn(),
}));
vi.mock('@/lib/queue', () => ({ addExportJob }));
vi.mock('@/lib/prisma', () => ({
  default: { gcfExportJob: { create: createRecord, update: updateRecord } },
}));
vi.mock('@/lib/seqsearch/database', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/seqsearch/database')>();
  return { parseHitFilters: real.parseHitFilters, getSessionMetadata, getHitBgcIds };
});

import { POST } from './route';

const SESSION = '6fff026f-9dba-4ed4-b933-459a2d0dda55';

function post(body: unknown, sessionId = SESSION) {
  const req = new NextRequest(`http://localhost/api/search/sequence/${sessionId}/export-gbk`, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
  return POST(req, { params: Promise.resolve({ sessionId }) });
}

beforeEach(() => {
  vi.clearAllMocks();
  getSessionMetadata.mockResolvedValue({ status: 'completed' });
  getHitBgcIds.mockResolvedValue(['a', 'b', 'c']);
});

describe('POST /api/search/sequence/[sessionId]/export-gbk', () => {
  it('records a regions job for the filtered hit BGCs and queues it', async () => {
    const res = await post({
      email: ' reader@example.org ',
      filters: { minIdentity: 60, minCoverage: 'x', queryFrom: 100 }, // junk and a half locus dropped
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ success: true, count: 3, matched: 3 });

    expect(getHitBgcIds).toHaveBeenCalledWith(SESSION, { minIdentity: 60, minCoverage: undefined });
    const record = (createRecord.mock.calls[0] as unknown as [{ data: Record<string, unknown> }])[0].data;
    expect(record).toMatchObject({
      kind: 'regions',
      total_bgcs: 3,
      user_email: 'reader@example.org',
      search_href: `/search/results/${SESSION}`,
      search_query: { source: 'sequence', sessionId: SESSION },
    });
    expect(addExportJob).toHaveBeenCalledWith(expect.objectContaining({
      type: 'sequence-gbk-export', exportJobId: body.exportJobId, sessionId: SESSION, userEmail: 'reader@example.org',
    }));
  });

  it('refuses a search that has not finished, before recording anything', async () => {
    getSessionMetadata.mockResolvedValue({ status: 'running' });
    expect((await post({})).status).toBe(409);
    expect(createRecord).not.toHaveBeenCalled();
    expect(addExportJob).not.toHaveBeenCalled();
  });

  it('refuses when no hit lands in an Atlas BGC', async () => {
    getHitBgcIds.mockResolvedValue([]);
    expect((await post({})).status).toBe(400);
    expect(createRecord).not.toHaveBeenCalled();
  });

  it('refuses a list of addresses rather than mailing all of them', async () => {
    expect((await post({ email: 'a@b.org, c@d.org' })).status).toBe(400);
    expect(createRecord).not.toHaveBeenCalled();
  });

  it('404s an unknown session and 400s a malformed id', async () => {
    getSessionMetadata.mockResolvedValue(null);
    expect((await post({})).status).toBe(404);
    expect((await post({}, 'not-a-uuid')).status).toBe(400);
  });

  it('marks the record failed when the job cannot be queued', async () => {
    addExportJob.mockRejectedValueOnce(new Error('redis down'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect((await post({})).status).toBe(500);
    expect(updateRecord).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'failed' }),
    }));
  });
});
