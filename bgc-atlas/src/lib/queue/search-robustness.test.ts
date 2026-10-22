import { mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The search queue across failures it has to survive: a queue that refuses the job, an
 * app restart mid-search (BullMQ re-runs the stalled job, whatever its attempts), and a
 * retry that resumes from an earlier attempt's DIAMOND output. Everything that would
 * reach Redis, Postgres or a remote host is mocked.
 */

const m = vi.hoisted(() => {
  const processors: Array<(job: unknown) => Promise<unknown>> = [];
  return {
    processors,
    add: vi.fn(),
    Worker: vi.fn(function (this: { on: () => void }, _name: string, processor: (job: unknown) => Promise<unknown>) {
      processors.push(processor);
      this.on = () => {};
    }),
    Queue: vi.fn(function (this: { add: unknown }) { this.add = m.add; }),
    closeJobRecord: vi.fn(async () => true),
    runBiGSlice: vi.fn(),
    parseBiGSliceResults: vi.fn(),
    runDiamond: vi.fn(),
    updateSessionStatus: vi.fn(async (..._args: unknown[]) => {}),
  };
});

vi.mock('bullmq', () => ({ Worker: m.Worker, Queue: m.Queue, Job: class {} }));
vi.mock('@/lib/redis-client', () => ({ default: { incr: vi.fn(async () => 1) } }));
vi.mock('@/lib/prisma', () => ({ default: {}, prisma: {} }));
vi.mock('@/lib/cron', () => ({ initializeCronJobs: vi.fn() }));
vi.mock('../bigslice', () => ({
  runBiGSlice: m.runBiGSlice,
  parseBiGSliceResults: m.parseBiGSliceResults,
  checkBiGSliceAvailability: async () => true,
  tierWorkspace: (tier: string) => `/ws/${tier}`,
}));
vi.mock('../diamond', () => ({
  runDiamond: m.runDiamond,
  parseDiamondResults: async () => [],
  checkDiamondAvailability: async () => true,
}));
vi.mock('../seqsearch/sample-map', () => ({ warmSequenceSampleMap: async () => {} }));
vi.mock('../seqsearch/database', () => ({ updateSessionStatus: m.updateSessionStatus, storeSearchResults: async () => 0 }));
vi.mock('../bigslice/database', () => ({ updateBigSliceSessionStatus: async () => {}, storeBigSliceResults: async () => 0 }));
vi.mock('./gcf-export', () => ({}));
vi.mock('./job-records', () => ({ closeJobRecord: m.closeJobRecord, closeOrphanedJobRecords: vi.fn() }));

import { addSearchJob, enqueueRecordedSearch, initializeWorker, readCompletedRun } from './index';
import { SEARCH_NOT_QUEUED_MESSAGE } from '@/lib/api/errors';

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'queue-test-'));
  m.add.mockReset().mockResolvedValue({ id: 'x' });
  m.closeJobRecord.mockClear();
  m.runBiGSlice.mockReset();
  m.parseBiGSliceResults.mockReset();
  m.runDiamond.mockReset();
  m.updateSessionStatus.mockClear();
});
afterEach(async () => {
  vi.useRealTimers();
  await rm(dir, { recursive: true, force: true });
});

const seqJob = (sessionDir: string) => ({
  type: 'sequence' as const,
  sessionId: 'aaaaaaaa-0000-4000-8000-000000000001',
  sessionDir,
  fastaFile: join(sessionDir, 'query.fasta'),
  parameters: { algorithm: 'diamond' as const, sequenceType: 'protein' as const, eValue: '1e-5', identity: 30, coverage: 50, maxResults: 100 },
});

describe('queueing a recorded search', () => {
  it('queues under the session id, which the record already carries', async () => {
    await addSearchJob(seqJob(dir));
    expect(m.add.mock.calls[0][2]).toMatchObject({ jobId: 'aaaaaaaa-0000-4000-8000-000000000001' });
  });

  it('closes the record and rethrows when the queue refuses the job', async () => {
    m.add.mockRejectedValue(new Error('redis down'));
    await expect(enqueueRecordedSearch(seqJob(dir))).rejects.toThrow('redis down');
    expect(m.closeJobRecord).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: 'aaaaaaaa-0000-4000-8000-000000000001' }),
      SEARCH_NOT_QUEUED_MESSAGE,
    );
  });

  it('leaves the record alone when the job is queued', async () => {
    await enqueueRecordedSearch(seqJob(dir));
    expect(m.closeJobRecord).not.toHaveBeenCalled();
  });
});

const job = (data: unknown) => ({ data, updateProgress: async () => {} });
const searchProcessor = () => {
  initializeWorker();
  return m.processors[0];
};

describe('a BiG-SLiCE search run twice (a restart mid-query)', () => {
  it('uses a fresh report name per run, the same container name, and parses the run it made', async () => {
    await writeFile(join(dir, 'filename_map.json'), JSON.stringify({ 'q_1.gbk': 'mine.gbk' }));
    m.runBiGSlice.mockResolvedValue({ success: true, exitCode: 0, stdout: '', stderr: '', command: 'bigslice' });
    // A seed hit within the threshold, so no fragmented-tier run.
    m.parseBiGSliceResults.mockResolvedValue({ totalMatches: 1, queryName: 'q', results: [{ origFilename: 'mine.gbk', distance: 0.1 }] });
    const data = {
      type: 'bgc', sessionId: 'bbbbbbbb-0000-4000-8000-000000000002', sessionDir: dir,
      genbankFiles: [join(dir, 'q_1.gbk')], parameters: { algorithm: 'bigslice', distanceThreshold: 0.4 },
    };
    const run = searchProcessor();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(1_000_000);
    await run(job(data));
    vi.setSystemTime(2_000_000);
    await run(job(data));

    const [first, second] = m.runBiGSlice.mock.calls.map((c) => c[0] as { queryName: string; containerName: string });
    expect(first.queryName).not.toBe(second.queryName);
    expect(first.queryName.startsWith(data.sessionId)).toBe(true);
    expect(first.containerName).toBe(`atlas-bigslice-${data.sessionId}-seed`);
    expect(second.containerName).toBe(first.containerName);
    expect(m.parseBiGSliceResults.mock.calls.map((c) => c[1])).toEqual([first.queryName, second.queryName]);
  });
});

describe('a DIAMOND search', () => {
  it('runs in a container named for the session', async () => {
    await writeFile(join(dir, 'out.tsv'), '');
    m.runDiamond.mockResolvedValue({ success: true, exitCode: 0, stdout: '', stderr: '', command: 'd', resultsFile: join(dir, 'out.tsv') });
    await searchProcessor()(job(seqJob(dir)));
    expect(m.runDiamond.mock.calls[0][0]).toMatchObject({ containerName: 'atlas-diamond-aaaaaaaa-0000-4000-8000-000000000001' });
    expect(JSON.parse(await readFile(join(dir, 'diamond.done'), 'utf8'))).toHaveProperty('diamondMs');
  });

  it("resumed from an earlier attempt's output, records that run's time too", async () => {
    await writeFile(join(dir, 'out.tsv'), '');
    await writeFile(join(dir, 'diamond.done'), JSON.stringify({ resultsFile: join(dir, 'out.tsv'), command: 'd', diamondMs: 1_800_000 }));
    await searchProcessor()(job(seqJob(dir)));
    expect(m.runDiamond).not.toHaveBeenCalled();
    const completed = m.updateSessionStatus.mock.calls.find((c) => c[1] === 'completed')!;
    expect((completed[2] as { searchDurationMs: number }).searchDurationMs).toBeGreaterThanOrEqual(1_800_000);
  });
});

describe('readCompletedRun', () => {
  it('reads an older marker without diamondMs as 0', async () => {
    await writeFile(join(dir, 'out.tsv'), '');
    await writeFile(join(dir, 'diamond.done'), JSON.stringify({ resultsFile: join(dir, 'out.tsv'), command: 'd' }));
    expect(await readCompletedRun(join(dir, 'diamond.done'))).toMatchObject({ diamondMs: 0 });
  });
});
