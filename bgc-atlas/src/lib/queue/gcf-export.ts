import { Job } from 'bullmq';
import { mkdir } from 'fs/promises';
import { join } from 'path';
import prisma from '@/lib/prisma';
import { sendExportFailedEmail, sendExportReadyEmail } from '@/lib/mail/export-notification';
import { exportRegionsByGcf, exportRegionsByIds } from '@/lib/export/region-sources';
import { createRegionZip } from '@/lib/export/region-zip';
import { EXPORT_DIR, gcfExportPath, RETENTION_DAYS } from '@/lib/export/export-dir';
import { scrollHits } from '@/lib/opensearch/client';
import { PROPERTY_GBK_EXPORT_MAX_REGIONS } from '@/lib/gcf/export-limits';
import { getHitBgcIds } from '@/lib/seqsearch/database';
import type { GcfGbkExportJob, PropertyGbkExportJob, SequenceGbkExportJob } from './index';


/**
 * Who to mail about an export: the record's address, read when the job ends. A reader
 * who asks for a GCF export already running is attached to it there
 * (api/gcfs/[id]/export-gbk); the queued job's own copy predates them.
 */
async function recipientOf(exportJobId: string, queued: string | undefined): Promise<string | undefined> {
  try {
    const row = await prisma.gcfExportJob.findUnique({ where: { id: exportJobId }, select: { user_email: true } });
    return row?.user_email || queued;
  } catch {
    return queued;
  }
}

interface ProcessGcfGbkExportResult {
  exportJobId: string;
  status: string;
  totalBgcs: number;
  missingFiles?: number;
  fileSizeBytes: number;
  durationMs: number;
}

export async function processGcfGbkExport(
  job: Job<GcfGbkExportJob>,
  data: GcfGbkExportJob
): Promise<ProcessGcfGbkExportResult> {
  const { exportJobId, gcfId, gcfName, userEmail } = data;
  const startTime = Date.now();

  console.log(`Starting GCF GBK export job: ${exportJobId} for GCF: ${gcfName}`);

  try {
    await updateExportJobStatus(exportJobId, {
      status: 'running',
      started_at: new Date(),
    });
    await job.updateProgress(5);

    console.log(`Fetching BGCs for GCF: ${gcfId}`);
    const bgcs = await exportRegionsByGcf(gcfId);

    if (bgcs.length === 0) {
      throw new Error(`No BGCs found for GCF ${gcfName}`);
    }

    console.log(`Found ${bgcs.length} BGCs for GCF ${gcfName}`);
    await updateExportJobStatus(exportJobId, { total_bgcs: bgcs.length });
    await job.updateProgress(10);

    await mkdir(EXPORT_DIR, { recursive: true });

    // The readable name is what the download is called; on disk the file is named by job,
    // so two exports of one family on one day cannot overwrite each other's zip.
    const timestamp = new Date().toISOString().split('T')[0];
    const sanitizedName = gcfName.replace(/[^a-zA-Z0-9_-]/g, '_');
    const outputFilename = `gcf-${sanitizedName}-${timestamp}.zip`;
    const outputPath = gcfExportPath(exportJobId);

    console.log(`Creating ZIP archive: ${outputPath}`);

    const { missingFiles, totalSize } = await createRegionZip(
      bgcs,
      outputPath,
      async (processed) => {
        // The job page reads the record's progress, so it is written as the zip grows.
        const progress = Math.min(10 + Math.floor((processed / bgcs.length) * 80), 90);
        await updateExportJobStatus(exportJobId, { processed_bgcs: processed, progress });
        await job.updateProgress(progress);
      }
    );

    await job.updateProgress(95);

    const duration = Date.now() - startTime;
    const expiresAt = new Date(Date.now() + RETENTION_DAYS * 24 * 60 * 60 * 1000);

    await updateExportJobStatus(exportJobId, {
      status: 'completed',
      progress: 100,
      completed_at: new Date(),
      duration_ms: duration,
      output_filename: outputFilename,
      output_path: outputPath,
      file_size_bytes: totalSize,
      missing_files: missingFiles,
      expires_at: expiresAt,
    });

    await job.updateProgress(100);

    await sendCompletionNotifications(
      exportJobId, gcfName, bgcs.length, missingFiles, await recipientOf(exportJobId, userEmail),
    );

    console.log(`GCF GBK export completed: ${exportJobId}`);

    return {
      exportJobId,
      status: 'completed',
      totalBgcs: bgcs.length,
      missingFiles,
      fileSizeBytes: totalSize,
      durationMs: duration,
    };
  } catch (error) {
    console.error(`GCF GBK export failed for ${exportJobId}:`, error);

    const errorMessage = error instanceof Error ? error.message : String(error);
    await updateExportJobStatus(exportJobId, {
      status: 'failed',
      completed_at: new Date(),
      error_message: errorMessage,
      duration_ms: Date.now() - startTime,
    });

    await sendFailureNotification(exportJobId, gcfName, await recipientOf(exportJobId, userEmail));

    throw error;
  }
}

async function updateExportJobStatus(
  exportJobId: string,
  updates: {
    status?: string;
    progress?: number;
    total_bgcs?: number;
    processed_bgcs?: number;
    missing_files?: number;
    output_filename?: string;
    output_path?: string;
    file_size_bytes?: bigint | number;
    started_at?: Date;
    completed_at?: Date;
    duration_ms?: number;
    error_message?: string;
    expires_at?: Date;
  }
): Promise<void> {
  try {
    await prisma.gcfExportJob.update({
      where: { id: exportJobId },
      data: {
        ...updates,
        updated_at: new Date(),
      },
    });
  } catch (error) {
    console.error(`Failed to update export job ${exportJobId}:`, error);
  }
}

// A mail failure is logged and never fails the export.
async function mailReader(send: () => Promise<void>, exportJobId: string): Promise<void> {
  try {
    await send();
  } catch (error) {
    console.error(`Failed to email export ${exportJobId} to its requester:`, error);
  }
}

async function sendCompletionNotifications(
  exportJobId: string,
  gcfName: string,
  totalBgcs: number,
  missingFiles: number,
  userEmail?: string
): Promise<void> {
  if (!userEmail) return;
  await mailReader(
    () => sendExportReadyEmail({ to: userEmail, exportJobId, what: gcfName }, totalBgcs, missingFiles),
    exportJobId,
  );
}

async function sendFailureNotification(
  exportJobId: string,
  gcfName: string,
  userEmail?: string
): Promise<void> {
  if (!userEmail) return;
  await mailReader(
    () => sendExportFailedEmail({ to: userEmail, exportJobId, what: gcfName }),
    exportJobId,
  );
}

// Region GBK exports of a search's matches (property or sequence search): share the
// gcf_export_jobs record (kind 'regions'), job page and expiry sweep with the GCF export. The
// export-gbk route creates the record; the job resolves its BGC ids so the job page opens at once.

export interface ProcessRegionsGbkExportResult {
  exportJobId: string;
  status: string;
  totalBgcs: number;
  missingFiles: number;
  fileSizeBytes: number;
  durationMs: number;
}

interface RegionsExportSpec {
  /** "your search results", in the reader's ready/failed email. */
  what: string;
  /** The BGCs to package, at most PROPERTY_GBK_EXPORT_MAX_REGIONS. */
  resolveBgcIds: () => Promise<string[]>;
}

async function runRegionsGbkExport(
  job: Job<PropertyGbkExportJob | SequenceGbkExportJob>,
  exportJobId: string,
  userEmail: string | undefined,
  spec: RegionsExportSpec,
): Promise<ProcessRegionsGbkExportResult> {
  const startTime = Date.now();
  try {
    await updateExportJobStatus(exportJobId, { status: 'running', started_at: new Date() });
    await mkdir(EXPORT_DIR, { recursive: true });
    const bgcIds = await spec.resolveBgcIds();
    const regions = await exportRegionsByIds(bgcIds);
    if (regions.length === 0) throw new Error('None of the matching BGCs could be found');
    await updateExportJobStatus(exportJobId, { total_bgcs: regions.length });
    await job.updateProgress(5);

    const outputFilename = `bgc-regions-${exportJobId}.zip`;
    const outputPath = join(EXPORT_DIR, outputFilename);

    const { missingFiles, totalSize } = await createRegionZip(
      regions,
      outputPath,
      async (processed) => {
        const progress = Math.min(5 + Math.floor((processed / regions.length) * 90), 95);
        await updateExportJobStatus(exportJobId, { processed_bgcs: processed, progress });
        await job.updateProgress(progress);
      },
    );

    const durationMs = Date.now() - startTime;
    await updateExportJobStatus(exportJobId, {
      status: 'completed',
      progress: 100,
      completed_at: new Date(),
      duration_ms: durationMs,
      output_filename: outputFilename,
      output_path: outputPath,
      file_size_bytes: totalSize,
      missing_files: missingFiles,
      expires_at: new Date(Date.now() + RETENTION_DAYS * 24 * 60 * 60 * 1000),
    });
    await job.updateProgress(100);

    if (userEmail) {
      await mailReader(
        () => sendExportReadyEmail(
          { to: userEmail, exportJobId, what: spec.what }, regions.length, missingFiles,
        ),
        exportJobId,
      );
    }

    return {
      exportJobId,
      status: 'completed',
      totalBgcs: regions.length,
      missingFiles,
      fileSizeBytes: totalSize,
      durationMs,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    await updateExportJobStatus(exportJobId, {
      status: 'failed',
      completed_at: new Date(),
      error_message: errorMessage,
      duration_ms: Date.now() - startTime,
    });
    if (userEmail) {
      await mailReader(
        () => sendExportFailedEmail({ to: userEmail, exportJobId, what: spec.what }),
        exportJobId,
      );
    }
    throw error;
  }
}

export function processPropertyGbkExport(
  job: Job<PropertyGbkExportJob>,
  jobData: PropertyGbkExportJob,
): Promise<ProcessRegionsGbkExportResult> {
  return runRegionsGbkExport(job, jobData.exportJobId, jobData.userEmail, {
    what: 'your search results',
    // ~10 s at the cap.
    resolveBgcIds: async () => jobData.bgcIds ?? (
      await scrollHits(jobData.group ?? null, jobData.sort ?? null, PROPERTY_GBK_EXPORT_MAX_REGIONS, ['bgc_id'])
    ).map((h) => String(h.bgc_id ?? '')).filter(Boolean),
  });
}

export function processSequenceGbkExport(
  job: Job<SequenceGbkExportJob>,
  jobData: SequenceGbkExportJob,
): Promise<ProcessRegionsGbkExportResult> {
  return runRegionsGbkExport(job, jobData.exportJobId, jobData.userEmail, {
    what: 'your sequence search results',
    // Session-local rows; a session holds at most ~100 queries x 1,000 hits, so the cap
    // is a guard rather than a limit anyone meets.
    resolveBgcIds: async () =>
      (await getHitBgcIds(jobData.sessionId, jobData.filters ?? {})).slice(0, PROPERTY_GBK_EXPORT_MAX_REGIONS),
  });
}
