import { describe, expect, it, vi } from 'vitest';

// Mocked: vitest otherwise reaches the LIVE DB.
const { queryRaw } = vi.hoisted(() => ({ queryRaw: vi.fn() }));
vi.mock('@/lib/prisma', () => ({ default: { $queryRaw: queryRaw }, prisma: { $queryRaw: queryRaw } }));

import { loadStudy, studyName, type StudyRow } from './entity-loaders';

describe('loadStudy', () => {
  it('returns the canonical study_id the layout redirects to', async () => {
    const row = { study_id: 'canonical' };
    queryRaw.mockResolvedValueOnce([row]);
    const result = await loadStudy('11111111-2222-4333-8444-555555555555');
    expect(result).toEqual({ status: 'ok', row });
    const sql = (queryRaw.mock.calls[0][0] as { strings: string[] }).strings.join('?');
    expect(sql).toMatch(/sbs\.study_id::text AS study_id/);
    expect(sql).toMatch(/sbs\.accession/);
  });
});

describe('studyName', () => {
  it('names the "N/A" study by its accession', () => {
    const row = { title: 'N/A', study_name: 'N/A', study_key: 'N/A', accession: 'MGYS00006083' } as StudyRow;
    expect(studyName(row)).toBe('MGYS00006083');
  });
});
