import { Job } from 'bullmq';
import { mkdir } from 'fs/promises';
import { join } from 'path';
import prisma from '@/lib/prisma';
import { sendExportFailedEmail, sendExportReadyEmail } from '@/lib/mail/export-notification';
import { exportRegionsByGcf, exportRegionsByIds } from '@/lib/export/region-sources';
import { createRegionZip } from '@/lib/export/region-zip';
import { EXPORT_DIR, RETENTION_DAYS } from '@/lib/export/export-dir';
import { scrollHits } from '@/lib/opensearch/client';
import { PROPERTY_GBK_EXPORT_MAX_REGIONS } from '@/lib/gcf/export-limits';
import type { GcfGbkExportJob, PropertyGbkExportJob } from './index';

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

    const timestamp = new Date().toISOString().split('T')[0];
    const sanitizedName = gcfName.replace(/[^a-zA-Z0-9_-]/g, '_');
    const outputFilename = `gcf-${sanitizedName}-${timestamp}.zip`;
    const outputPath = join(EXPORT_DIR, outputFilename);

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

    await sendCompletionNotifications(exportJobId, gcfName, bgcs.length, missingFiles, userEmail);

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

    await sendFailureNotification(exportJobId, gcfName, userEmail);

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

// Property-search GBK export: shares the gcf_export_jobs record (kind 'regions'), job page and
// expiry sweep with the GCF export; the record is created by POST /api/search/properties/export-gbk.

export interface ProcessPropertyGbkExportResult {
  exportJobId: string;
  status: string;
  totalBgcs: number;
  missingFiles: number;
  fileSizeBytes: number;
  durationMs: number;
}

export async function processPropertyGbkExport(
  job: Job<PropertyGbkExportJob>,
  jobData: PropertyGbkExportJob,
): Promise<ProcessPropertyGbkExportResult> {
  const { exportJobId, userEmail } = jobData;
  const startTime = Date.now();
  try {
    await updateExportJobStatus(exportJobId, { status: 'running', started_at: new Date() });
    await mkdir(EXPORT_DIR, { recursive: true });
    // The start request only counted the matches so the job page opens at once; ~10 s at the cap.
    const bgcIds = jobData.bgcIds ?? (
      await scrollHits(jobData.group ?? null, jobData.sort ?? null, PROPERTY_GBK_EXPORT_MAX_REGIONS, ['bgc_id'])
    ).map((h) => String(h.bgc_id ?? '')).filter(Boolean);
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
          { to: userEmail, exportJobId, what: 'your search results' }, regions.length, missingFiles,
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
        () => sendExportFailedEmail({ to: userEmail, exportJobId, what: 'your search results' }),
        exportJobId,
      );
    }
    throw error;
  }
}
