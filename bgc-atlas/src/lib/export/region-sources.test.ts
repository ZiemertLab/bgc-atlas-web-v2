import { beforeEach, describe, expect, it, vi } from 'vitest';

const search = vi.fn();
const findRuns = vi.fn();

vi.mock('@/lib/opensearch/browse-client', () => ({
  searchBrowseIndexWithBody: (...args: unknown[]) => search(...args),
}));
vi.mock('@/lib/prisma', () => ({
  default: { antiSmashRun: { findMany: (...args: unknown[]) => findRuns(...args) } },
}));

const { exportRegionsByIds, exportRegionsByGcf, toExportRegion } = await import('./region-sources');

const doc = (id: string, run: string | null, path: string | null, filename = `${id}.region001`) => ({
  bgc_id: id,
  filename,
  ...(run ? { antismash_run_id: run } : {}),
  ...(path ? { archive_path: path } : {}),
});

beforeEach(() => {
  search.mockReset();
  findRuns.mockReset();
});

describe('toExportRegion', () => {
  it('drops a document with no filename: there is nothing to look for', () => {
    expect(toExportRegion({ bgc_id: 'b1' })).toBeNull();
  });

  it('carries the combined-archive offset when the index has one', () => {
    expect(toExportRegion({ bgc_id: 'b1', filename: 'f', gbk_offset: 0, gbk_length: 23000 }))
      .toMatchObject({ gbkOffset: 0, gbkLength: 23000 });
    expect(toExportRegion({ bgc_id: 'b1', filename: 'f', gbk_offset: -1, gbk_length: 'x' }))
      .toMatchObject({ gbkOffset: null, gbkLength: null });
  });
});

describe('exportRegionsByIds', () => {
  it('reads ids from bgc_browse in chunks and never touches PostgreSQL when paths are indexed', async () => {
    const ids = Array.from({ length: 1500 }, (_, i) => `b${String(i).padStart(4, '0')}`);
    search.mockImplementation(async (_entity: string, body: { query: { ids: { values: string[] } } }) => ({
      total: 0,
      documents: body.query.ids.values.map((id) => doc(id, 'r1', '/ceph/r1.tar.gz')),
    }));

    const regions = await exportRegionsByIds(ids);

    expect(search).toHaveBeenCalledTimes(2);
    expect(search.mock.calls[0][1].query.ids.values).toHaveLength(1000);
    expect(regions).toHaveLength(1500);
    expect(regions[0]).toEqual({
      bgcId: 'b0000', filename: 'b0000.region001', runId: 'r1', archivePath: '/ceph/r1.tar.gz',
      gbkOffset: null, gbkLength: null,
    });
    expect(findRuns).not.toHaveBeenCalled();
  });

  it('falls back to antismash_runs once per distinct run for documents without a path', async () => {
    search.mockResolvedValue({
      total: 0,
      documents: [doc('b2', 'r1', null), doc('b1', 'r1', null), doc('b3', 'r2', '/ceph/r2.tar.gz')],
    });
    findRuns.mockResolvedValue([{ id: 'r1', file_path: '/ceph/r1.tar.gz' }]);

    const regions = await exportRegionsByIds(['b1', 'b2', 'b3']);

    expect(findRuns).toHaveBeenCalledTimes(1);
    expect(findRuns.mock.calls[0][0].where.id.in).toEqual(['r1']);
    expect(regions.map((r) => [r.bgcId, r.archivePath])).toEqual([
      ['b1', '/ceph/r1.tar.gz'],
      ['b2', '/ceph/r1.tar.gz'],
      ['b3', '/ceph/r2.tar.gz'],
    ]);
  });
});

describe('exportRegionsByGcf', () => {
  it('pages the family with search_after on bgc_id until a short page', async () => {
    const page = (from: number, n: number) =>
      Array.from({ length: n }, (_, i) => doc(`b${String(from + i).padStart(4, '0')}`, 'r1', '/p'));
    search
      .mockResolvedValueOnce({ total: 0, documents: page(0, 1000) })
      .mockResolvedValueOnce({ total: 0, documents: page(1000, 3) });

    const regions = await exportRegionsByGcf('g1');

    expect(regions).toHaveLength(1003);
    expect(search.mock.calls[0][1].query).toEqual({ term: { gcf_id: 'g1' } });
    expect(search.mock.calls[0][1].search_after).toBeUndefined();
    expect(search.mock.calls[1][1].search_after).toEqual(['b0999']);
  });
});
