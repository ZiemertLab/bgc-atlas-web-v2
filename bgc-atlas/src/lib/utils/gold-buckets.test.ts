import { describe, expect, it } from 'vitest';
import { GOLD_BUCKET_LABEL, GOLD_BUCKET_ORDER, goldBucketLabel } from './gold-buckets';

describe('goldBucketLabel', () => {
  it('labels every bucket as GOLD_BUCKET_LABEL does', () => {
    for (const bucket of GOLD_BUCKET_ORDER) expect(goldBucketLabel(bucket)).toBe(GOLD_BUCKET_LABEL[bucket]);
    expect(goldBucketLabel('host-animal')).toBe('Host (non-plant)');
  });
  it('shows an unknown value as it arrived', () => {
    expect(goldBucketLabel('marnie')).toBe('marnie');
    expect(goldBucketLabel('')).toBe('');
  });
  it('does not read inherited keys as labels', () => {
    expect(goldBucketLabel('toString')).toBe('toString');
    expect(goldBucketLabel('__proto__')).toBe('__proto__');
  });
});
