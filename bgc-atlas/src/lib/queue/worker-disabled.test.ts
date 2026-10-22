import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * SEARCH_WORKER_DISABLED=1 must keep a server off the shared queue for its whole life.
 *
 * It used to be checked only at boot (instrumentation.ts), while addSearchJob and
 * addExportJob call initializeWorker() themselves -- so the first search submitted to a
 * preview started a worker there, which then took production jobs with the preview's code
 * and env. Every module that would reach Redis, Postgres or a remote host is mocked.
 */

const { Worker, Queue, add, initializeCronJobs } = vi.hoisted(() => {
  const add = vi.fn(async () => ({ id: 'job-1' }));
  return {
    add,
    Worker: vi.fn(function (this: { on: () => void }) { this.on = () => {}; }),
    Queue: vi.fn(function (this: { add: typeof add }) { this.add = add; }),
    initializeCronJobs: vi.fn(),
  };
});

vi.mock('bullmq', () => ({ Worker, Queue, Job: class {} }));
vi.mock('@/lib/redis-client', () => ({ default: { incr: vi.fn(async () => 1) } }));
vi.mock('@/lib/prisma', () => ({ default: {}, prisma: {} }));
vi.mock('@/lib/cron', () => ({ initializeCronJobs }));
vi.mock('../bigslice', () => ({}));
vi.mock('../diamond', () => ({}));
vi.mock('../seqsearch/sample-map', () => ({}));
vi.mock('../seqsearch/database', () => ({}));
vi.mock('../bigslice/database', () => ({}));
vi.mock('./gcf-export', () => ({}));
vi.mock('./job-records', () => ({ closeJobRecord: vi.fn(), closeOrphanedJobRecords: vi.fn() }));

const jobData = {
  type: 'sequence' as const,
  sessionId: 's1',
  sessionDir: '/tmp/s1',
  fastaFile: '/tmp/s1/query.fasta',
  parameters: { algorithm: 'diamond' as const, sequenceType: 'protein' as const },
};

afterEach(() => {
  delete process.env.SEARCH_WORKER_DISABLED;
  vi.clearAllMocks();
});

describe('SEARCH_WORKER_DISABLED', () => {
  it('queues the job but starts no worker and no cron when set', async () => {
    process.env.SEARCH_WORKER_DISABLED = '1';
    const { addSearchJob, initializeWorker } = await import('./index');
    expect(initializeWorker()).toBeNull();
    await addSearchJob(jobData);
    expect(add).toHaveBeenCalledTimes(1);
    expect(Worker).not.toHaveBeenCalled();
    expect(initializeCronJobs).not.toHaveBeenCalled();
  });

  it('still starts the worker when unset (production)', async () => {
    const { initializeWorker } = await import('./index');
    expect(initializeWorker()).not.toBeNull();
    expect(Worker).toHaveBeenCalled();
  });
});
