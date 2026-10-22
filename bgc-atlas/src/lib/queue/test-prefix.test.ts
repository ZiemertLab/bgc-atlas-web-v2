import { describe, expect, it, vi } from 'vitest';

/**
 * QUEUE_TEST_PREFIX isolates a test preview's queues, and keeps it from sweeping
 * production's records as orphans (it sees none of production's jobs).
 */

const m = vi.hoisted(() => ({
  Queue: vi.fn(function () {}),
  Worker: vi.fn(function (this: { on: () => void }) { this.on = () => {}; }),
  initializeCronJobs: vi.fn(),
}));

vi.mock('bullmq', () => ({ Worker: m.Worker, Queue: m.Queue, Job: class {} }));
vi.mock('@/lib/redis-client', () => ({ default: {} }));
vi.mock('@/lib/prisma', () => ({ default: {}, prisma: {} }));
vi.mock('@/lib/cron', () => ({ initializeCronJobs: m.initializeCronJobs }));
vi.mock('../bigslice', () => ({}));
vi.mock('../diamond', () => ({}));
vi.mock('../seqsearch/sample-map', () => ({}));
vi.mock('../seqsearch/database', () => ({}));
vi.mock('../bigslice/database', () => ({}));
vi.mock('./gcf-export', () => ({}));
vi.mock('./job-records', () => ({ closeJobRecord: vi.fn(), closeOrphanedJobRecords: vi.fn() }));

describe('QUEUE_TEST_PREFIX', () => {
  it('puts every queue and worker under the prefix and skips the cron jobs and sweep', async () => {
    vi.stubEnv('QUEUE_TEST_PREFIX', 'e2test');
    vi.stubEnv('SEARCH_WORKER_DISABLED', '');
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');
    const { initializeWorker } = await import('./index');
    initializeWorker();
    const options = [...m.Queue.mock.calls, ...m.Worker.mock.calls].map((c) => (c as unknown[]).at(-1) as { prefix?: string });
    expect(options).toHaveLength(4);
    for (const o of options) expect(o.prefix).toBe('e2test');
    expect(m.initializeCronJobs).not.toHaveBeenCalled();
    expect(setTimeoutSpy).not.toHaveBeenCalledWith(expect.any(Function), 60_000);
    vi.unstubAllEnvs();
  });

  it("refuses production's own prefix", async () => {
    vi.resetModules();
    vi.stubEnv('QUEUE_TEST_PREFIX', 'bull');
    await expect(import('./index')).rejects.toThrow(/must not be 'bull'/);
    vi.unstubAllEnvs();
  });
});
