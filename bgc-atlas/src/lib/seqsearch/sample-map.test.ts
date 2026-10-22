import { beforeEach, describe, expect, it, vi } from 'vitest';

const { queryRaw, bgcFacetDocs, sampleBrowseDocs } = vi.hoisted(() => ({
  queryRaw: vi.fn(),
  bgcFacetDocs: vi.fn(),
  sampleBrowseDocs: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({ default: { $queryRaw: queryRaw } }));
vi.mock('@/lib/opensearch/client', () => ({ bgcFacetDocs, sampleBrowseDocs }));
// No cache: every call runs the query.
vi.mock('@/lib/cache', () => ({ getOrSetCache: (_key: string, fn: () => unknown) => fn() }));

import { getSequenceSampleMap } from './sample-map';

const SESSION = '6fff026f-9dba-4ed4-b933-459a2d0dda55';
const [B1, B2, B3, B4] = ['b1', 'b2', 'b3', 'b4'];

function sample(lat: number | null, extra: Record<string, unknown> = {}) {
  return { name: 'S', external_id: 'x|S', latitude: lat, longitude: lat === null ? null : 10, ...extra };
}

beforeEach(() => {
  queryRaw.mockReset();
  bgcFacetDocs.mockReset();
  sampleBrowseDocs.mockReset();
});

describe('getSequenceSampleMap', () => {
  it('counts hit BGCs per sample from the indexes, most hits first, dropping samples without coordinates', async () => {
    queryRaw.mockResolvedValueOnce([{ bgc_id: B1 }, { bgc_id: B2 }, { bgc_id: B3 }, { bgc_id: B4 }]);
    bgcFacetDocs.mockResolvedValue(new Map([
      [B1, { sample_id: 's-one' }],
      [B2, { sample_id: 's-two' }],
      [B3, { sample_id: 's-two' }],
      [B4, { sample_id: 's-nocoords' }],
    ]));
    sampleBrowseDocs.mockResolvedValue(new Map([
      ['s-one', sample(-16.06, { geographic_location: 'Indian Ocean' })],
      ['s-two', sample('47.5' as unknown as number)],
      ['s-nocoords', sample(null)],
    ]));

    const rows = await getSequenceSampleMap(SESSION, {}, true);

    expect(queryRaw).toHaveBeenCalledTimes(1); // only the session's own hit rows
    expect(rows.map((r) => [r.id, r.bgcCount])).toEqual([['s-two', 2], ['s-one', 1]]);
    expect(rows[0].latitude).toBe(47.5);
    expect(rows[0].location).toBe('47.5000, 10.0000');
    expect(rows[1].location).toBe('Indian Ocean');
  });

  it('resolves BGCs and samples the indexes lack from Postgres, by their ids only', async () => {
    queryRaw
      .mockResolvedValueOnce([{ bgc_id: B1 }, { bgc_id: B2 }])
      .mockResolvedValueOnce([{ bgc_id: B2, sample_id: 's-new' }])
      .mockResolvedValueOnce([{ id: 's-new', ...sample(1), geographic_location: null }]);
    bgcFacetDocs.mockResolvedValue(new Map([[B1, { sample_id: 's-one' }]]));
    sampleBrowseDocs.mockResolvedValue(new Map([['s-one', sample(2)]]));

    const rows = await getSequenceSampleMap(SESSION, {}, true);

    expect(queryRaw.mock.calls[1][0].values).toEqual([[B2]]);
    expect(queryRaw.mock.calls[2][0].values).toEqual([['s-new']]);
    expect(rows.map((r) => r.id).sort()).toEqual(['s-new', 's-one']);
  });
});
