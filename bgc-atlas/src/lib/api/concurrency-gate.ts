/**
 * At most `limit` callers inside `run` at once; the rest wait up to `maxWaitMs`
 * for a slot and are then refused with GateBusyError. With `maxWaiting`, a caller
 * arriving when that many already wait is refused at once instead of joining a
 * line that could not drain in time anyway.
 *
 * In-process, which is the whole app: pm2 runs bgc-atlas-v2 as one fork-mode
 * process. A slot is handed straight to the next waiter on release, so a caller
 * arriving in between cannot take it out of turn.
 */
export class GateBusyError extends Error {
  constructor() {
    super('concurrency gate: no slot within the wait');
    this.name = 'GateBusyError';
  }
}

export interface ConcurrencyGate {
  run<T>(fn: () => Promise<T>): Promise<T>;
  /** For tests and logs: callers inside, and callers waiting. */
  readonly active: number;
  readonly waiting: number;
  /** A caller arriving now would be refused without waiting. */
  readonly full: boolean;
}

export function createConcurrencyGate(
  limit: number,
  maxWaitMs: number,
  maxWaiting: number = Infinity,
): ConcurrencyGate {
  let active = 0;
  const queue: Array<() => void> = [];
  const isFull = () => active >= limit && queue.length >= maxWaiting;

  const acquire = (): Promise<void> => {
    if (active < limit) {
      active += 1;
      return Promise.resolve();
    }
    if (isFull()) return Promise.reject(new GateBusyError());
    return new Promise<void>((resolve, reject) => {
      const take = () => {
        clearTimeout(timer);
        resolve();
      };
      const timer = setTimeout(() => {
        const at = queue.indexOf(take);
        if (at >= 0) queue.splice(at, 1);
        reject(new GateBusyError());
      }, maxWaitMs);
      queue.push(take);
    });
  };

  const release = () => {
    const next = queue.shift();
    if (next) next();
    else active -= 1;
  };

  return {
    async run<T>(fn: () => Promise<T>): Promise<T> {
      await acquire();
      try {
        return await fn();
      } finally {
        release();
      }
    },
    get active() { return active; },
    get waiting() { return queue.length; },
    get full() { return isFull(); },
  };
}
