import { describe, it, expect } from 'vitest';
import { ApiError } from '@/lib/api-client';
import { queryDefaults } from '@/lib/providers/query-defaults';

describe('react-query defaults', () => {
  const retry = queryDefaults.queries?.retry as (n: number, e: unknown) => boolean;

  it('does not retry a refusal, which would answer the same way every time', () => {
    expect(retry(0, new ApiError(400, 'Cannot run this query: unknown field "bioome".'))).toBe(false);
    expect(retry(0, new ApiError(404, 'Not found'))).toBe(false);
    expect(retry(0, new ApiError(422, 'Unprocessable'))).toBe(false);
  });

  it('still retries a server failure and a network error, which may be transient', () => {
    expect(retry(0, new ApiError(503, 'index unavailable'))).toBe(true);
    expect(retry(1, new ApiError(500, 'boom'))).toBe(true);
    expect(retry(0, new TypeError('Failed to fetch'))).toBe(true);
  });

  it('does not retry a 503 the server wrote for the reader', () => {
    // /api/bgcs answers an over-full or over-long SQL fallback this way. Retrying at
    // once re-runs a 45 s query that was just cut off, or queues again for a full
    // slot: measured, the reader waited 34 s, three 10 s waits plus backoff, for a
    // message that says "try again in a minute".
    const busy = JSON.stringify({ success: false, error: 'The search index is temporarily unavailable…', userFacing: true });
    expect(retry(0, new ApiError(503, 'The search index is temporarily unavailable…', busy))).toBe(false);
    // An ordinary 503 is still a transient failure.
    expect(retry(0, new ApiError(503, 'index unavailable', JSON.stringify({ error: 'x' })))).toBe(true);
  });

  it('still gives up after two attempts', () => {
    expect(retry(2, new ApiError(500, 'boom'))).toBe(false);
  });

  it('is set as a default so no hook has to remember it', () => {
    expect(typeof queryDefaults.queries?.retry).toBe('function');
  });
});
