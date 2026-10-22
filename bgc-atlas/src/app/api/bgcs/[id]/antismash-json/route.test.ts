import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

let runDir: string;

vi.mock('@/lib/prisma', () => ({
  default: {
    $queryRaw: async () => [{ antismash_run_id: 'run-1', contig: 'CM1.1', anchor: 'r1c1' }],
  },
}));
vi.mock('@/lib/bgc/redirect', () => ({
  findBgcRedirect: async () => null,
  redirectToTwin: () => new Response(null, { status: 308 }),
}));
vi.mock('@/lib/api/antismash', () => ({
  getAntismashRun: async (id: string) => ({ id, bgcs: [] }),
  getAntismashRunExtractionDir: () => runDir,
  startAntismashRunExtraction: async () => ({ status: 'ready' }),
  findAntismashResultsJsonPath: async () => null,
  touchAntismashRunExtraction: () => {},
}));

const opened: string[] = [];
const streams: Array<{ destroyed: boolean }> = [];
vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return {
    ...actual,
    createReadStream: (file: string, ...rest: unknown[]) => {
      opened.push(file);
      const stream = (actual.createReadStream as (...a: unknown[]) => { destroyed: boolean })(file, ...rest);
      streams.push(stream);
      return stream;
    },
  };
});

const { GET } = await import('./route');

const BGC = 'ecedd622-03ca-58bb-8472-fd22edaf418e';
const json = JSON.stringify({ records: [{ id: 'CM1.1', pad: 'x'.repeat(200_000) }] });

beforeAll(() => {
  runDir = mkdtempSync(path.join(tmpdir(), 'antismash-json-'));
  writeFileSync(path.join(runDir, `.bgc-region-${BGC}.json`), json);
});
afterAll(() => rmSync(runDir, { recursive: true, force: true }));
beforeEach(() => { opened.length = 0; streams.length = 0; });

const call = (method: string, signal?: AbortSignal) =>
  GET(new Request(`http://localhost/api/bgcs/${BGC}/antismash-json`, { method, signal }), {
    params: Promise.resolve({ id: BGC }),
  });

describe('BGC antiSMASH JSON', () => {
  it('answers HEAD with the headers, without opening the trimmed file', async () => {
    const res = await call('HEAD');
    expect(res.status).toBe(200);
    expect(res.body).toBeNull();
    expect(res.headers.get('Content-Type')).toBe('application/json; charset=utf-8');
    expect(res.headers.get('X-Record-Id')).toBe('CM1.1');
    expect(opened).toEqual([]);
  });

  it('streams the trimmed file on GET', async () => {
    const res = await call('GET');
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(json);
    expect(opened).toHaveLength(1);
  });

  it('closes the file when the client leaves before the body is read', async () => {
    const controller = new AbortController();
    const res = await call('GET', controller.signal);
    expect(res.status).toBe(200);
    controller.abort();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(streams[0].destroyed).toBe(true);
  });
});
