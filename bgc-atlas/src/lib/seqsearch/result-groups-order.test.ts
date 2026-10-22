import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The results page pages (query, BGC) groups with LIMIT/OFFSET, so its ORDER BY must
 * end on something unique. Ties on the sort values are common -- identical proteins
 * across genomes; 84 groups at (7.64e-91, 283.00) in one real session -- and without a
 * unique last key Postgres returned them in a different order per page: 999 rows held
 * 987 BGCs, 12 twice and 12 never.
 */

const { sqls } = vi.hoisted(() => ({ sqls: [] as string[] }));
vi.mock('@/lib/prisma', () => {
  const $queryRaw = vi.fn(async (query: { sql: string }) => {
    sqls.push(query.sql);
    return query.sql.includes('count(*)::bigint') ? [{ count: BigInt(0) }] : [];
  });
  return { default: { $queryRaw }, prisma: { $queryRaw } };
});

const { getResultGroups } = await import('./database');

beforeEach(() => { sqls.length = 0; });

describe('getResultGroups ordering', () => {
  it.each(['evalue', 'identity', 'bitscore', 'querygenes'] as const)(
    'ends the %s ordering on the group key, which is unique',
    async (sortBy) => {
      for (const sortOrder of ['asc', 'desc'] as const) {
        sqls.length = 0;
        await getResultGroups('s1', { sortBy, sortOrder, limit: 25, offset: 25 });
        const page = sqls.find((s) => /\bLIMIT\b/.test(s));
        expect(page).toBeDefined();
        expect(page!.replace(/\s+/g, ' ')).toMatch(/ORDER BY [^;]*, 1 ASC\s*LIMIT/);
      }
    },
  );
});
