import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * A queued search is in BullMQ's 'prioritized' state, not 'waiting': addSearchJob
 * gives every search a priority. The admin counts, the job list and "Cancel
 * waiting" read 'waiting' alone and so never saw one. The queues here are fakes
 * that keep jobs by state, the way BullMQ reports them.
 */

type FakeJob = { id: string; data: { type: string; sessionId?: string; exportJobId?: string }; remove: () => Promise<void> };

const { stores, closeJobRecord } = vi.hoisted(() => ({
  stores: new Map<string, Map<string, FakeJob[]>>(),
  closeJobRecord: vi.fn(async () => {}),
}));

vi.mock('bullmq', () => ({
  Worker: vi.fn(function (this: { on: () => void }) { this.on = () => {}; }),
  Queue: vi.fn(function (this: Record<string, unknown>, name: string) {
    const byState = new Map<string, FakeJob[]>();
    stores.set(name, byState);
    this.getJobCounts = async (...states: string[]) =>
      Object.fromEntries(states.map((s) => [s, byState.get(s)?.length ?? 0]));
    this.getJobs = async (states: string[], start = 0, end = -1) =>
      states.flatMap((s) => (byState.get(s) ?? []).slice(start, end === -1 ? undefined : end + 1));
  }),
  Job: class {},
}));
vi.mock('@/lib/redis-client', () => ({ default: { incr: vi.fn(), get: vi.fn(async () => '7'), set: vi.fn() } }));
vi.mock('@/lib/prisma', () => ({ default: {}, prisma: {} }));
vi.mock('@/lib/cron', () => ({ initializeCronJobs: vi.fn() }));
vi.mock('../bigslice', () => ({}));
vi.mock('../diamond', () => ({}));
vi.mock('../seqsearch/sample-map', () => ({}));
vi.mock('../seqsearch/database', () => ({}));
vi.mock('../bigslice/database', () => ({}));
vi.mock('./gcf-export', () => ({}));
vi.mock('./job-records', () => ({ closeJobRecord, closeOrphanedJobRecords: vi.fn() }));

const { getQueueStatus } = await import('./index');

const put = (queue: string, state: string, job: Omit<FakeJob, 'remove'>) => {
  const byState = stores.get(queue)!;
  const list = byState.get(state) ?? [];
  const full: FakeJob = {
    ...job,
    remove: async () => { byState.set(state, (byState.get(state) ?? []).filter((j) => j !== full)); },
  };
  list.push(full);
  byState.set(state, list);
};

beforeEach(() => {
  for (const byState of stores.values()) byState.clear();
  closeJobRecord.mockClear();
  put('search-jobs', 'prioritized', { id: '1', data: { type: 'sequence', sessionId: 'seq-1' } });
  put('search-jobs', 'prioritized', { id: '2', data: { type: 'bgc', sessionId: 'bgc-1' } });
  put('search-jobs', 'delayed', { id: '3', data: { type: 'sequence', sessionId: 'seq-retry' } });
  put('search-jobs', 'active', { id: '4', data: { type: 'sequence', sessionId: 'seq-running' } });
  put('export-jobs', 'waiting', { id: '5', data: { type: 'gcf-gbk-export', exportJobId: 'exp-1' } });
});

describe('queued jobs include prioritized and delayed ones', () => {
  it('counts and lists them', async () => {
    const status = await getQueueStatus();
    expect(status.searches).toEqual({ waiting: 3, active: 1 });
    expect(status.exports.waiting).toBe(1);
    expect(status.waiting).toBe(4);
    expect(status.active).toBe(1);
    expect(status.jobs.waiting.map((j) => j.sessionId).sort())
      .toEqual(['bgc-1', 'exp-1', 'seq-1', 'seq-retry']);
  });
});
