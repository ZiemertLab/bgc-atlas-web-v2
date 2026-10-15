/** Where the GBK zip exports are written, and how long they are kept. */
export const EXPORT_DIR = process.env.GCF_EXPORT_DIR || '/tmp/gcf-exports';
export const RETENTION_DAYS = parseInt(process.env.EXPORT_RETENTION_DAYS || '7', 10);

