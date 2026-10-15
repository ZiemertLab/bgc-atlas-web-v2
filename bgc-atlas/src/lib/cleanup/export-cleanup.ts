import { unlink } from 'fs/promises';
import prisma from '@/lib/prisma';

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
