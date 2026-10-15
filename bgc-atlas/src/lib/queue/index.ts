import { Queue, Worker, Job } from 'bullmq';
import type { FilterGroup } from '@/lib/filters/types';
import { writeFile, readFile, stat, mkdir, copyFile } from 'fs/promises';
import { join } from 'path';
import { runBiGSlice, parseBiGSliceResults, checkBiGSliceAvailability, tierWorkspace } from '../bigslice';
import { CLUSTERING_THRESHOLD, type BiGSliceTier } from '../bigslice/families';
import { runDiamond, parseDiamondResults, checkDiamondAvailability } from '../diamond';
import { SEARCH_DEFAULTS } from '../seqsearch/defaults';
import { warmSequenceSampleMap } from '../seqsearch/sample-map';
import {
  updateSessionStatus,
  storeSearchResults,
} from '../seqsearch/database';
import {
  updateBigSliceSessionStatus,
  storeBigSliceResults,
} from '../bigslice/database';
import redisClient from '@/lib/redis-client';
import { processGcfGbkExport, processPropertyGbkExport } from './gcf-export';
import { initializeCronJobs } from '@/lib/cron';

const redisConfig = {
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379'),
  password: process.env.REDIS_PASSWORD,
  db: parseInt(process.env.REDIS_DB || '0'),
  maxRetriesPerRequest: null, // required by BullMQ blocking operations
  retryDelayOnFailover: 100,
  enableReadyCheck: false,
  maxLoadingTimeout: 1,
};

export interface SequenceSearchJob {
  type: 'sequence';
  sessionId: string;
  sessionDir: string;
  fastaFile: string;
  parameters: {
    algorithm: 'diamond';
    sequenceType: 'auto' | 'dna' | 'protein';
    eValue?: string;
    identity?: number;
    coverage?: number;
    maxResults?: number;
  };
}

export interface BGCSearchJob {
  type: 'bgc';
  sessionId: string;
  sessionDir: string;
  genbankFiles: string[];
  parameters: {
    algorithm: 'bigslice';
    distanceThreshold: number;
  };
}

export interface GcfGbkExportJob {
  type: 'gcf-gbk-export';
  exportJobId: string;
  gcfId: string;
  gcfName: string;
  userEmail?: string;
}

export interface PropertyGbkExportJob {
  type: 'property-gbk-export';
  exportJobId: string;
  /** The job resolves the search's matches itself (~10 s at 100,000 ids). */
  group?: FilterGroup | null;
  sort?: { field: string; order: 'asc' | 'desc' } | null;
  /** Older jobs carry their ids instead. */
  bgcIds?: string[];
  userEmail?: string;
}

export type SearchJob = SequenceSearchJob | BGCSearchJob;

export type ExportJob = GcfGbkExportJob | PropertyGbkExportJob;

export interface JobStatus {
  id: string | undefined;
  progress: number | object | string | boolean;
  data: SearchJob | ExportJob;
  opts: object;
  processedOn: number | undefined;
  finishedOn: number | undefined;
  failedReason: string | undefined;
  returnvalue?: unknown;
}

// Pinned on globalThis: Next.js can evaluate this module more than once (HMR, instrumentation
// vs route contexts), and a second Worker would double the effective concurrency.
const globalForSearchQueue = globalThis as unknown as {
  searchQueue?: Queue<SearchJob>;
  searchWorker?: Worker<SearchJob>;
  exportQueue?: Queue<ExportJob>;
  exportWorker?: Worker<ExportJob>;
};

export const searchQueue =
  globalForSearchQueue.searchQueue ??
  new Queue<SearchJob>('search-jobs', {
    connection: redisConfig,
    defaultJobOptions: {
      removeOnComplete: 10,
      removeOnFail: 20,
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 2000,
      },
    },
  });
globalForSearchQueue.searchQueue = searchQueue;

// Own queue so a long export doesn't block searches. Job ids are the export's uuid, not
// BullMQ's counter: Recent Jobs cookies hold old numeric ids a fresh counter would reuse.
export const exportQueue =
  globalForSearchQueue.exportQueue ??
  new Queue<ExportJob>('export-jobs', {
    connection: redisConfig,
    defaultJobOptions: {
      attempts: 1,
      // ~7 days, matching zip retention, so Recent Jobs links resolve.
      removeOnComplete: { age: 7 * 24 * 3600, count: 500 },
      removeOnFail: { age: 7 * 24 * 3600, count: 500 },
    },
  });
globalForSearchQueue.exportQueue = exportQueue;

export function initializeWorker() {
  if (globalForSearchQueue.searchWorker) return globalForSearchQueue.searchWorker;

  initializeCronJobs();
  
  const worker = new Worker<SearchJob>('search-jobs', async (job: Job<SearchJob>) => {
    const jobData = job.data;
    
    const jobIdentifier = jobData.sessionId;
    console.log(`Starting ${jobData.type} search job: ${jobIdentifier}`);
    
    try {
      await job.updateProgress(10);
      
      if (jobData.type === 'sequence') {
        return await processSequenceSearch(job as Job<SequenceSearchJob>, jobData);
      } else if (jobData.type === 'bgc') {
        return await processBGCSearch(job as Job<BGCSearchJob>, jobData);
      } else {
        const exhaustiveCheck: never = jobData;
        throw new Error(`Unknown job type: ${(exhaustiveCheck as { type: string }).type}`);
      }
    } catch (error) {
      console.error(`Job ${jobIdentifier} failed:`, error);
      throw error;
    }
  }, {
    connection: redisConfig,
    concurrency: 1,
  });

  worker.on('completed', async (job) => {
    const id = job.data.sessionId;
    console.log(`Job ${job.id} completed: ${id}`);
    try {
      await redisClient.incr('bgc:stats:completed')
      console.log('Incremented bgc:stats:completed via redisClient')
    } catch (e) {
      console.error('Failed to increment completed counter via redisClient:', e)
    }
  });

  worker.on('failed', async (job, err) => {
    console.error(`Job ${job?.id} failed:`, err?.message || err);

    try {
      await redisClient.incr('bgc:stats:failed')
      console.log('Incremented bgc:stats:failed via redisClient')
    } catch (e) {
      console.error('Failed to increment failed counter via redisClient:', e)
    }
  });

  globalForSearchQueue.searchWorker = worker;
  initializeExportWorker();
  return worker;
}

function initializeExportWorker() {
  if (globalForSearchQueue.exportWorker) return globalForSearchQueue.exportWorker;

  const worker = new Worker<ExportJob>('export-jobs', async (job: Job<ExportJob>) => {
    const jobData = job.data;
    console.log(`Starting ${jobData.type} export job: ${jobData.exportJobId}`);
    if (jobData.type === 'gcf-gbk-export') {
      return await processGcfGbkExport(job as Job<GcfGbkExportJob>, jobData);
    } else if (jobData.type === 'property-gbk-export') {
      return await processPropertyGbkExport(job as Job<PropertyGbkExportJob>, jobData);
    }
    const exhaustiveCheck: never = jobData;
    throw new Error(`Unknown export job type: ${(exhaustiveCheck as { type: string }).type}`);
  }, {
    connection: redisConfig,
    concurrency: 1,
  });

  worker.on('completed', async (job) => {
    console.log(`Export job ${job.id} completed`);
    try {
      await redisClient.incr('bgc:stats:completed');
    } catch (e) {
      console.error('Failed to increment completed counter via redisClient:', e);
    }
  });

  worker.on('failed', async (job, err) => {
    console.error(`Export job ${job?.id} failed:`, err?.message || err);
    try {
      await redisClient.incr('bgc:stats:failed');
    } catch (e) {
      console.error('Failed to increment failed counter via redisClient:', e);
    }
  });

  globalForSearchQueue.exportWorker = worker;
  return worker;
}

// The marker is written only after DIAMOND exits successfully; the output is re-checked
// because the session directory may have been cleaned up between attempts.
async function readCompletedRun(
  marker: string,
): Promise<{ resultsFile: string; command: string } | null> {
  try {
    const parsed = JSON.parse(await readFile(marker, 'utf8'));
    if (typeof parsed?.resultsFile !== 'string') return null;
    await stat(parsed.resultsFile);
    return { resultsFile: parsed.resultsFile, command: String(parsed.command ?? '') };
  } catch {
    return null;
  }
}

async function processSequenceSearch(job: Job<SequenceSearchJob>, data: SequenceSearchJob) {
  const { sessionId, sessionDir, fastaFile, parameters } = data;

  try {
    await updateSessionStatus(sessionId, 'running', { progress: 10 });
    await job.updateProgress(10);

    console.log(`Processing sequence search for session: ${sessionId}`);
    console.log(`Algorithm: ${parameters.algorithm}`);
    console.log(`Sequence type: ${parameters.sequenceType}`);
    console.log(`Parameters:`, parameters);

    // The submit route resolves 'auto' before enqueuing.
    const actualSequenceType: 'nucleotide' | 'protein' =
      parameters.sequenceType === 'dna' ? 'nucleotide' : 'protein';

    const startTime = Date.now();

    await job.updateProgress(15);

    // A retry resumes at the parse step if the search already succeeded (a large query can take ~30 min).
    const logFile = join(sessionDir, 'diamond.log');
    const doneMarker = join(sessionDir, 'diamond.done');
    const previousRun = await readCompletedRun(doneMarker);

    let resultsFile: string;
    let searchCommand: string;

    if (previousRun) {
      console.log(`Reusing the DIAMOND output of an earlier attempt for session: ${sessionId}`);
      ({ resultsFile, command: searchCommand } = previousRun);
      await updateSessionStatus(sessionId, 'running', { progress: 70 });
      await job.updateProgress(70);
    } else {
      const diamondAvailable = await checkDiamondAvailability();
      if (!diamondAvailable) {
        throw new Error('DIAMOND is not available in the conda environment');
      }

      console.log(`DIAMOND availability confirmed`);
      await updateSessionStatus(sessionId, 'running', { progress: 20 });

      const searchResult = await runDiamond({
        queryFile: fastaFile,
        outputDirectory: sessionDir,
        sequenceType: actualSequenceType,
        eValue: parseFloat(parameters.eValue || SEARCH_DEFAULTS.eValue),
        // `??`, not `||`: these must match the thresholds stored on the session.
        minIdentity: parameters.identity ?? SEARCH_DEFAULTS.identity,
        minCoverage: parameters.coverage ?? SEARCH_DEFAULTS.coverage,
        maxResults: parameters.maxResults ?? SEARCH_DEFAULTS.maxResults,
        logFile,
      });

      await job.updateProgress(70);

      if (!searchResult.success) {
        throw new Error(`DIAMOND execution failed (exit code: ${searchResult.exitCode}): ${searchResult.stderr}`);
      }

      console.log(`DIAMOND completed successfully for session: ${sessionId}`);
      resultsFile = searchResult.resultsFile;
      searchCommand = searchResult.command;

      await writeFile(
        doneMarker,
        JSON.stringify({ resultsFile, command: searchCommand, completedAt: new Date().toISOString() }),
      );
    }

    await updateSessionStatus(sessionId, 'running', { progress: 75 });
    const hits = await parseDiamondResults(resultsFile, actualSequenceType);
    console.log(`Parsed ${hits.length} hits from DIAMOND results`);

    await job.updateProgress(85);

    const insertedCount = await storeSearchResults(sessionId, hits, actualSequenceType);
    console.log(`Stored ${insertedCount} results in database`);

    await job.updateProgress(90);

    const searchDuration = Date.now() - startTime;

    const resultsPath = join(sessionDir, 'sequence_results.json');
    const results = {
      sessionId,
      type: 'sequence',
      status: 'completed',
      timestamp: new Date().toISOString(),
      algorithm: parameters.algorithm,
      searchCommand,
      searchDurationMs: searchDuration,
      results: {
        totalHits: insertedCount,
        topHits: hits.slice(0, 10).map(h => ({
          targetId: h.targetId,
          identity: h.identity,
          coverage: h.queryCoverage,
          eValue: h.eValue,
          bitScore: h.bitScore,
        }))
      }
    };

    await writeFile(resultsPath, JSON.stringify(results, null, 2));

    await updateSessionStatus(sessionId, 'completed', {
      progress: 100,
      totalHits: insertedCount,
      searchDurationMs: searchDuration,
    });

    await job.updateProgress(100);
    console.log(`Sequence search completed for session: ${sessionId}`);

    // After marking completed, so results are readable at once; the cold map query can take ~2 min.
    await warmSequenceSampleMap(sessionId);

    return {
      sessionId,
      status: 'completed',
      totalHits: insertedCount,
      searchDurationMs: searchDuration,
    };

  } catch (error) {
    console.error(`Sequence search failed for session ${sessionId}:`, error);

    await updateSessionStatus(sessionId, 'failed', {
      errorMessage: error instanceof Error ? error.message : String(error),
    });

    const resultsPath = join(sessionDir, 'sequence_results.json');
    const errorResults = {
      sessionId,
      type: 'sequence',
      status: 'failed',
      timestamp: new Date().toISOString(),
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    };

    await writeFile(resultsPath, JSON.stringify(errorResults, null, 2));

    throw error;
  }
}

// Inverts filename_map.json (staged -> original) to original -> staged. An empty map is fatal:
// cascading the wrong files would attribute a family to the wrong sequence.
async function readFilenameMap(mapPath: string): Promise<Map<string, string>> {
  const raw = await readFile(mapPath, 'utf8');
  const stagedToOriginal = JSON.parse(raw) as Record<string, string>;
  const originalToStaged = new Map<string, string>();
  for (const [staged, original] of Object.entries(stagedToOriginal)) {
    originalToStaged.set(original, staged);
  }
  if (originalToStaged.size === 0) {
    throw new Error(`filename_map.json at ${mapPath} is empty; cannot map uploads to staged files`);
  }
  return originalToStaged;
}

async function processBGCSearch(job: Job<BGCSearchJob>, data: BGCSearchJob) {
  const { sessionId, sessionDir, genbankFiles, parameters } = data;

  try {
    await updateBigSliceSessionStatus(sessionId, 'running', { progress: 10 });
    await job.updateProgress(10);

    console.log(`Processing BGC search for session: ${sessionId}`);
    console.log(`Files: ${genbankFiles.join(', ')}`);
    console.log(`Distance threshold: ${parameters.distanceThreshold}`);

    await job.updateProgress(15);
    const biGSliceAvailable = await checkBiGSliceAvailability();
    if (!biGSliceAvailable) {
      throw new Error('BiG-SLiCE is not available in the conda environment');
    }

    await updateBigSliceSessionStatus(sessionId, 'running', { progress: 20 });
    await job.updateProgress(20);
    console.log(`BiG-SLiCE availability confirmed`);

    const startTime = Date.now();
    const logFile = join(sessionDir, 'bigslice.log');

    // The seed model is the main atlas; everything is queried against it first.
    const runTier = async (tier: BiGSliceTier, inputDirectory: string) => {
      const result = await runBiGSlice({
        inputDirectory,
        queryName: sessionId,
        tier,
        logFile,
      });
      if (!result.success) {
        throw new Error(`BiG-SLiCE ${tier} query failed (exit code: ${result.exitCode}): ${result.stderr}`);
      }
      const parsed = await parseBiGSliceResults(
        tierWorkspace(tier),
        sessionId,
        join(sessionDir, 'filename_map.json'),
        tier
      );
      console.log(`Parsed ${parsed.totalMatches} ${tier} results for session ${sessionId}`);
      return { result, parsed };
    };

    const seed = await runTier('seed', sessionDir);

    await updateBigSliceSessionStatus(sessionId, 'running', { progress: 70 });
    await job.updateProgress(70);

    // The fragmented model only for what the seed model could not place, mirroring how the
    // corpus was built (run_orphan_residcont_v3.sh); it is another ~25 GB of centroids to load.
    const bestSeedDistance = new Map<string, number>();
    for (const hit of seed.parsed.results) {
      const best = bestSeedDistance.get(hit.origFilename);
      if (best === undefined || hit.distance < best) {
        bestSeedDistance.set(hit.origFilename, hit.distance);
      }
    }
    // A file with no seed hit at all cascades too.
    const originalToStaged = await readFilenameMap(join(sessionDir, 'filename_map.json'));
    const cascading = Array.from(originalToStaged.keys()).filter((original) => {
      const best = bestSeedDistance.get(original);
      return best === undefined || best > CLUSTERING_THRESHOLD;
    });

    const allResults = [...seed.parsed.results];
    let residualCommand: string | null = null;

    if (cascading.length > 0) {
      console.log(`${cascading.length}/${originalToStaged.size} files unplaced by the seed `
        + `model at <= ${CLUSTERING_THRESHOLD}; querying the fragmented model`);
      // BiG-SLiCE globs `**/*.gbk` under --query, so this must be a sibling of sessionDir,
      // not a subdirectory, holding only the cascaded files.
      const residualDir = `${sessionDir}-residual`;
      await mkdir(residualDir, { recursive: true });
      for (const original of cascading) {
        const staged = originalToStaged.get(original)!;
        await copyFile(join(sessionDir, staged), join(residualDir, staged));
      }

      const residual = await runTier('fragmented', residualDir);
      residualCommand = residual.result.command;
      allResults.push(...residual.parsed.results);
    } else {
      console.log('Every uploaded file placed in the seed model; skipping the fragmented model');
    }

    const biGSliceResult = seed.result;
    const parsedResults = { totalMatches: allResults.length, queryName: seed.parsed.queryName };

    await updateBigSliceSessionStatus(sessionId, 'running', { progress: 90 });
    await job.updateProgress(90);

    // Each row carries its tier; without it bigslice_gcf_id is ambiguous.
    await updateBigSliceSessionStatus(sessionId, 'running', { progress: 92 });
    await job.updateProgress(92);

    const insertedCount = await storeBigSliceResults(sessionId, allResults);
    console.log(`Stored ${insertedCount} BiG-SLiCE results in database`);

    await updateBigSliceSessionStatus(sessionId, 'running', { progress: 95 });
    await job.updateProgress(95);

    const searchDuration = Date.now() - startTime;

    const resultsPath = join(sessionDir, 'bgc_results.json');
    const results = {
      sessionId,
      type: 'bgc',
      status: 'completed',
      timestamp: new Date().toISOString(),
      parameters,
      biGSliceCommand: biGSliceResult.command,
      biGSliceResidualCommand: residualCommand,
      biGSliceOutput: {
        stdout: biGSliceResult.stdout.substring(0, 1000),
        stderr: biGSliceResult.stderr.substring(0, 1000),
        exitCode: biGSliceResult.exitCode
      },
      searchDurationMs: searchDuration,
      results: {
        clusteredBGCs: genbankFiles.length,
        totalMatches: insertedCount,
        queryName: parsedResults.queryName,
      }
    };

    await writeFile(resultsPath, JSON.stringify(results, null, 2));

    await updateBigSliceSessionStatus(sessionId, 'completed', {
      progress: 100,
      totalMatches: insertedCount,
      searchDurationMs: searchDuration,
    });

    await job.updateProgress(100);
    console.log(`BGC search completed for session: ${sessionId}`);

    return {
      sessionId,
      status: 'completed',
      totalMatches: insertedCount,
      searchDurationMs: searchDuration,
    };

  } catch (error) {
    console.error(`BiG-SLiCE processing failed for session ${sessionId}:`, error);

    await updateBigSliceSessionStatus(sessionId, 'failed', {
      errorMessage: error instanceof Error ? error.message : String(error),
    });

    const resultsPath = join(sessionDir, 'bgc_results.json');
    const errorResults = {
      sessionId,
      type: 'bgc',
      status: 'failed',
      timestamp: new Date().toISOString(),
      parameters,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      results: null
    };

    await writeFile(resultsPath, JSON.stringify(errorResults, null, 2));

    throw error;
  }
}

export async function addSearchJob(jobData: SearchJob): Promise<Job<SearchJob>> {
  initializeWorker();
  
  const job = await searchQueue.add('search-job', jobData, {
    priority: jobData.type === 'sequence' ? 1 : 2,
    // A BiG-SLiCE retry with the same query_name fails with "report with this name exists".
    ...(jobData.type === 'bgc' ? { attempts: 1 } : {}),
  });
  
  const queuedId = jobData.sessionId;
  console.log(`Added ${jobData.type} job to queue: ${job.id} (session: ${queuedId})`);
  try {
    await redisClient.incr('bgc:stats:submitted')
    console.log('Incremented bgc:stats:submitted via redisClient')
  } catch (e) {
    console.error('Failed to increment submitted counter via redisClient:', e)
  }
  return job;
}

export async function addExportJob(jobData: ExportJob): Promise<Job<ExportJob>> {
  initializeWorker();
  const job = await exportQueue.add(jobData.type, jobData, { jobId: jobData.exportJobId });
  console.log(`Added ${jobData.type} job to export queue: ${job.id}`);
  try {
    await redisClient.incr('bgc:stats:submitted');
  } catch (e) {
    console.error('Failed to increment submitted counter via redisClient:', e);
  }
  return job;
}

// Export ids are uuids and search ids numeric, so they never collide.
async function getQueueJob(jobId: string): Promise<Job<SearchJob | ExportJob> | undefined> {
  return (await exportQueue.getJob(jobId)) ?? (await searchQueue.getJob(jobId));
}

export async function getJobStatus(jobId: string): Promise<JobStatus | null> {
  const job = await getQueueJob(jobId);
  if (!job) {
    return null;
  }
  
  return {
    id: job.id,
    progress: await job.progress,
    data: job.data,
    opts: job.opts,
    processedOn: job.processedOn,
    finishedOn: job.finishedOn,
    failedReason: job.failedReason,
    returnvalue: job.returnvalue,
  };
}

// The v1 atlas (/v1) keeps its own job table, so "Completed" spans both. Cached because the
// strip polls every 5s; the fallback is a count v1 once reported.
const V1_QUEUE_STATUS_URL =
  process.env.V1_QUEUE_STATUS_URL ||
  'https://bgc-atlas.cs.uni-tuebingen.de/v1/jobs/queue/status';
const V1_COMPLETED_FALLBACK = 885;
const V1_COMPLETED_CACHE_KEY = 'bgc:stats:v1-completed';
const V1_COMPLETED_CACHE_TTL = 600;

async function getV1CompletedCount(): Promise<number> {
  try {
    const cached = await redisClient.get(V1_COMPLETED_CACHE_KEY);
    if (cached) {
      const parsed = parseInt(cached, 10);
      if (Number.isFinite(parsed)) return parsed;
    }
  } catch (e) {
    console.error('Failed to read cached v1 completed count:', e);
  }

  try {
    const response = await fetch(V1_QUEUE_STATUS_URL, {
      signal: AbortSignal.timeout(3000),
      cache: 'no-store',
    });
    if (!response.ok) throw new Error(`v1 queue status returned ${response.status}`);
    const data = await response.json();
    const completed = typeof data?.completedJobs === 'number' ? data.completedJobs : NaN;
    if (!Number.isFinite(completed)) throw new Error('v1 queue status had no completedJobs');
    try {
      await redisClient.set(V1_COMPLETED_CACHE_KEY, String(completed), 'EX', V1_COMPLETED_CACHE_TTL);
    } catch (e) {
      console.error('Failed to cache v1 completed count:', e);
    }
    return completed;
  } catch (e) {
    console.error('Failed to fetch v1 completed count:', e);
    return V1_COMPLETED_FALLBACK;
  }
}

export async function getQueueStatus() {
  const counts = await searchQueue.getJobCounts('waiting', 'active', 'completed', 'failed');

  const waiting = await searchQueue.getJobs(['waiting'], 0, 9);
  const active = await searchQueue.getJobs(['active'], 0, 9);
  let cumulativeCompleted = counts.completed || 0;
  let cumulativeFailed = counts.failed || 0;
  let cumulativeSubmitted = 0;
  try {
    try {
      const [cComp, cFail, cSub] = await Promise.all([
        redisClient.get('bgc:stats:completed'),
        redisClient.get('bgc:stats:failed'),
        redisClient.get('bgc:stats:submitted'),
      ])
      cumulativeCompleted = cComp ? parseInt(cComp, 10) : cumulativeCompleted
      cumulativeFailed = cFail ? parseInt(cFail, 10) : cumulativeFailed
      cumulativeSubmitted = cSub ? parseInt(cSub, 10) : 0
    } catch (e) {
      console.error('Failed to read cumulative counters from redisClient:', e)
    }
  } catch (e) {
    console.error('Failed to read cumulative counters from Redis:', e);
  }

  const v1Completed = await getV1CompletedCount();

  return {
    waiting: counts.waiting || 0,
    active: counts.active || 0,
    completed: cumulativeCompleted + v1Completed,
    failed: cumulativeFailed,
    submitted: cumulativeSubmitted,
    jobs: {
      waiting: waiting.map(j => ({
        id: j.id,
        type: j.data.type,
        sessionId: j.data.sessionId,
      })),
      active: active.map(j => ({
        id: j.id,
        type: j.data.type,
        sessionId: j.data.sessionId,
        progress: j.progress,
      })),
    }
  };
}
