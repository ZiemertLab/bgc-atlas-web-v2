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

  it('still gives up after two attempts', () => {
    expect(retry(2, new ApiError(500, 'boom'))).toBe(false);
  });

  it('is set as a default so no hook has to remember it', () => {
    expect(typeof queryDefaults.queries?.retry).toBe('function');
  });
});
