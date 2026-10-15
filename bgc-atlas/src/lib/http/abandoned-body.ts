/**
 * Response bodies that nobody will read. Server only.
 *
 * Next (15.5) pipes a route's body to the client only if the client is still
 * there when the route returns: `pipeToNodeResponse` returns early when the
 * response is already destroyed, and `sendResponse` skips the body for a HEAD.
 * In both cases the stream is neither read nor cancelled, so whatever it holds
 * stays held -- an export slot and an index cursor in lib/export/stream, an open
 * file in the zip download routes.
 *
 * HEAD is answered without building a body at all (each route checks
 * `isHead`). A disconnect is caught here: `request.signal` aborts when the
 * connection closes before the response finished.
 */

export const isHead = (request: Request): boolean => request.method === 'HEAD';

/**
 * Cancel `body` if the client goes away before anyone starts reading it. Call it
 * just before returning the Response that carries `body`. Once
 * Next is piping it, the stream is locked and the pipe cancels it itself on a
 * disconnect, so a locked body is left alone.
 */
export function cancelBodyOnAbort(request: Request, body: ReadableStream): void {
  const cancel = () => {
    if (body.locked) return;
    body.cancel(new Error('client disconnected before the response started')).catch(() => {
      /* already closed or errored: nothing left to release */
    });
  };
  if (request.signal.aborted) {
    // After the caller has wrapped the body in its Response: `new Response()`
    // throws on a stream that is already cancelled ("disturbed").
    queueMicrotask(cancel);
    return;
  }
  request.signal.addEventListener('abort', cancel, { once: true });
}
