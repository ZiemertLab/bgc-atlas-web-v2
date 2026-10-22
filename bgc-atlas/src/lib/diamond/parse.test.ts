import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterAll, describe, expect, it } from 'vitest';

import { parseDiamondResults } from './index';

const dir = mkdtempSync(join(tmpdir(), 'diamond-parse-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const tsv = (rows: string[][]) => {
  const file = join(dir, `r${Math.random().toString(36).slice(2)}.tsv`);
  writeFileSync(file, rows.map((r) => r.join('\t')).join('\n') + '\n');
  return file;
};

// qseqid sseqid pident length mismatch gapopen qstart qend sstart send evalue bitscore qlen slen qseq sseq btop
const row = (qseqid: string, btop: string) => [
  qseqid, 'bgc_ctg1_5537', '100', '208', '0', '0', '1', '208', '1', '208', '3.93e-150', '424', '208', '208', 'MAAE', 'MAAE', btop,
];

describe('parseDiamondResults', () => {
  it('keeps an empty first field in place instead of shifting the row (session 8c49438b)', async () => {
    // A header like "> kcn" gives DIAMOND an empty query id, so every row starts with
    // a tab. content.trim() used to strip it from the FIRST row only.
    const hits = await parseDiamondResults(tsv([row('', '4'), row('', '4')]));
    expect(hits).toHaveLength(2);
    for (const hit of hits) {
      expect(hit.queryId).toBe('');
      expect(hit.targetId).toBe('bgc_ctg1_5537');
      expect(hit.identity).toBe(100);
      expect(hit.eValue).toBe(3.93e-150);
      expect(hit.targetLen).toBe(208);
    }
  });

  it('keeps an empty last field on the last row', async () => {
    const hits = await parseDiamondResults(tsv([row('q1', '4'), row('q1', '')]));
    expect(hits).toHaveLength(2);
    expect(hits[1].queryId).toBe('q1');
    expect(hits[1].targetLen).toBe(208);
  });

  it('reads CRLF output and skips blank lines', async () => {
    const file = join(dir, 'crlf.tsv');
    writeFileSync(file, `${row('q1', '4').join('\t')}\r\n\r\n${row('q2', '4').join('\t')}\r\n`);
    const hits = await parseDiamondResults(file);
    expect(hits.map((h) => h.queryId)).toEqual(['q1', 'q2']);
  });
});
