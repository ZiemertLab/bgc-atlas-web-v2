import { describe, expect, it, vi } from 'vitest';

import { cancelBodyOnAbort, isHead } from './abandoned-body';

const body = () => {
  const cancel = vi.fn();
  return { stream: new ReadableStream({ cancel }), cancel };
};

describe('cancelBodyOnAbort', () => {
  it('cancels an unread body when the client disconnects', async () => {
    const ac = new AbortController();
    const { stream, cancel } = body();
    cancelBodyOnAbort(new Request('http://x', { signal: ac.signal }), stream);
    expect(cancel).not.toHaveBeenCalled();
    ac.abort();
    await Promise.resolve();
    expect(cancel).toHaveBeenCalled();
  });

  it('cancels when the signal had already fired, after the Response is built', async () => {
    const ac = new AbortController();
    ac.abort();
    const { stream, cancel } = body();
    cancelBodyOnAbort(new Request('http://x', { signal: ac.signal }), stream);
    expect(() => new Response(stream)).not.toThrow();
    await Promise.resolve();
    expect(cancel).toHaveBeenCalled();
  });

  it('leaves a body that is already being read to its reader', () => {
    const ac = new AbortController();
    const { stream, cancel } = body();
    cancelBodyOnAbort(new Request('http://x', { signal: ac.signal }), stream);
    stream.getReader(); // Next's pipe holds the lock; it cancels on disconnect itself
    expect(() => ac.abort()).not.toThrow();
    expect(cancel).not.toHaveBeenCalled();
  });
});

describe('isHead', () => {
  it('is true only for HEAD', () => {
    expect(isHead(new Request('http://x', { method: 'HEAD' }))).toBe(true);
    expect(isHead(new Request('http://x'))).toBe(false);
  });
});
