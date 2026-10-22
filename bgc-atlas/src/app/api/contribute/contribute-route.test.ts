import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, readdirSync, rmSync } from 'fs';
import { join } from 'path';

/**
 * POST /api/contribute: the mail it sends and the files it keeps.
 *
 * Every external effect is mocked -- Prisma (a contribution row), the mail
 * transport and the rate limiter -- and uploads land in a temp dir, so this
 * runs without the live database, SMTP or CephFS.
 */

const { uploads, sent, createContribution, createSample } = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const fs = require('fs') as typeof import('fs');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const os = require('os') as typeof import('os');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const p = require('path') as typeof import('path');
  const uploads = fs.mkdtempSync(p.join(os.tmpdir(), 'contribute-test-'));
  process.env.USER_UPLOADS_DIR = uploads;
  process.env.CONTRIBUTION_CC = 'team@example.org';
  return {
    uploads,
    sent: [] as Record<string, unknown>[],
    createContribution: vi.fn(async () => ({ id: 'c1' })),
    createSample: vi.fn(async (_args: { data: Record<string, unknown>[] }) => ({ count: 0 })),
  };
});

vi.mock('@prisma/client', () => ({ Prisma: {} }));
vi.mock('@/lib/prisma', () => {
  const tx = { userContribution: { create: createContribution }, userContributionSample: { createMany: createSample } };
  return { default: { ...tx, $transaction: async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx) } };
});
vi.mock('@/lib/mail/transport', () => ({
  buildMailTransport: () => ({ from: 'atlas@example.org', transporter: { sendMail: async (m: Record<string, unknown>) => { sent.push(m); } } }),
}));
vi.mock('@/lib/rate-limit', () => ({
  contributeRateLimit: {},
  getClientIp: () => '10.0.0.1',
  checkRateLimit: async () => ({ success: true, limit: 5, remaining: 4, reset: Date.now() + 1000 }),
}));
vi.mock('@/lib/redis-client', () => ({ default: {} }));

import { POST } from './route';
import { getTemplateDownloadContent } from '@/lib/metadata/template';

afterAll(() => rmSync(uploads, { recursive: true, force: true }));
beforeEach(() => { sent.length = 0; createContribution.mockClear(); createSample.mockClear(); });

const submit = async (fields: Record<string, string>, files: { name: string; content: string; type: string; field: string }[] = []) => {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  for (const f of files) form.append(f.field, new File([f.content], f.name, { type: f.type }));
  const req = new Request('http://localhost/api/contribute', { method: 'POST', body: form });
  const body = await req.arrayBuffer();
  return POST(new Request('http://localhost/api/contribute', {
    method: 'POST',
    headers: { 'content-type': req.headers.get('content-type')!, 'content-length': String(body.byteLength) },
    body,
  }));
};
const base = { name: 'A. Researcher', institute: 'Uni', description: 'Soil metagenomes', email: 'a@example.org' };
const fasta = { field: 'assemblies', name: 'sample_A.fasta', content: '>c1\nACGTACGTACGT\n', type: 'text/plain' };

describe('POST /api/contribute', () => {
  it('refuses a recipient list in the email field, before anything is saved or sent', async () => {
    const before = readdirSync(uploads).length;
    const res = await submit({ ...base, email: 'a@example.org, b@example.org' }, [fasta]);
    expect(res.status).toBe(400);
    expect(sent).toHaveLength(0);
    expect(readdirSync(uploads).length).toBe(before);
  });

  it('sends the team every detail and the submitter a fixed acknowledgement', async () => {
    // Planted text in every field the submitter writes: none of it may reach the
    // address in the form, which is any address the sender likes.
    const planted = {
      ...base,
      name: 'BUY NOW name',
      institute: 'BUY NOW institute',
      description: 'BUY NOW cheap pills https://spam.example',
    };
    const spamFile = { ...fasta, name: 'BUY_NOW_cheap.fasta' };
    const res = await submit(planted, [spamFile]);
    expect(res.status).toBe(200);
    const { submissionId } = await res.json();
    expect(existsSync(join(uploads, submissionId, 'BUY_NOW_cheap.fasta'))).toBe(true);

    expect(sent).toHaveLength(2);
    const team = sent.find((m) => Array.isArray(m.to))!;
    const ack = sent.find((m) => m.to === 'a@example.org')!;

    expect(team.to).toEqual(['team@example.org']);
    expect(team.replyTo).toBe('a@example.org');
    for (const text of ['BUY NOW name', 'BUY NOW institute', 'BUY NOW cheap pills', 'BUY_NOW_cheap.fasta', 'a@example.org']) {
      expect(String(team.text) + String(team.subject)).toContain(text);
    }

    expect(ack.cc).toBeUndefined();
    expect(String(ack.text)).toContain(submissionId);
    expect(String(ack.text)).toContain('Files received: 1 assembly');
    expect(String(ack.text) + String(ack.subject)).not.toMatch(/BUY|spam|pills/i);
  });

  it('still accepts a file-less submission, but tells only the team', async () => {
    const res = await submit(base);
    expect(res.status).toBe(200);
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toEqual(['team@example.org']);
    expect(sent[0].replyTo).toBe('a@example.org');
    expect(String(sent[0].text)).toContain('no files attached');
  });

  it('keeps a newline in the name out of the Subject header', async () => {
    await submit({ ...base, name: 'Eve\r\nBcc: victim@example.org' }, [fasta]);
    const team = sent.find((m) => Array.isArray(m.to))!;
    expect(String(team.subject)).not.toMatch(/[\r\n]/);
  });

  it('stores the samples of our own template, comments and all', async () => {
    const { content } = getTemplateDownloadContent('tsv');
    const res = await submit(base, [{ field: 'metadata', name: 'metadata.tsv', content, type: 'text/tab-separated-values' }]);
    expect(res.status).toBe(200);
    expect((await res.json()).sampleCount ?? createSample.mock.calls.length).toBeGreaterThan(0);
    expect(createSample).toHaveBeenCalled();
  });

  const metadata = (content: string) => ({ field: 'metadata', name: 'metadata.csv', content, type: 'text/csv' });
  const storedSamples = () => (createSample.mock.calls.at(-1)?.[0] as { data: Record<string, unknown>[] }).data;

  it('stores zero as zero, a hemisphere letter as the sign, and unknown columns as additional metadata', async () => {
    const res = await submit(base, [fasta, metadata('sample_alias,latitude,longitude,depth_min_meters,temperature,soil_type\nsample_A,12.5 S,0,0,0,loam\n')]);
    expect(res.status).toBe(200);
    const [row] = storedSamples();
    expect(row).toMatchObject({
      latitude: '-12.5', longitude: '0', depth_min_meters: '0', temperature: '0',
      additional_metadata: { soil_type: 'loam' },
      // One sample and one assembly: paired.
      assembly_filenames: ['sample_A.fasta'],
    });
  });

  it('refuses metadata that does not validate: nothing stored, nothing mailed, the files removed', async () => {
    const before = readdirSync(uploads).length;
    const res = await submit(base, [fasta, metadata('sample_alias,ph,temperature\nS1,"6,5",warm\nS2,7,1,extra\n')]);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/needs fixing/);
    expect(body.problems.join(' ')).toMatch(/decimal separator/);
    expect(body.problems.join(' ')).toMatch(/Row 3/);
    expect(createContribution).not.toHaveBeenCalled();
    expect(sent).toHaveLength(0);
    expect(readdirSync(uploads).length).toBe(before);
  });

  it('refuses a name longer than its column before the upload is stored', async () => {
    const before = readdirSync(uploads).length;
    const res = await submit({ ...base, name: 'x'.repeat(256) }, [fasta]);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/Contact name is too long/);
    expect(readdirSync(uploads).length).toBe(before);
    expect(createContribution).not.toHaveBeenCalled();
  });
});
