import { spawnSync } from 'child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterAll, afterEach, describe, expect, it } from 'vitest';

import { parseBiGSliceResults } from './index';

/**
 * A failed BiG-SLiCE report read must fail the job, never become "0 matches".
 *
 * Driven against the real parse_report.py over a small reports.db / data.db pair
 * laid out as BiG-SLiCE 2 writes them, and against stand-in scripts for the
 * failure modes the real one cannot be made to show.
 */

const dir = mkdtempSync(join(tmpdir(), 'bigslice-parse-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
afterEach(() => { delete process.env.BIGSLICE_PARSE_SCRIPT; });

const sqlite = (db: string, sql: string) => {
  const r = spawnSync('python3', ['-c', 'import sqlite3,sys; c=sqlite3.connect(sys.argv[1]); c.executescript(sys.argv[2]); c.commit()', db, sql]);
  if (r.status !== 0) throw new Error(String(r.stderr));
};

/** A workspace holding one report named `name` (or none), with the given membership rows. */
const workspace = (label: string, name: string | null, rows: [string, number, number, number][]) => {
  const ws = join(dir, label);
  mkdirSync(join(ws, 'reports', '1'), { recursive: true });
  sqlite(join(ws, 'reports', 'reports.db'),
    `CREATE TABLE reports (id INTEGER, name TEXT);${name ? ` INSERT INTO reports VALUES (1, '${name}');` : ''}`);
  sqlite(join(ws, 'reports', '1', 'data.db'),
    'CREATE TABLE bgc (id INTEGER, orig_filename TEXT); CREATE TABLE gcf_membership (bgc_id INTEGER, gcf_id INTEGER, membership_value REAL, rank INTEGER);'
    + rows.map(([f, gcf, v, rank], i) => ` INSERT INTO bgc VALUES (${i}, '${f}'); INSERT INTO gcf_membership VALUES (${i}, ${gcf}, ${v}, ${rank});`).join(''));
  const map = join(ws, 'filename_map.json');
  writeFileSync(map, JSON.stringify({ 'staged_1.gbk': 'my_region.gbk' }));
  return { ws, map };
};

describe('parseBiGSliceResults with the real parse_report.py', () => {
  it('reads a report and maps staged names back to the uploads', async () => {
    const { ws, map } = workspace('ok', 'sess_1', [['staged_1.gbk', 42, 0.31, 0]]);
    const parsed = await parseBiGSliceResults(ws, 'sess-1', map, 'seed');
    expect(parsed.results).toEqual([{ origFilename: 'my_region.gbk', bigsliceGcfId: 42, distance: 0.31, rank: 0, tier: 'seed' }]);
  });

  it('still answers "no matches" for a report that exists and is empty', async () => {
    const { ws, map } = workspace('empty', 'sess_2', []);
    expect((await parseBiGSliceResults(ws, 'sess-2', map, 'seed')).results).toEqual([]);
  });

  it('fails when the query has no report, instead of reporting 0 matches', async () => {
    const { ws, map } = workspace('missing', 'some_other_query', [['staged_1.gbk', 42, 0.31, 0]]);
    await expect(parseBiGSliceResults(ws, 'sess-3', map, 'seed')).rejects.toThrow(/no BiG-SLiCE report named 'sess_3'/);
  });

  it('fails when the workspace has no reports.db at all', async () => {
    await expect(parseBiGSliceResults(join(dir, 'nowhere'), 'sess-4', join(dir, 'x.json'), 'seed')).rejects.toThrow(/exited 1/);
  });
});

describe('parseBiGSliceResults failure modes', () => {
  const script = (name: string, body: string) => {
    const p = join(dir, name);
    writeFileSync(p, body);
    process.env.BIGSLICE_PARSE_SCRIPT = p;
  };

  it('rejects output that is not JSON', async () => {
    script('junk.py', 'print("Traceback (most recent call last): nope")');
    await expect(parseBiGSliceResults(dir, 's', 'm', 'seed')).rejects.toThrow(/printed no JSON/);
  });

  it('rejects JSON without a results array', async () => {
    script('shape.py', 'print("{}")');
    await expect(parseBiGSliceResults(dir, 's', 'm', 'seed')).rejects.toThrow(/no results array/);
  });
});
