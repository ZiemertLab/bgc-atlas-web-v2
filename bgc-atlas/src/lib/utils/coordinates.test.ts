import { describe, it, expect } from 'vitest';
import { hasCoordinates, formatCoordinates } from './coordinates';

describe('hasCoordinates', () => {
  it('true for finite lat/long including 0/0', () => {
    expect(hasCoordinates({ latitude: 45.1, longitude: -30.2 })).toBe(true);
    expect(hasCoordinates({ latitude: 0, longitude: 0 })).toBe(true);
  });
  it('false when either is missing/NaN/out of range', () => {
    expect(hasCoordinates({ latitude: 45.1 })).toBe(false);
    expect(hasCoordinates({ latitude: undefined, longitude: 10 })).toBe(false);
    expect(hasCoordinates({ latitude: NaN, longitude: 10 })).toBe(false);
    expect(hasCoordinates({ latitude: 91, longitude: 10 })).toBe(false);
    expect(hasCoordinates({ latitude: 10, longitude: 181 })).toBe(false);
  });
});

describe('formatCoordinates', () => {
  it('formats to 4 dp', () => {
    expect(formatCoordinates(45.12345, -30.2)).toBe('45.1234, -30.2000');
  });
});
