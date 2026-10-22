import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * What the sitemap lists. Every URL in it is one a crawler should index: listed
 * families only, each study once under its canonical id, and a lastmod that moves
 * when the data does (the release date), not on every request.
 *
 * `@/lib/prisma` is mocked -- vitest otherwise reaches the LIVE DB -- and answers by
 * which table the SQL reads.
 */

const { queryRaw, release } = vi.hoisted(() => ({
  queryRaw: vi.fn(),
  release: { latest: { date: '2026-10-14' } as { date: string } | null },
}));

vi.mock('@/lib/prisma', () => ({ default: { $queryRaw: queryRaw }, prisma: { $queryRaw: queryRaw } }));
vi.mock('@/lib/releases/read', () => ({ readReleases: async () => release }));

import sitemap, { generateSitemaps } from './sitemap';
import { GET as sitemapIndex } from './sitemap.xml/route';

const sqlOf = (call: unknown[]) => (call[0] as { text?: string; strings?: string[] }).text
  ?? (call[0] as { strings: string[] }).strings.join('?');

beforeEach(() => {
  release.latest = { date: '2026-10-14' };
  queryRaw.mockReset();
  queryRaw.mockImplementation(async (q: unknown) => {
    const sql = sqlOf([q]);
    if (/COUNT\(\*\)[^]*FROM gcfs/.test(sql)) return [{ count: BigInt(1) }];
    if (/COUNT\(\*\)[^]*FROM study_bgc_summary/.test(sql)) return [{ count: BigInt(1) }];
    if (/FROM gcfs/.test(sql)) return [{ gcf_id: 'gcf-1' }];
    if (/FROM study_bgc_summary/.test(sql)) return [{ id: 'study-1' }];
    throw new Error(`unexpected SQL: ${sql}`);
  });
});

describe('sitemap', () => {
  it('counts and lists listed families only', async () => {
    await sitemap({ id: 1 });
    const gcfSql = queryRaw.mock.calls.map(sqlOf).filter((s) => /FROM gcfs/.test(s));
    expect(gcfSql.length).toBeGreaterThanOrEqual(2);
    for (const sql of gcfSql) expect(sql).toMatch(/WHERE listed/);
  });

  it('lists each study once, by its canonical id, and only studies with BGCs', async () => {
    await generateSitemaps();
    const entries = await sitemap({ id: 2 });
    expect(entries.map((e) => e.url)).toEqual([expect.stringMatching(/\/studies\/study-1$/)]);
    const studySql = queryRaw.mock.calls.map(sqlOf).filter((s) => /study/.test(s));
    expect(studySql.length).toBeGreaterThanOrEqual(2);
    for (const sql of studySql) {
      expect(sql).toMatch(/FROM study_bgc_summary/);
      expect(sql).toMatch(/total_bgcs > 0/);
      expect(sql).not.toMatch(/FROM studies\b/);
    }
  });

  it('shards static routes, then families, then studies', async () => {
    expect(await generateSitemaps()).toEqual([{ id: 0 }, { id: 1 }, { id: 2 }]);
  });

  it('dates every entry to the current release, not the request', async () => {
    for (const id of [0, 1, 2]) {
      for (const entry of await sitemap({ id })) {
        expect(entry.lastModified).toEqual(new Date('2026-10-14'));
      }
    }
  });

  it('leaves lastmod out when no release is readable', async () => {
    release.latest = null;
    for (const entry of await sitemap({ id: 0 })) expect(entry.lastModified).toBeUndefined();
    const body = await (await sitemapIndex()).text();
    expect(body).not.toMatch(/lastmod/);
  });

  it('dates the index to the release too', async () => {
    const body = await (await sitemapIndex()).text();
    expect(body.match(/<lastmod>[^<]*<\/lastmod>/g)).toEqual(
      Array(3).fill(`<lastmod>${new Date('2026-10-14').toISOString()}</lastmod>`),
    );
  });
});
