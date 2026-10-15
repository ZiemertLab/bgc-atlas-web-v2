import { beforeEach, describe, expect, it, vi } from 'vitest';

// A fake index of N documents sorted by `n` then id.
const { index, calls } = vi.hoisted(() => ({
  index: { docs: [] as { id: string; n: number }[], failOnCall: -1 },
  calls: { search: [] as Record<string, unknown>[], closed: [] as string[] },
}));

vi.mock('@/lib/opensearch/browse-client', () => ({
  openBrowsePit: vi.fn(async () => 'pit-1'),
  closeBrowsePit: vi.fn(async (id: string) => { calls.closed.push(id); }),
  countBrowseIndex: vi.fn(async () => index.docs.length),
  searchBrowsePit: vi.fn(async (body: Record<string, unknown>) => {
    calls.search.push(body);
    if (calls.search.length === index.failOnCall) throw new Error('OpenSearch 503');
    const after = body.search_after as [number, string] | undefined;
    const start = after
      ? index.docs.findIndex((d) => d.n > after[0] || (d.n === after[0] && d.id > after[1]))
      : 0;
    const slice = start < 0 ? [] : index.docs.slice(start, start + (body.size as number));
    return {
      total: body.track_total_hits ? index.docs.length : null,
      hits: slice.map((d) => ({ source: { gcf_id: d.id, n: d.n }, sort: [d.n, d.id] })),
    };
  }),
}));

import { openBrowseExport } from './browse-export';
import { EXPORT_BATCH } from './stream';

const fill = (count: number) => {
  index.docs = Array.from({ length: count }, (_, i) => ({ id: `id${String(i).padStart(6, '0')}`, n: i % 7 }))
    .sort((a, b) => a.n - b.n || a.id.localeCompare(b.id));
};

async function readAll(cap: number) {
  const src = await openBrowseExport('gcfs', new URLSearchParams('sortField=memberCount&sortOrder=asc'), cap,
    async (docs) => docs.map((d) => String(d.gcf_id)));
  const out = [...src.first];
  for await (const batch of src.rest) out.push(...batch);
  await src.close();
  return { src, out };
}

beforeEach(() => {
  calls.search = [];
  calls.closed = [];
  index.failOnCall = -1;
});

describe('openBrowseExport', () => {
  it('reads every row once, in order, across batches', async () => {
    fill(EXPORT_BATCH * 2 + 17);
    const { src, out } = await readAll(100_000);
    expect(src.total).toBe(EXPORT_BATCH * 2 + 17);
    expect(out).toEqual(index.docs.map((d) => d.id));
    expect(calls.search).toHaveLength(3);
    expect(calls.search.every((b) => (b.pit as { id: string }).id === 'pit-1')).toBe(true);
    expect(calls.closed).toEqual(['pit-1']);
  });

  it('stops at the cap and reports the true total', async () => {
    fill(EXPORT_BATCH + 500);
    const { src, out } = await readAll(EXPORT_BATCH + 10);
    expect(src.total).toBe(EXPORT_BATCH + 500);
    expect(out).toHaveLength(EXPORT_BATCH + 10);
    expect(calls.search.at(-1)!.size).toBe(10);
  });

  it('uses the list route\'s own sort, ending on the id tiebreak', async () => {
    fill(3);
    await readAll(100_000);
    expect(calls.search[0].sort).toEqual([
      { member_bgc_count: { order: 'asc' } },
      { gcf_id: { order: 'asc' } },
    ]);
  });

  it('releases the snapshot when the first page fails', async () => {
    fill(10);
    index.failOnCall = 1;
    await expect(readAll(100_000)).rejects.toThrow('OpenSearch 503');
    expect(calls.closed).toEqual(['pit-1']);
  });
});
