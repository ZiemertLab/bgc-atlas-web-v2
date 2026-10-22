import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createConcurrencyGate, GateBusyError } from './concurrency-gate';

const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => { resolve = r; });
  return { promise, resolve };
};

describe('createConcurrencyGate', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('lets `limit` callers in at once and holds the next', async () => {
    const gate = createConcurrencyGate(2, 10_000);
    const a = deferred(); const b = deferred();
    const third = vi.fn(async () => 'third');
    const runs = [gate.run(() => a.promise), gate.run(() => b.promise), gate.run(third)];
    await Promise.resolve();
    expect(gate.active).toBe(2);
    expect(gate.waiting).toBe(1);
    expect(third).not.toHaveBeenCalled();
    a.resolve();
    await expect(runs[2]).resolves.toBe('third');
    b.resolve();
    await Promise.all(runs);
    expect(gate.active).toBe(0);
  });

  it('refuses a caller that waited the full time, and forgets it', async () => {
    const gate = createConcurrencyGate(1, 10_000);
    const a = deferred();
    const first = gate.run(() => a.promise);
    const second = gate.run(async () => 'never');
    vi.advanceTimersByTime(10_000);
    await expect(second).rejects.toBeInstanceOf(GateBusyError);
    expect(gate.waiting).toBe(0);
    a.resolve();
    await first;
    // The refused caller held no slot, so the gate is free again.
    expect(gate.active).toBe(0);
    await expect(gate.run(async () => 'next')).resolves.toBe('next');
  });

  it('releases the slot when the work throws', async () => {
    const gate = createConcurrencyGate(1, 10_000);
    await expect(gate.run(async () => { throw new Error('boom'); })).rejects.toThrow('boom');
    expect(gate.active).toBe(0);
  });

  it('hands a freed slot to the waiter, not to a newcomer', async () => {
    const gate = createConcurrencyGate(1, 10_000);
    const order: string[] = [];
    const a = deferred();
    const first = gate.run(async () => { await a.promise; order.push('first'); });
    const waiter = gate.run(async () => { order.push('waiter'); });
    a.resolve();
    await first;
    const newcomer = gate.run(async () => { order.push('newcomer'); });
    await Promise.all([waiter, newcomer]);
    expect(order).toEqual(['first', 'waiter', 'newcomer']);
  });

  it('refuses at once when the line is full, and takes callers again once it drains', async () => {
    const gate = createConcurrencyGate(1, 60_000, 1);
    let release!: () => void;
    const holding = gate.run(() => new Promise<void>((r) => { release = r; }));
    const waiter = gate.run(async () => 'waited');
    expect(gate.full).toBe(true);
    await expect(gate.run(async () => 'late')).rejects.toBeInstanceOf(GateBusyError);
    release();
    await holding;
    await expect(waiter).resolves.toBe('waited');
    expect(gate.full).toBe(false);
    await expect(gate.run(async () => 'again')).resolves.toBe('again');
  });
});
