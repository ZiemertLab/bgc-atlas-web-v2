import { beforeEach, describe, expect, it, vi } from 'vitest';

const { executeRaw, updateMany } = vi.hoisted(() => ({ executeRaw: vi.fn(), updateMany: vi.fn() }));
vi.mock('@/lib/prisma', () => ({
  default: { $executeRaw: executeRaw, gcfExportJob: { updateMany } },
}));

import { closeJobRecord, closeOrphanedJobRecords } from './job-records';
import { EXPORT_INTERRUPTED_MESSAGE, SEARCH_INTERRUPTED_MESSAGE, publicJobError } from '@/lib/api/errors';

/** The SQL text and bound values of the n-th $executeRaw call. */
const call = (n: number) => {
  const [strings, ...values] = executeRaw.mock.calls[n] as [TemplateStringsArray, ...unknown[]];
  const sql = (value: unknown): string =>
    value && typeof value === 'object' && 'strings' in value ? (value as { strings: string[] }).strings.join('?') : '?';
  return { text: strings.reduce((acc, s, i) => acc + (i ? sql(values[i - 1]) : '') + s, ''), values };
};

beforeEach(() => {
  executeRaw.mockReset().mockResolvedValue(1);
  updateMany.mockReset().mockResolvedValue({ count: 1 });
});

describe('closeJobRecord', () => {
  it('closes a sequence session only while it is still open', async () => {
    await closeJobRecord({ type: 'sequence', sessionId: 's1' } as never, 'boom');
    const { text, values } = call(0);
    expect(text).toContain('sequence_search_sessions');
    expect(text).toContain("status = 'failed'");
    expect(values).toContain('s1');
    expect(values).toContainEqual(['pending', 'running']);
  });

  it('closes a BiG-SLiCE session in its own table', async () => {
    await closeJobRecord({ type: 'bgc', sessionId: 's2' } as never, 'boom');
    expect(call(0).text).toContain('bigslice_search_sessions');
  });

  it('closes an export by its record id', async () => {
    const changed = await closeJobRecord({ type: 'property-gbk-export', exportJobId: 'e1' } as never, 'boom');
    expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'e1', status: { in: ['pending', 'running'] } },
      data: expect.objectContaining({ status: 'failed', error_message: 'boom' }),
    }));
    expect(changed).toBe(true);
  });

  it('reports no change for a record that had already finished', async () => {
    updateMany.mockResolvedValue({ count: 0 });
    expect(await closeJobRecord({ type: 'gcf-gbk-export', exportJobId: 'e2' } as never, 'x')).toBe(false);
  });
});

describe('closeOrphanedJobRecords', () => {
  it('closes old open records whose job is in no live queue state, per queue', async () => {
    const closed = await closeOrphanedJobRecords(new Set(['181']), new Set(['e-live']));
    expect(closed).toEqual({ sequence: 1, bgc: 1, export: 1 });
    const [seq, bgc, exp] = [call(0), call(1), call(2)];
    expect(seq.text).toContain('sequence_search_sessions');
    expect(seq.values).toContainEqual(['181']);
    expect(seq.values).toContain(SEARCH_INTERRUPTED_MESSAGE);
    expect(bgc.text).toContain('bigslice_search_sessions');
    expect(exp.text).toContain('gcf_export_jobs');
    expect(exp.values).toContainEqual(['e-live']);
    expect(exp.values).toContain(EXPORT_INTERRUPTED_MESSAGE);
    for (const c of [seq, bgc, exp]) {
      expect(c.text).toContain("job_id IS NULL OR NOT (job_id = ANY(");
      expect(c.text).toContain('created_at <');
    }
  });

  it('writes messages the reader is shown as they are', () => {
    expect(publicJobError('search', SEARCH_INTERRUPTED_MESSAGE)).toBe(SEARCH_INTERRUPTED_MESSAGE);
    expect(publicJobError('export', EXPORT_INTERRUPTED_MESSAGE)).toBe(EXPORT_INTERRUPTED_MESSAGE);
  });
});
