import { describe, expect, it } from 'vitest';
import { formatElapsed } from './elapsed';

describe('formatElapsed', () => {
  it('shows seconds only under a minute', () => {
    expect(formatElapsed(0)).toBe('0s');
    expect(formatElapsed(9_000)).toBe('9s');
    expect(formatElapsed(59_999)).toBe('59s');
  });

  it('shows minutes and seconds past a minute', () => {
    expect(formatElapsed(60_000)).toBe('1m 00s');
    expect(formatElapsed(84_000)).toBe('1m 24s');
    expect(formatElapsed(139_000)).toBe('2m 19s');
  });

  it('zero-pads the seconds so the value does not jitter in width', () => {
    expect(formatElapsed(65_000)).toBe('1m 05s');
  });

  it('keeps counting past an hour rather than wrapping', () => {
    expect(formatElapsed(3_600_000)).toBe('60m 00s');
  });

  it('clamps negative input (clock skew between server and browser)', () => {
    expect(formatElapsed(-5_000)).toBe('0s');
  });
});
