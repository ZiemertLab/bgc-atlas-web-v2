import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * A failed export: the reader is mailed at the address on the RECORD (a reader who
 * asked while it ran was attached there).
 */

const { failedMail } = vi.hoisted(() => ({
  failedMail: vi.fn(async () => {}),
}));

vi.mock('@/lib/prisma', () => ({
  default: {
    gcfExportJob: {
      update: vi.fn(async () => ({})),
      findUnique: vi.fn(async () => ({ user_email: 'late@example.org' })),
    },
  },
}));
vi.mock('@/lib/mail/export-notification', () => ({
  exportJobUrl: (id: string) => `https://example.org/exports/${id}`,
  sendExportFailedEmail: failedMail,
  sendExportReadyEmail: vi.fn(),
}));
vi.mock('@/lib/export/region-sources', () => ({
  exportRegionsByGcf: async () => { throw new Error('index unreachable'); },
  exportRegionsByIds: async () => [],
}));
vi.mock('@/lib/export/region-zip', () => ({ createRegionZip: vi.fn() }));
vi.mock('@/lib/opensearch/client', () => ({ scrollHits: vi.fn() }));
vi.mock('@/lib/seqsearch/database', () => ({ getHitBgcIds: vi.fn() }));

const { processGcfGbkExport } = await import('./gcf-export');

beforeEach(() => { failedMail.mockClear(); });

describe('processGcfGbkExport on failure', () => {
  it('mails the record\'s reader', async () => {
    const job = { updateProgress: vi.fn(async () => {}) } as never;
    await expect(processGcfGbkExport(job, {
      type: 'gcf-gbk-export', exportJobId: 'e1', gcfId: 'g1', gcfName: 'GCF-x',
    } as never)).rejects.toThrow('index unreachable');
    expect(failedMail).toHaveBeenCalledWith(expect.objectContaining({ to: 'late@example.org', exportJobId: 'e1' }));
  });
});
