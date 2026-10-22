import { readdir, stat, unlink } from 'fs/promises';
import { join } from 'path';
import prisma from '@/lib/prisma';
import { EXPORT_DIR, PARTIAL_SUFFIX } from '@/lib/export/export-dir';

export async function cleanupExpiredExports(): Promise<{
  success: boolean;
  deletedCount: number;
  failedCount: number;
  errors: string[];
}> {
  console.log('Starting cleanup of expired exports...');

  const errors: string[] = [];
  let deletedCount = 0;
  let failedCount = 0;

  try {
    const expiredExports = await prisma.gcfExportJob.findMany({
      where: {
        expires_at: {
          lt: new Date(),
        },
        is_deleted: false,
        status: 'completed',
      },
      select: {
        id: true,
        output_path: true,
        output_filename: true,
        expires_at: true,
      },
    });

    console.log(`Found ${expiredExports.length} expired exports to clean up`);

    for (const exportJob of expiredExports) {
      try {
        // Marked deleted only once the file is gone, so a failed unlink is retried next time.
        if (exportJob.output_path) {
          try {
            await unlink(exportJob.output_path);
            console.log(`Deleted file: ${exportJob.output_path}`);
          } catch (error: unknown) {
            // File might not exist, which is okay
            const errCode = (error as { code?: string })?.code;
            const errMessage = error instanceof Error ? error.message : String(error);
            if (errCode !== 'ENOENT') {
              console.warn(`Failed to delete file ${exportJob.output_path}:`, error);
              errors.push(`Failed to delete file for export ${exportJob.id}: ${errMessage}`);
              failedCount++;
              continue; // kept for the next sweep
            }
          }
        }

        await prisma.gcfExportJob.update({
          where: { id: exportJob.id },
          data: {
            is_deleted: true,
            updated_at: new Date(),
          },
        });

        deletedCount++;
        console.log(`Marked export ${exportJob.id} as deleted`);
      } catch (error) {
        console.error(`Error cleaning up export ${exportJob.id}:`, error);
        errors.push(`Export ${exportJob.id}: ${error instanceof Error ? error.message : String(error)}`);
        failedCount++;
      }
    }

    console.log(`Cleanup completed: ${deletedCount} deleted, ${failedCount} failed`);

    return {
      success: true,
      deletedCount,
      failedCount,
      errors,
    };
  } catch (error) {
    console.error('Error during cleanup:', error);
    return {
      success: false,
      deletedCount,
      failedCount,
      errors: [...errors, `Fatal error: ${error instanceof Error ? error.message : String(error)}`],
    };
  }
}

const PARTIAL_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/**
 * Delete the `.partial` zips a killed worker left behind; no record points at them, so the
 * expiry cleanup never would. Age is by mtime: a running export writes continuously, so only
 * an abandoned one goes a day untouched.
 */
export async function sweepStalePartialExports(
  dir: string = EXPORT_DIR,
  now: number = Date.now(),
  maxAgeMs: number = PARTIAL_MAX_AGE_MS,
): Promise<{ deleted: string[]; errors: string[] }> {
  const deleted: string[] = [];
  const errors: string[] = [];
  let names: string[];
  try {
    names = await readdir(dir);
  } catch (error: unknown) {
    if ((error as { code?: string })?.code === 'ENOENT') return { deleted, errors };
    throw error;
  }
  for (const name of names) {
    if (!name.endsWith(PARTIAL_SUFFIX)) continue;
    const file = join(dir, name);
    try {
      const info = await stat(file);
      if (!info.isFile() || now - info.mtimeMs < maxAgeMs) continue;
      await unlink(file);
      deleted.push(file);
    } catch (error: unknown) {
      if ((error as { code?: string })?.code === 'ENOENT') continue;
      errors.push(`${file}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return { deleted, errors };
}
