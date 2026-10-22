import { useEffect, useState } from 'react';

export interface Remembered<T> {
  key: string;
  value: T;
}

/**
 * `value` while `current` is true; otherwise the value remembered for this same
 * `key`, or `value` itself when nothing was remembered for it. Pure, so the
 * reset rule is testable: a memory from another key never leaks through.
 */
export function lastKnown<T>(memory: Remembered<T> | null, value: T, current: boolean, key: string): T {
  if (current) return value;
  return memory && memory.key === key ? memory.value : value;
}

/**
 * `value` while `current` is true; otherwise the last value seen while it was,
 * for the same `key`.
 *
 * For a list's pager under a deep-page refusal: the failed request carries no
 * total, but the reader needs the pager they were using to step back. `key` is
 * the serialized query, so after a filter change the previous filter's total is
 * never shown as this one's. A page opened straight onto a refusal has nothing
 * to remember and gets `value`.
 */
export function useLastKnown<T>(value: T, current: boolean, key: string): T {
  const [memory, setMemory] = useState<Remembered<T> | null>(null);
  useEffect(() => {
    if (current) setMemory({ key, value });
  }, [value, current, key]);
  return lastKnown(memory, value, current, key);
}
