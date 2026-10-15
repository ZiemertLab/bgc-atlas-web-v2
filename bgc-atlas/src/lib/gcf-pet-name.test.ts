import { existsSync } from 'node:fs';
import { describe, it, expect } from 'vitest';

// The wordlists are third-party and not committed (THIRD_PARTY.md); skip until restored.
const hasWordlists = existsSync(new URL('./wordlists/petname/adjectives.txt', import.meta.url));
const { petNameForGcfName, petNameForId, ADJECTIVES, NOUNS } = hasWordlists
  ? await import('./gcf-pet-name')
  : ({} as typeof import('./gcf-pet-name'));

describe.skipIf(!hasWordlists)('gcf-pet-name', () => {
  describe('wordlists', () => {
    it('has the exact vendored sizes the bijection depends on', () => {
      expect(ADJECTIVES).toHaveLength(1198);
      expect(NOUNS).toHaveLength(1052);
    });

    it('contains no blank or whitespace-padded entries', () => {
      for (const w of [...ADJECTIVES, ...NOUNS]) {
        expect(w).toBe(w.trim());
        expect(w.length).toBeGreaterThan(0);
      }
    });
  });

  describe('petNameForId', () => {
    it('is deterministic', () => {
      expect(petNameForId(400042)).toBe(petNameForId(400042));
    });

    it('produces an adjective-noun pair drawn from the lists', () => {
      const [adj, noun] = petNameForId(1337).split('-');
      expect(ADJECTIVES).toContain(adj);
      expect(NOUNS).toContain(noun);
    });

    it('is collision-free across the full 6-digit id space', () => {
      // 1198 x 1052 = 1,260,296 > 999,999, the whole 6-digit id space.
      const seen = new Set<string>();
      for (let id = 1; id <= 999_999; id++) seen.add(petNameForId(id));
      expect(seen.size).toBe(999_999);
    });

    it('pins the published mapping', () => {
      // Do not update these: a change means gcfs.pet_name is stale (a data migration).
      expect(petNameForId(400042)).toBe('lightened-sow');   // worked example
      expect(petNameForId(1)).toBe('praised-cricket');      // lower bound
      expect(petNameForId(999_999)).toBe('musical-garpike'); // upper bound
    });

    it('rejects ids outside the representable space', () => {
      expect(() => petNameForId(0)).toThrow();
      expect(() => petNameForId(1_000_000)).toThrow();
      expect(() => petNameForId(1.5)).toThrow();
    });
  });

  describe('petNameForGcfName', () => {
    it('parses the clustering-v3 name shapes', () => {
      expect(petNameForGcfName('GCF-000042')).toBe(petNameForId(42));
      expect(petNameForGcfName('GCF-F-400042')).toBe(petNameForId(400042));
    });

    it('never aliases a seed and a fragmented family the same', () => {
      expect(petNameForGcfName('GCF-000042')).not.toBe(petNameForGcfName('GCF-F-400042'));
    });

    it('still parses the legacy clustering-v2 prefixes', () => {
      // Kept so the module works against a pre-cutover database.
      expect(petNameForGcfName('GCF-04-000042')).toBe(petNameForId(42));
      expect(petNameForGcfName('GCF-07-241500')).toBe(petNameForId(241500));
      expect(petNameForGcfName('GCF-CC-04-400042')).toBe(petNameForId(400042));
      expect(petNameForGcfName('GCF-CC-07-561300')).toBe(petNameForId(561300));
    });

    it('returns null for anything it cannot parse', () => {
      expect(petNameForGcfName(null)).toBeNull();
      expect(petNameForGcfName('')).toBeNull();
      expect(petNameForGcfName('not-a-gcf-name')).toBeNull();
      // Guard against a future 7-digit rename silently producing wrong aliases.
      expect(petNameForGcfName('GCF-04-1234567')).toBeNull();
      expect(petNameForGcfName('GCF-1234567')).toBeNull();
      // A bare tier letter is not a tier: only F- is meaningful.
      expect(petNameForGcfName('GCF-X-000042')).toBeNull();
    });
  });
});

// Golden values read out of the 2026-10-09 build (scripts/clustering-v3/build_gcfs.py, the Python half):
// the two halves must agree on tagged names too, or the UNIQUE index on gcfs.pet_name turns any divergence
// into a load failure far from its cause.
describe('release-tagged names (2026-10-09)', () => {
  it('matches the Python build', () => {
    expect(petNameForGcfName('GCF-v2b2-000042')).toBe('becoming-trumpetfish');
    expect(petNameForGcfName('GCF-v2b2-000336')).toBe('pertinent-silverside');
    expect(petNameForGcfName('GCF-v2b2-F-400042')).toBe('funny-ghoul');
    expect(petNameForGcfName('GCF-v2b2-F-400004')).toBe('successful-redhead');
  });

  it('leaves the untagged (August v3) aliases unchanged', () => {
    expect(petNameForGcfName('GCF-000042')).toBe(petNameForId(42));
  });

  it('gives no alias for an unknown tag', () => {
    expect(petNameForGcfName('GCF-v7-000042')).toBeNull();
  });
});

// Read out of the R2.0-beta.3 build (data-v2/clustering-r2b3-build/out/gcfs.csv), PET_OFFSET v2b4 = 1,586,754.
describe('release-tagged names (v2b4, 2026-10-12)', () => {
  it('matches the Python build', () => {
    expect(petNameForGcfName('GCF-v2b4-000001')).toBe('conversant-crab');
    expect(petNameForGcfName('GCF-v2b4-000042')).toBe('rejoicing-human');
    expect(petNameForGcfName('GCF-v2b4-000336')).toBe('endowed-fieldmouse');
    expect(petNameForGcfName('GCF-v2b4-F-400042')).toBe('allied-snapper');
    expect(petNameForGcfName('GCF-v2b4-F-400004')).toBe('knowing-crayfish');
  });
});

// PET_OFFSET v2b5 = 2,379,180 (R2.0-beta.5 clustering); checked against the build's gcfs.csv.
describe('release-tagged names (v2b5, 2026-10-13)', () => {
  it('matches the Python build', () => {
    expect(petNameForGcfName('GCF-v2b5-000001')).toBe('grounded-drongo');
    expect(petNameForGcfName('GCF-v2b5-000042')).toBe('vigorous-kittiwake');
    expect(petNameForGcfName('GCF-v2b5-000336')).toBe('liberating-goatfish');
    expect(petNameForGcfName('GCF-v2b5-F-400042')).toBe('effective-suricate');
    expect(petNameForGcfName('GCF-v2b5-F-400004')).toBe('regal-dugong');
  });
});

// PET_OFFSET v2b6 = 3,174,143 (R2.0-beta.6 clustering); checked against the build's gcfs.csv.
describe('release-tagged names (v2b6, 2026-10-14)', () => {
  it('matches the Python build', () => {
    expect(petNameForGcfName('GCF-v2b6-000001')).toBe('gallant-greenshank');
    expect(petNameForGcfName('GCF-v2b6-000042')).toBe('uplifting-mooneye');
    expect(petNameForGcfName('GCF-v2b6-000336')).toBe('jubilant-kalong');
    expect(petNameForGcfName('GCF-v2b6-F-400042')).toBe('diligent-whippoorwill');
    expect(petNameForGcfName('GCF-v2b6-F-400004')).toBe('purified-grizzly');
  });
});
