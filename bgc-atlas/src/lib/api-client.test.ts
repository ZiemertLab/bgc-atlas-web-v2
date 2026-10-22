import { describe, it, expect } from 'vitest';
import { ApiError, errorMessageFromBody, isDeepPageRefusal, isFilterRefusal } from './api-client';

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

  it('shows a 503 the server wrote for the reader, and only that kind', () => {
    const notice = 'The search index is temporarily unavailable and the backup search is busy. Please try again in a minute.';
    expect(errorMessageFromBody(JSON.stringify({ success: false, error: notice, userFacing: true }), 503)).toBe(notice);
    // The marker must be the boolean, and only a 503 honours it.
    const generic = 'Something went wrong on our side. Please try again in a few minutes.';
    expect(errorMessageFromBody(JSON.stringify({ error: 'SELECT secret', userFacing: 'true' }), 503)).toBe(generic);
    expect(errorMessageFromBody(JSON.stringify({ error: 'SELECT secret', userFacing: true }), 500)).toBe(generic);
    expect(errorMessageFromBody(JSON.stringify({ error: '  ', userFacing: true }), 503)).toBe(generic);
    expect(errorMessageFromBody('<html>503 Service Unavailable</html>', 503)).toBe(generic);
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

const body400 = (fields: Record<string, unknown>) =>
  new ApiError(400, 'refused', JSON.stringify({ success: false, error: 'refused', message: 'refused', ...fields }));

describe('isFilterRefusal', () => {
  it('is true for a 400 coded filter_refused', () => {
    expect(isFilterRefusal(body400({ code: 'filter_refused', rejected: ['bogus'] }))).toBe(true);
  });

  it('is false for a deep-page refusal: there may be no filter to remove', () => {
    expect(isFilterRefusal(body400({ code: 'deep_page', rejected: [] }))).toBe(false);
  });

  it('is false for a 400 without a code', () => {
    expect(isFilterRefusal(body400({ rejected: ['clusterMethod'] }))).toBe(false);
    expect(isFilterRefusal(new ApiError(400, 'Bad request'))).toBe(false);
    expect(isFilterRefusal(new ApiError(400, 'Bad request', '<html>proxy</html>'))).toBe(false);
  });

  it('is false for failures a retry may fix, and for non-ApiErrors', () => {
    const coded = JSON.stringify({ code: 'filter_refused' });
    expect(isFilterRefusal(new ApiError(500, 'Server error', coded))).toBe(false);
    expect(isFilterRefusal(new ApiError(503, 'Temporarily unavailable'))).toBe(false);
    expect(isFilterRefusal(new Error('Failed to fetch'))).toBe(false);
    expect(isFilterRefusal(null)).toBe(false);
  });
});

describe('isDeepPageRefusal', () => {
  it('is true only for a 400 coded deep_page', () => {
    expect(isDeepPageRefusal(body400({ code: 'deep_page' }))).toBe(true);
    expect(isDeepPageRefusal(body400({ code: 'filter_refused' }))).toBe(false);
    expect(isDeepPageRefusal(body400({}))).toBe(false);
  });
});
