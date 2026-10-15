import { describe, expect, it } from 'vitest';
import { FEEDBACK_MESSAGE_MAX, validateFeedback } from './feedback';

describe('validateFeedback', () => {
  it('accepts a message alone, trimmed', () => {
    expect(validateFeedback({ message: '  slow map  ' }))
      .toEqual({ ok: true, value: { message: 'slow map', email: null, page: null } });
  });

  it('keeps a site path and an address', () => {
    expect(validateFeedback({ message: 'x', email: 'a@b.org', page: '/gcfs?familyClass=seed' }))
      .toEqual({ ok: true, value: { message: 'x', email: 'a@b.org', page: '/gcfs?familyClass=seed' } });
  });

  it('drops a page that is not a path on this site', () => {
    expect(validateFeedback({ message: 'x', page: 'https://evil.example/' }))
      .toMatchObject({ ok: true, value: { page: null } });
  });

  it('treats a filled honeypot as spam, whatever else is there', () => {
    expect(validateFeedback({ message: 'hello', website: 'http://spam' })).toEqual({ ok: 'spam' });
  });

  it('refuses an empty or oversized message and a malformed address', () => {
    expect(validateFeedback({ message: '   ' }).ok).toBe(false);
    expect(validateFeedback({ message: 'x'.repeat(FEEDBACK_MESSAGE_MAX + 1) }).ok).toBe(false);
    expect(validateFeedback({ message: 'x', email: 'not an address' }).ok).toBe(false);
    // A header-injection attempt is not an address either.
    expect(validateFeedback({ message: 'x', email: 'a@b.org\nBcc: c@d.org' }).ok).toBe(false);
  });

  it('survives a body that is not an object', () => {
    expect(validateFeedback(null).ok).toBe(false);
    expect(validateFeedback('message').ok).toBe(false);
  });
});
