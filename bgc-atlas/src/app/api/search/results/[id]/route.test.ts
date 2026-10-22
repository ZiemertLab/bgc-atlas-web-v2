import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * A session that does not exist is a 404; a database that did not answer is a 5xx.
 *
 * The results page stops polling for good on a 404 and retries a 5xx, so the two
 * must not be confused: the metadata lookups used to catch every error and return
 * null, and a statement timeout or a DB blip showed "Session not found" on a search
 * that was still running.
 */

const { queryRaw } = vi.hoisted(() => ({ queryRaw: vi.fn() }));
vi.mock('@/lib/prisma', () => ({ default: { $queryRaw: queryRaw } }));
vi.mock('@/lib/seqsearch/progress', () => ({ readDiamondProgress: vi.fn(async () => null) }));

import { GET } from './route';

const ID = '286e0346-0963-43d3-ba9b-f57855010504';
const call = () => GET(new NextRequest(`http://localhost/api/search/results/${ID}`), { params: Promise.resolve({ id: ID }) });

beforeEach(() => {
  queryRaw.mockReset();
});

describe('GET /api/search/results/[id]', () => {
  it('answers 404 when neither search type has the session', async () => {
    queryRaw.mockResolvedValue([]);
    expect((await call()).status).toBe(404);
  });

  it('answers 5xx, not 404, when the sequence-session lookup fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    queryRaw.mockRejectedValue(Object.assign(new Error('canceling statement due to statement timeout'), { code: '57014' }));
    const res = await call();
    expect(res.status).toBeGreaterThanOrEqual(500);
  });

  it('answers 5xx, not 404, when only the BiG-SLiCE lookup fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    // No sequence session, then the BiG-SLiCE lookup errors.
    queryRaw.mockResolvedValueOnce([]).mockRejectedValue(new Error('connection terminated'));
    const res = await call();
    expect(res.status).toBeGreaterThanOrEqual(500);
  });
});
