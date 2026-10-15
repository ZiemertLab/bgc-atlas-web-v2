import { describe, expect, it } from 'vitest';

import { atlasGcfName, isMember, CLUSTERING_THRESHOLD } from './families';
import { CURRENT_CLUSTERING } from '@/lib/clustering';

const TAG = CURRENT_CLUSTERING.tag;

describe('atlasGcfName', () => {
  it('pads seed ids to six digits, after the clustering tag', () => {
    expect(atlasGcfName('seed', 42)).toBe(`GCF-${TAG}-000042`);
    expect(atlasGcfName('seed', 238680)).toBe(`GCF-${TAG}-238680`);
  });

  it('offsets fragmented ids by 400000', () => {
    expect(atlasGcfName('fragmented', 42)).toBe(`GCF-${TAG}-F-400042`);
    expect(atlasGcfName('fragmented', 311101)).toBe(`GCF-${TAG}-F-711101`);
  });

  // The two models' id spaces overlap completely.
  it('gives the same id a different name in each tier', () => {
    expect(atlasGcfName('seed', 1)).not.toBe(atlasGcfName('fragmented', 1));
  });

  // The 2026-10-09 clustering: seed gcf.id 1-371,084 and fragmented 1-392,568 in the two data.db files.
  it('covers the real id ranges of both models', () => {
    expect(atlasGcfName('seed', 1)).toBe(`GCF-${TAG}-000001`);
    expect(atlasGcfName('seed', 371084)).toBe(`GCF-${TAG}-371084`);
    expect(atlasGcfName('fragmented', 1)).toBe(`GCF-${TAG}-F-400001`);
    expect(atlasGcfName('fragmented', 392568)).toBe(`GCF-${TAG}-F-792568`);
  });
});

describe('isMember', () => {
  it('treats the threshold itself as a member', () => {
    expect(isMember(CLUSTERING_THRESHOLD)).toBe(true);
  });

  it('separates placed from merely-nearest hits', () => {
    expect(isMember(0.3396)).toBe(true);
    expect(isMember(0.4427)).toBe(false);
  });

  // A self-distance comes back as 2^-26 rather than 0 because sklearn's
  // euclidean_distances squares, subtracts and roots; it is still a member.
  it('accepts the float floor at a self-distance', () => {
    expect(isMember(1.4901161193847656e-8)).toBe(true);
  });
});
