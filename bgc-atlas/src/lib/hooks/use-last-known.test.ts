import { describe, it, expect } from 'vitest';

import { lastKnown } from './use-last-known';

describe('lastKnown', () => {
  it('passes the value through while it is current', () => {
    expect(lastKnown({ key: 'a', value: 500 }, 900, true, 'a')).toBe(900);
  });

  it('returns the remembered value for the same key once it is not', () => {
    expect(lastKnown({ key: 'a', value: 500 }, 0, false, 'a')).toBe(500);
  });

  it('never returns a value remembered for another query', () => {
    expect(lastKnown({ key: 'a', value: 500 }, 0, false, 'b')).toBe(0);
  });

  it('returns the value when nothing was remembered', () => {
    expect(lastKnown(null, 0, false, 'a')).toBe(0);
  });
});
