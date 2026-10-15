import { describe, expect, it } from 'vitest';
import { parseTargetId } from './target-id';

describe('parseTargetId', () => {
  it('splits a DIAMOND target into its region UUID and CDS label', () => {
    expect(parseTargetId('ef1e0ff2-a653-52b8-a80a-6026c43c8374_ctg1_1177')).toEqual({
      regionId: 'ef1e0ff2-a653-52b8-a80a-6026c43c8374',
      cdsLabel: 'ctg1_1177',
    });
  });

  it('keeps contig labels that themselves contain underscores intact', () => {
    expect(parseTargetId('ef1e0ff2-a653-52b8-a80a-6026c43c8374_ctg_12_alt_9')).toEqual({
      regionId: 'ef1e0ff2-a653-52b8-a80a-6026c43c8374',
      cdsLabel: 'ctg_12_alt_9',
    });
  });

  it('uppercases nothing — region ids stay canonical lowercase for the ::uuid cast', () => {
    expect(parseTargetId('EF1E0FF2-A653-52B8-A80A-6026C43C8374_ctg1_1')?.regionId).toBe(
      'ef1e0ff2-a653-52b8-a80a-6026c43c8374',
    );
  });

  it('returns a null regionId when the prefix is not a UUID', () => {
    expect(parseTargetId('not-a-uuid_ctg1_1177')).toEqual({
      regionId: null,
      cdsLabel: 'not-a-uuid_ctg1_1177',
    });
  });

  it('returns a null regionId for a bare UUID with no CDS suffix', () => {
    expect(parseTargetId('ef1e0ff2-a653-52b8-a80a-6026c43c8374')).toEqual({
      regionId: null,
      cdsLabel: 'ef1e0ff2-a653-52b8-a80a-6026c43c8374',
    });
  });

  it('rejects a prefix that is UUID-shaped but holds non-hex characters', () => {
    expect(parseTargetId('zf1e0ff2-a653-52b8-a80a-6026c43c8374_ctg1_1')?.regionId).toBeNull();
  });

  it('handles empty input without throwing', () => {
    expect(parseTargetId('')).toEqual({ regionId: null, cdsLabel: '' });
  });
});
