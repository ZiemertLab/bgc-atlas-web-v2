import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * A sample id that is not a uuid is a 400, never a 500.
 *
 * These routes hand the id to a uuid-typed query (`::uuid` in raw SQL, or Prisma
 * on a uuid column), and Postgres rejects anything else with 22P02. That error
 * reached the client as a 500 for /samples/spire|spire_mag_00000337 and
 * /samples/RS_GCF_039519175.1 -- external ids and bare accessions people type --
 * while the main sample route already answered 404.
 * The guard must also run before any query or cache key is built.
 */

const { queryRaw, findUnique, findMany, count, cacheGet } = vi.hoisted(() => ({
  queryRaw: vi.fn(),
  findUnique: vi.fn(),
  findMany: vi.fn(),
  count: vi.fn(),
  cacheGet: vi.fn(),
}));

vi.mock('@/lib/redis-client', () => ({
  default: { get: cacheGet, set: vi.fn(), scan: vi.fn(), del: vi.fn() },
}));
vi.mock('@/lib/prisma', () => ({
  default: {
    $queryRaw: queryRaw,
    sample: { findUnique },
    study: { findMany },
    sampleMeasurement: { findMany, count },
  },
}));

import { GET as sourceTypes } from './source-types/route';
import { GET as assemblies } from './assemblies/route';
import { GET as measurements } from './measurements/route';
import { GET as studies } from './studies/route';

type Handler = (req: Request, ctx: { params: Promise<{ id: string }> }) => Promise<Response>;

const ROUTES: [string, Handler][] = [
  ['source-types', sourceTypes as Handler],
  ['assemblies', assemblies as Handler],
  ['measurements', measurements as Handler],
  ['studies', studies as Handler],
];

const BAD_IDS = ['spire|spire_mag_00000337', 'RS_GCF_039519175.1', 'not-a-uuid'];

const call = (handler: Handler, route: string, id: string) =>
  handler(new Request(`http://localhost/api/samples/${encodeURIComponent(id)}/${route}`), {
    params: Promise.resolve({ id }),
  });

beforeEach(() => {
  vi.clearAllMocks();
});

describe('sample sub-routes reject non-uuid ids', () => {
  for (const [route, handler] of ROUTES) {
    for (const id of BAD_IDS) {
      it(`${route}: ${id} -> 400 without touching the database or cache`, async () => {
        const res = await call(handler, route, id);
        expect(res.status).toBe(400);
        expect(queryRaw).not.toHaveBeenCalled();
        expect(findUnique).not.toHaveBeenCalled();
        expect(cacheGet).not.toHaveBeenCalled();
      });
    }
  }

  it('a well-formed uuid still reaches the query', async () => {
    cacheGet.mockResolvedValue(null);
    queryRaw.mockResolvedValue([]);
    const res = await call(sourceTypes as Handler, 'source-types', '81d1e103-a4cc-554a-ab8a-4a0864bbf843');
    expect(res.status).toBe(404);
    expect(queryRaw).toHaveBeenCalledTimes(1);
  });
});
