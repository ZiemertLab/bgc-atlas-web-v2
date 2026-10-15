import { describe, it, expect } from 'vitest';
import { isGenomeSourceType, sampleBrowseHref, sampleBrowseLabel } from '@/lib/utils/sample-link';

const uuid = 'fd788842-04ff-50e9-8fca-bc46a6ef0c9e';

describe('sampleBrowseHref', () => {
  it('sends a metagenome to the Metagenomes page', () => {
    expect(sampleBrowseHref(uuid, 'metagenome')).toBe(`/samples?id=${uuid}`);
  });

  it.each(['MAG', 'SAG', 'isolate'])('sends a %s to Genome Collections', (sourceType) => {
    expect(sampleBrowseHref(uuid, sourceType)).toBe(`/genome-collections?id=${uuid}`);
  });

  it.each([undefined, null, '', '   ', 'unknown'])(
    'falls back to Metagenomes for %p rather than to Genome Collections',
    (sourceType) => {
      expect(sampleBrowseHref(uuid, sourceType)).toBe(`/samples?id=${uuid}`);
    },
  );

  it('is case-sensitive, matching the assemblies.source_type CHECK constraint', () => {
    expect(sampleBrowseHref(uuid, 'mag')).toBe(`/samples?id=${uuid}`);
  });

  it('encodes an id that is not a bare uuid', () => {
    expect(sampleBrowseHref('a b/c', 'metagenome')).toBe('/samples?id=a%20b%2Fc');
  });

  it('returns a bare app path so callers own the basePath decision', () => {
    expect(sampleBrowseHref(uuid, 'MAG').startsWith('/beta-v2')).toBe(false);
  });
});

describe('sampleBrowseLabel', () => {
  it('names the page the link opens', () => {
    expect(sampleBrowseLabel('MAG')).toBe('genome collections');
    expect(sampleBrowseLabel('metagenome')).toBe('samples');
    expect(sampleBrowseLabel(null)).toBe('samples');
  });
});

describe('isGenomeSourceType', () => {
  it('covers every value assemblies.source_type allows', () => {
    expect(['isolate', 'MAG', 'SAG'].every(isGenomeSourceType)).toBe(true);
    expect(isGenomeSourceType('metagenome')).toBe(false);
  });
});
