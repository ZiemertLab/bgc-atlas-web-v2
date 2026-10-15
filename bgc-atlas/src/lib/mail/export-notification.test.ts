import { describe, it, expect, beforeEach, vi } from 'vitest';

const { sendMail } = vi.hoisted(() => ({
  sendMail: vi.fn(async () => ({})),
}));

vi.mock('nodemailer', () => ({ default: { createTransport: () => ({ sendMail }) } }));

import { sendExportFailedEmail, sendExportReadyEmail } from './export-notification';

const READER = 'reader@example.org';

beforeEach(() => {
  sendMail.mockClear();
  vi.stubEnv('SMTP_HOST', '127.0.0.1');
  vi.stubEnv('SMTP_PORT', '2525');
  vi.stubEnv('FROM_EMAIL', 'atlas@example.org');
  vi.stubEnv('NEXT_PUBLIC_API_URL', 'https://atlas.example.org');
});

const sent = () => sendMail.mock.calls.map((c) => (c as unknown[])[0] as Record<string, string>);

describe('reader export emails', () => {
  it('ready: to the reader only, plain text, the job page and nothing internal', async () => {
    await sendExportReadyEmail({ to: READER, exportJobId: 'job-1', what: 'GCF-000042' }, 1234, 0);
    const [mail] = sent();
    expect(sent()).toHaveLength(1);
    expect(mail.to).toBe(READER);
    expect(mail.html).toBeUndefined();
    expect(mail.text).toContain('Your export of GCF-000042 is ready: 1,234 regions.');
    expect(mail.text).toContain('https://atlas.example.org/exports/job-1');
    expect(mail.text).not.toMatch(/admin|severity|metadata|could not be included/i);
  });

  it('ready: counts what was packaged and says how many were left out', async () => {
    await sendExportReadyEmail({ to: READER, exportJobId: 'job-1', what: 'GCF-000042' }, 1234, 12);
    expect(sent()[0].text).toContain('ready: 1,222 regions.\n12 more could not be included.');
  });

  it('failed: no error detail, just the job page', async () => {
    await sendExportFailedEmail({ to: READER, exportJobId: 'job-2', what: 'your search results' });
    const [mail] = sent();
    expect(mail.to).toBe(READER);
    expect(mail.text).toBe(
      'Your export of your search results could not be completed.\n\n'
        + 'https://atlas.example.org/exports/job-2\n\n-- \nBGC Atlas',
    );
  });
});
