import { describe, expect, it } from 'vitest';

import {
  DOMAIN_COLORS,
  PHYLUM_COLORS,
  normalizeTaxonKey,
  stableTaxonColor,
  taxonomyColorFor,
} from './taxonomy-palette';

describe('normalizeTaxonKey', () => {
  it('strips the GTDB rank prefix and lowercases', () => {
    expect(normalizeTaxonKey('p__Bacillota')).toBe('bacillota');
    expect(normalizeTaxonKey('Bacillota')).toBe('bacillota');
  });

  it('keeps the most specific segment of a compound lineage', () => {
    expect(normalizeTaxonKey('d__Bacteria; p__Actinomycetota')).toBe('actinomycetota');
  });

  it('maps pre-2021 phylum names onto their GTDB replacements', () => {
    expect(normalizeTaxonKey('p__Proteobacteria')).toBe('pseudomonadota');
    expect(normalizeTaxonKey('Firmicutes')).toBe('bacillota');
    expect(normalizeTaxonKey('Actinobacteriota')).toBe('actinomycetota');
  });

  it('treats empty input as unknown', () => {
    expect(normalizeTaxonKey(null)).toBe('unknown');
    expect(normalizeTaxonKey('   ')).toBe('unknown');
  });
});

describe('stableTaxonColor', () => {
  it('uses the fixed colour for domains and pinned phyla', () => {
    expect(stableTaxonColor('d__Bacteria')).toBe(DOMAIN_COLORS.bacteria);
    expect(stableTaxonColor('p__Bacillota')).toBe(PHYLUM_COLORS.bacillota);
  });

  it('gives a synonym the same colour as its GTDB name', () => {
    expect(stableTaxonColor('p__Proteobacteria')).toBe(stableTaxonColor('p__Pseudomonadota'));
  });

  it('is independent of the order taxa are first seen', () => {
    const forward = ['p__Nitrospirota', 'p__SAR324', 'p__Fidelibacterota'].map(stableTaxonColor);
    const reverse = ['p__Fidelibacterota', 'p__SAR324', 'p__Nitrospirota'].map(stableTaxonColor);
    expect(forward).toEqual([...reverse].reverse());
  });

  it('never returns grey for a named taxon — grey means unknown', () => {
    for (const taxon of ['p__Myxococcota_A', 'p__Thermoplasmatota', 'g__Streptomyces']) {
      expect(stableTaxonColor(taxon)).not.toBe(DOMAIN_COLORS.unknown);
    }
    expect(stableTaxonColor(null)).toBe(DOMAIN_COLORS.unknown);
  });

  it('keeps GTDB suffixed phyla distinct from their base phylum', () => {
    expect(stableTaxonColor('p__Bacillota_I')).not.toBe(stableTaxonColor('p__Bacillota'));
  });
});

describe('taxonomyColorFor', () => {
  it('colours by phylum whatever rank is displayed', () => {
    const phylum = PHYLUM_COLORS.actinomycetota;
    expect(taxonomyColorFor('auto', 'p__Actinomycetota', 'd__Bacteria')).toBe(phylum);
    expect(taxonomyColorFor('species', 'p__Actinomycetota', 'd__Bacteria')).toBe(phylum);
    expect(taxonomyColorFor('phylum', 'p__Actinomycetota', 'd__Bacteria')).toBe(phylum);
  });

  it('colours by domain at domain rank, so two "Bacteria" rows match', () => {
    expect(taxonomyColorFor('domain', 'p__Actinomycetota', 'd__Bacteria')).toBe(DOMAIN_COLORS.bacteria);
    expect(taxonomyColorFor('domain', 'p__Pseudomonadota', 'd__Bacteria')).toBe(DOMAIN_COLORS.bacteria);
  });

  it('falls back to the domain when the row has no phylum', () => {
    expect(taxonomyColorFor('auto', null, 'd__Archaea')).toBe(DOMAIN_COLORS.archaea);
  });

  it('returns null when the row has no taxonomy at all, so the badge stays plain', () => {
    expect(taxonomyColorFor('auto', null, null)).toBeNull();
    expect(taxonomyColorFor('domain', 'p__Bacillota', null)).toBeNull();
  });
});
