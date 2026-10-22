import { join } from 'path';

/** Where the GBK zip exports are written, and how long they are kept. */
export const EXPORT_DIR = process.env.GCF_EXPORT_DIR || '/tmp/gcf-exports';
export const RETENTION_DAYS = parseInt(process.env.EXPORT_RETENTION_DAYS || '7', 10);

/**
 * Where a GCF export's zip lives on disk: one file per export job. The name the
 * user downloads it under is the record's output_filename, not this.
 */
export const gcfExportPath = (exportJobId: string): string =>
  join(EXPORT_DIR, `gcf-${exportJobId}.zip`);

/** An export's zip while it is being written; renamed into place when complete. */
export const PARTIAL_SUFFIX = '.partial';
