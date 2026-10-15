import { describe, it, expect } from 'vitest';
import { errorMessageFromBody } from './api-client';

// Routes answer errors with `{ success: false, error, message }`; the refusal text must reach the user.
describe('errorMessageFromBody', () => {
  it('lifts the repair text out of a refusal body', () => {
    const body = JSON.stringify({
      success: false,
      error: 'Cannot run this query: unknown field "bioome". Fix or remove that condition — running the query without it would answer a broader question.',
      message: 'Cannot run this query: unknown field "bioome". Fix or remove that condition — running the query without it would answer a broader question.',
      rejected: [{ field: 'bioome', operator: 'contains', reason: 'unknown_field' }],
    });
    const msg = errorMessageFromBody(body, 400);
    expect(msg).toContain('bioome');
    expect(msg).not.toContain('{');
    expect(msg).not.toContain('success');
  });

  it('prefers `message` over `error`, which is only a category', () => {
    const body = JSON.stringify({ error: 'Unknown source type', message: 'Unknown sourceType: typo.' });
    expect(errorMessageFromBody(body, 400)).toBe('Unknown sourceType: typo.');
  });

  it('falls back to `error` when there is no message', () => {
    expect(errorMessageFromBody(JSON.stringify({ error: 'Unsupported filter' }), 400))
      .toBe('Unsupported filter');
  });

  it('never renders a 5xx body, which is written for the log and not the reader', () => {
    // 500s can carry raw Prisma messages (SQL, bound values); never render them.
    const leak = JSON.stringify({
      success: false,
      error: 'Invalid `prisma.$queryRaw()` invocation: SELECT * FROM bgcs WHERE assembly = $1 -- 0e6f…',
    });
    const msg = errorMessageFromBody(leak, 500);
    expect(msg).not.toContain('prisma');
    expect(msg).not.toContain('SELECT');
    expect(msg).toBe('Something went wrong on our side. Please try again in a few minutes.');
    expect(errorMessageFromBody(leak, 502)).toBe(msg);
    expect(errorMessageFromBody(leak, 503)).toBe(msg);
  });

  it('shows a 5xx body\'s log reference, and nothing else from it', () => {
    const body = JSON.stringify({ success: false, error: 'SELECT secret', reference: 'a3f9c2' });
    expect(errorMessageFromBody(body, 500))
      .toBe('Something went wrong on our side. Please try again in a few minutes. (ref a3f9c2)');
    // A "reference" that is not one serverError minted is text, and text is not shown.
    const forged = JSON.stringify({ reference: 'see /var/lib/postgres' });
    expect(errorMessageFromBody(forged, 500))
      .toBe('Something went wrong on our side. Please try again in a few minutes.');
  });

  it('caps the length, so a proxy HTML page is not a wall of markup in a <p>', () => {
    const wall = `<html>${'x'.repeat(5000)}</html>`;
    const msg = errorMessageFromBody(wall, 400);
    expect(msg.length).toBeLessThanOrEqual(400);
    expect(msg.endsWith('…')).toBe(true);
    const longSentence = JSON.stringify({ message: 'y'.repeat(5000) });
    expect(errorMessageFromBody(longSentence, 400).length).toBeLessThanOrEqual(400);
  });

  it('does not cap a real refusal, which fits well inside the limit', () => {
    const refusal = 'Cannot run this query: unknown field "bioome". Fix or remove that condition'
      + ' — running the query without it would answer a broader question.';
    expect(errorMessageFromBody(JSON.stringify({ message: refusal }), 400)).toBe(refusal);
  });

  it('ignores an empty or non-string message rather than rendering it', () => {
    expect(errorMessageFromBody(JSON.stringify({ message: '   ', error: 'Real one' }), 400))
      .toBe('Real one');
    expect(errorMessageFromBody(JSON.stringify({ message: 42, error: 'Real one' }), 400))
      .toBe('Real one');
  });

  it('keeps a non-JSON 4xx body — a proxy\'s plain text still beats discarding it', () => {
    expect(errorMessageFromBody('Request blocked by policy', 403))
      .toBe('Request blocked by policy');
  });

  it('names the status when there is no body at all', () => {
    expect(errorMessageFromBody(undefined, 404)).toBe('Request failed with status 404');
    expect(errorMessageFromBody('', 404)).toBe('Request failed with status 404');
    expect(errorMessageFromBody(JSON.stringify({}), 404)).toBe('Request failed with status 404');
  });
});
