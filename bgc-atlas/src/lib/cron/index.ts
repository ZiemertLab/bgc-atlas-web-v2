import cron, { type ScheduledTask } from 'node-cron';
import { cleanupExpiredExports } from '@/lib/cleanup/export-cleanup';
import { cleanupAntismashExtractions } from '@/lib/cleanup/antismash-extraction-cleanup';

let cleanupJob: ScheduledTask | null = null;

const formatBytes = (bytes: number) => `${(bytes / (1024 * 1024)).toFixed(0)} MB`;

// Sizes are backfilled a few runs per pass, so the report names the unsized runs instead of
// implying a total.
const formatFiles = (files: number) => `${files.toLocaleString('en-US')} files`;

const describeSize = (r: {
  bytesTotal: number;
  filesTotal: number;
  sized: number;
  unsized: number;
}) =>
  r.unsized === 0
    ? `${formatBytes(r.bytesTotal)} / ${formatFiles(r.filesTotal)} total`
    : `${formatBytes(r.bytesTotal)} / ${formatFiles(r.filesTotal)} across ${r.sized} measured ` +
      `runs, ${r.unsized} not measured yet (caps cannot bind until they are)`;

export function initializeCronJobs() {
  if (cleanupJob) {
    console.log('Cron jobs already initialized');
    return;
  }

  cleanupJob = cron.schedule('0 2 * * *', async () => {
    console.log('Running scheduled export cleanup...');
    try {
      const result = await cleanupExpiredExports();
      console.log(`Scheduled cleanup completed: ${result.deletedCount} deleted, ${result.failedCount} failed`);
      if (result.errors.length > 0) {
        console.error('Cleanup errors:', result.errors);
      }
    } catch (error) {
      console.error('Error during scheduled cleanup:', error);
    }
  });

  // Hourly: one MFD run unpacks to ~4.4 GB, and a full root filesystem takes the site down.
  cron.schedule('30 * * * *', async () => {
    try {
      const result = await cleanupAntismashExtractions();

      if (!result.enforced) {
        // Warn every pass: a maintenance job that silently does nothing reads as working.
        console.warn(
          `antiSMASH extraction cache: REPORT ONLY (no bound configured). ` +
            `${result.scanned} runs, ${describeSize(result)}; ` +
            `${result.evicted} runs / ${formatBytes(result.bytesReclaimed)} / ` +
            `${formatFiles(result.filesReclaimed)} would be evicted. Set ` +
            `ANTISMASH_CACHE_MAX_BYTES, ANTISMASH_CACHE_MAX_FILES or ` +
            `ANTISMASH_CACHE_TTL_HOURS to enforce.`,
        );
        return;
      }

      if (result.evicted > 0 || result.failed > 0) {
        console.log(
          `antiSMASH extraction cache: ${result.evicted} evicted, ` +
            `${formatBytes(result.bytesReclaimed)} / ${formatFiles(result.filesReclaimed)} reclaimed, ` +
            `${result.scanned - result.evicted} kept; ${describeSize(result)}; ` +
            `${result.failed} failed`,
        );
      }
      if (result.errors.length > 0) {
        console.error('Extraction cache eviction errors:', result.errors);
      }
    } catch (error) {
      console.error('Error during antiSMASH extraction cache cleanup:', error);
    }
  });

  console.log(
    'Cron jobs initialized: export cleanup 2 AM daily, antiSMASH extraction cache hourly',
  );
}
