import { describe, it, expect, vi, afterEach } from 'vitest';
import { antismashFailureMessage, publicJobError, serverError, UserFacingError } from './errors';

afterEach(() => vi.restoreAllMocks());

describe('serverError', () => {
  it('hides the error, logs it under the reference it returns', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const res = serverError(new Error('relation "bgcs" does not exist at /srv/db'), 'Loading BGCs');
    const body = await res.json();
    expect(res.status).toBe(500);
    expect(body.success).toBe(false);
    expect(body.reference).toMatch(/^[0-9a-f]{6}$/);
    expect(body.error).toBe(
      `Something went wrong on our side. Please try again in a few minutes. (ref ${body.reference})`,
    );
    expect(JSON.stringify(body)).not.toMatch(/relation|\/srv/);
    expect(log).toHaveBeenCalledWith(`[ref ${body.reference}] Loading BGCs:`, expect.any(Error));
  });

  it('keeps a status the callers key on', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(serverError(new Error('x'), 'agg', { status: 502 }).status).toBe(502);
  });

  it('passes a message written for the reader through, with its status and no log', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const res = serverError(new UserFacingError("File 'a.gbk' is empty."), 'upload');
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ success: false, error: "File 'a.gbk' is empty." });
    expect(log).not.toHaveBeenCalled();
  });
});

describe('publicJobError', () => {
  it('replaces a raw stored failure', () => {
    expect(publicJobError('export', 'ENOENT: no such file, open /mnt/ceph/exports/x.zip')).toBe(
      'This export could not be completed. Please start it again; if it keeps failing, let us know.',
    );
    expect(publicJobError('search', null)).toContain('This search could not be completed.');
  });

  it('translates a BiG-SLiCE run that found no region, keeping nothing of the raw text', () => {
    const raw =
      'BiG-SLiCE seed query failed (exit code: 1): Traceback (most recent call last):\n' +
      '  File "/usr/local/bin/bigslice", line 799, in query_mode:\n' +
      'ValueError: Found array with 0 sample(s) (shape=(0, 8371)) while a minimum of 1 is required by the normalize function.: ';
    const shown = publicJobError('search', raw);
    expect(shown).toMatch(/^BiG-SLiCE found no gene cluster region/);
    expect(shown).not.toMatch(/start it again|Traceback|8371/);
  });

  it('shows a message that was written for the reader', () => {
    expect(publicJobError('export', 'Job canceled by administrator')).toBe('Job canceled by administrator');
  });
});

describe('antismashFailureMessage', () => {
  it('never shows the archive path', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const missing = antismashFailureMessage('missing-file', 'Archive not found or unreadable at /mnt/a.tar.gz.', 'x');
    expect(missing).toBe('The antiSMASH results for this region are not available.');
    expect(antismashFailureMessage('error', 'tar exited 2 on /mnt/a.tar.gz', 'x')).toMatch(/^Something went wrong.*\(ref [0-9a-f]{6}\)$/);
  });
});
