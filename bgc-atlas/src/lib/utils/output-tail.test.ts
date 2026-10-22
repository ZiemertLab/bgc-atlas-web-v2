import { describe, expect, it } from 'vitest';

import { appendTail } from './output-tail';
import { sanitizeErrorMessage } from '@/lib/bigslice/validation';
import { publicJobError } from '@/lib/api/errors';

describe('appendTail', () => {
  it('keeps everything under the cap', () => {
    expect(appendTail('ab', 'cd', 10)).toBe('abcd');
  });

  it('keeps the last characters over it', () => {
    expect(appendTail('abcdef', 'ghij', 4)).toBe('ghij');
    expect(appendTail('abcdef', 'gh', 4)).toBe('efgh');
  });
});

describe('sanitizeErrorMessage', () => {
  // A BiG-SLiCE failure as the worker throws it: the step, pages of progress, then the cause.
  const failure =
    'BiG-SLiCE seed query failed (exit code: 1): ' +
    'processing hmmscan batch...\n'.repeat(2000) +
    'Traceback (most recent call last):\nValueError: Found array with 0 sample(s) (shape=(0, 1)) while a minimum of 1 is required.';

  it('keeps the step that failed and the cause, within the limit', () => {
    const stored = sanitizeErrorMessage(failure);
    expect(stored.startsWith('BiG-SLiCE seed query failed (exit code: 1)')).toBe(true);
    expect(stored.endsWith('while a minimum of 1 is required.')).toBe(true);
    expect(stored).toMatch(/\.\.\. \([\d,]+ characters omitted\) \.\.\./);
    expect(stored.length).toBeLessThanOrEqual(5000 + 60);
  });

  it('so a long failure is still recognised for the reader', () => {
    expect(publicJobError('search', sanitizeErrorMessage(failure))).toMatch(/found no gene cluster region/);
  });

  it('leaves a short message alone', () => {
    expect(sanitizeErrorMessage('DIAMOND is not available')).toBe('DIAMOND is not available');
  });
});
