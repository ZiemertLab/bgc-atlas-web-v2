import { beforeEach, describe, expect, it, vi } from 'vitest';

const { limitState } = vi.hoisted(() => ({
  limitState: { success: true, remaining: 5 },
}));

vi.mock('@/lib/rate-limit', () => ({
  exportRateLimit: {
    getRemaining: vi.fn(async () => ({ remaining: limitState.remaining, reset: Date.now() + 600_000 })),
  },
  checkRateLimit: vi.fn(async () => (limitState.success
    ? { success: true, limit: 20, remaining: 4, reset: 0 }
    : { success: false, limit: 20, remaining: 0, reset: 0, error: 'Rate limit exceeded.' })),
  getClientIp: () => '127.0.0.1',
}));

import { checkRateLimit } from '@/lib/rate-limit';
import { ExportRefusedError, MAX_CONCURRENT_EXPORTS, handleExport, type ExportSource, type ExportSpec } from './stream';
import type { ExportColumn } from './format';

interface Row { id: string }
const columns: ExportColumn<Row>[] = [{ id: 'id', label: 'ID', value: (r) => r.id }];

/** A source of `batches`, optionally failing before batch `failAt`. */
function source(batches: string[][], { total, failAt }: { total?: number; failAt?: number } = {}) {
  const close = vi.fn(async () => {});
  const rows = batches.map((b) => b.map((id) => ({ id })));
  async function* rest(): AsyncGenerator<Row[], void, void> {
    for (let i = 1; i < rows.length; i++) {
      if (failAt === i) throw new Error('opensearch went away');
      yield rows[i];
    }
  }
  const src: ExportSource<Row> = {
    total: total ?? rows.flat().length, first: rows[0] ?? [], rest: rest(), close,
  };
  return { src, close };
}

const specWith = (open: ExportSpec<Row>['open'], over: Partial<ExportSpec<Row>> = {}): ExportSpec<Row> => ({
  stem: 'things',
  columns,
  refusal: () => null,
  count: async () => 3,
  open,
  ...over,
});

const get = (qs: string) => new Request(`http://localhost/api/things/export?${qs}`);

beforeEach(() => {
  limitState.success = true;
  limitState.remaining = 5;
});

describe('check', () => {
  it('reports the rows and whether the cap applies, consuming nothing', async () => {
    const res = await handleExport(get('format=csv&check=1'), specWith(vi.fn(), { count: async () => 250_000 }));
    expect(await res.json()).toEqual({ ok: true, total: 250_000, rows: 100_000, capped: true });
  });

  it('passes the list query through without the export params', async () => {
    const count = vi.fn(async (_params: URLSearchParams) => 1);
    await handleExport(get('category=NRPS&limit=50&offset=100&format=csv&check=1'), specWith(vi.fn(), { count }));
    expect(count.mock.calls[0][0].toString()).toBe('category=NRPS');
  });

  it.each([
    ['a filter only PostgreSQL answers', { refusal: () => 'No bbox.' }, 'No bbox.'],
    ['a refusal raised while counting', { count: async () => { throw new ExportRefusedError('Bad bucket.'); } }, 'Bad bucket.'],
    ['an empty result', { count: async () => 0 }, 'Nothing matches these filters.'],
  ])('refuses %s with the reason', async (_label, over, reason) => {
    const res = await handleExport(get('format=tsv&check=1'), specWith(vi.fn(), over as Partial<ExportSpec<Row>>));
    expect(await res.json()).toMatchObject({ ok: false, reason });
  });

  it('says so when the hourly budget is spent', async () => {
    limitState.remaining = 0;
    const res = await handleExport(get('format=tsv&check=1'), specWith(vi.fn()));
    expect((await res.json()).reason).toMatch(/Export limit reached/);
  });
});

describe('download', () => {
  it('streams the header, every batch and closes the source', async () => {
    const { src, close } = source([['a', 'b'], ['c']]);
    const res = await handleExport(get('format=csv'), specWith(async () => src));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-disposition')).toMatch(/attachment; filename="things_3_\d{8}-\d{4}\.csv"/);
    expect(res.headers.get('x-accel-buffering')).toBe('no');
    expect(await res.text()).toBe('ID\na\nb\nc\n');
    expect(close).toHaveBeenCalledOnce();
  });

  it('names a capped file as the first rows of the total', async () => {
    const { src } = source([['a']], { total: 250_000 });
    const res = await handleExport(get('format=tsv'), specWith(async () => src));
    expect(res.headers.get('content-disposition')).toContain('things_first100000of250000_');
    await res.body?.cancel(); // a reader that walks away releases its slot
  });

  it('aborts the stream on a mid-file failure rather than ending short', async () => {
    const { src, close } = source([['a'], ['b'], ['c']], { failAt: 2 });
    const res = await handleExport(get('format=csv'), specWith(async () => src));
    await expect(res.text()).rejects.toThrow();
    expect(close).toHaveBeenCalledOnce();
  });

  it.each([
    ['refused', { refusal: () => 'No bbox.' }, 409],
    ['an unknown format', {}, 400, 'format=xlsx'],
  ])('answers %s as a failed download, not a page', async (_label, over, status, qs = 'format=csv') => {
    const res = await handleExport(get(qs), specWith(vi.fn(), over as Partial<ExportSpec<Row>>));
    expect(res.status).toBe(status);
    expect(res.headers.get('content-disposition')).toMatch(/^attachment; filename="things_export_failed\.txt"/);
  });

  it('answers a spent budget as a failed download', async () => {
    limitState.success = false;
    const res = await handleExport(get('format=csv'), specWith(vi.fn()));
    expect(res.status).toBe(429);
    expect(res.headers.get('content-disposition')).toContain('attachment');
  });

  it('answers a source that fails before the first row as a failed download', async () => {
    const res = await handleExport(get('format=csv'), specWith(async () => { throw new Error('down'); }));
    expect(res.status).toBe(500);
    expect(res.headers.get('content-disposition')).toContain('attachment');
  });

  it(`runs ${MAX_CONCURRENT_EXPORTS} at once and queues the next until one finishes`, async () => {
    const open = vi.fn(async () => source([['a']]).src);
    const held = await Promise.all(
      Array.from({ length: MAX_CONCURRENT_EXPORTS }, () => handleExport(get('format=csv'), specWith(open))),
    );
    let thirdDone = false;
    const third = handleExport(get('format=csv'), specWith(open)).then((r) => { thirdDone = true; return r; });
    await new Promise((r) => setTimeout(r, 20));
    expect(thirdDone).toBe(false);
    await held[0].text(); // finishing one releases its slot
    const res = await third;
    expect(res.status).toBe(200);
    await Promise.all([held[1].text(), res.text()]);
  });
});

/**
 * Bodies Next never reads (lib/http/abandoned-body). Each test would leave a slot
 * taken if the fix regressed, so the last one checks that every slot is free.
 */
describe('abandoned downloads', () => {
  const tick = () => new Promise((r) => setTimeout(r, 10));

  it('answers HEAD with headers only: no source, no slot, no export spent', async () => {
    const open = vi.fn();
    vi.mocked(checkRateLimit).mockClear();
    const res = await handleExport(new Request('http://localhost/api/things/export?format=csv', { method: 'HEAD' }), specWith(open));
    expect(res.status).toBe(200);
    expect(res.body).toBeNull();
    expect(res.headers.get('content-type')).toContain('text/csv');
    expect(res.headers.get('content-disposition')).toContain('attachment');
    expect(open).not.toHaveBeenCalled();
    expect(checkRateLimit).not.toHaveBeenCalled();
  });

  it('still refuses a HEAD the download itself would refuse', async () => {
    const res = await handleExport(
      new Request('http://localhost/api/things/export?format=csv', { method: 'HEAD' }),
      specWith(vi.fn(), { refusal: () => 'No bbox.' }),
    );
    expect(res.status).toBe(409);
  });

  it('releases the slot and closes the source when the client leaves before reading', async () => {
    const { src, close } = source([['a'], ['b']]);
    const ac = new AbortController();
    const req = new Request('http://localhost/api/things/export?format=csv', { signal: ac.signal });
    const res = await handleExport(req, specWith(async () => src));
    expect(res.status).toBe(200);
    ac.abort();
    await tick();
    expect(close).toHaveBeenCalled();
  });

  it('releases at once when the client had already left by the time the route returned', async () => {
    const { src, close } = source([['a']]);
    const ac = new AbortController();
    const req = new Request('http://localhost/api/things/export?format=csv', { signal: ac.signal });
    const pending = handleExport(req, specWith(async () => { ac.abort(); return src; }));
    await pending;
    await tick();
    expect(close).toHaveBeenCalled();
  });

  it('leaves every slot free afterwards', async () => {
    const open = vi.fn(async () => source([['a']]).src);
    const all = await Promise.all(
      Array.from({ length: MAX_CONCURRENT_EXPORTS }, () => handleExport(get('format=csv'), specWith(open))),
    );
    expect(all.every((r) => r.status === 200)).toBe(true);
    await Promise.all(all.map((r) => r.text()));
  });
});
