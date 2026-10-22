import { describe, expect, it } from 'vitest';

import type { TaxonomyLineage } from '@/lib/types';
import { lineageSunburstRows, rankBarsFromLineages } from './taxonomy-utils';

const L = (d: string, p: string | null, g: string | null, n: number): TaxonomyLineage =>
  [d, p, null, null, null, g, null, n];

describe('rankBarsFromLineages', () => {
  const lineages: TaxonomyLineage[] = [
    L('d__Bacteria', 'p__Pseudomonadota', 'g__A', 50),
    L('d__Bacteria', 'p__Pseudomonadota', 'g__B', 30),
    L('d__Bacteria', 'p__Bacteroidota', 'g__C', 60),
    L('d__Bacteria', 'p__Actinomycetota', null, 40),
    L('d__Archaea', 'p__Thermoproteota', null, 5),
    L('d__Bacteria', null, null, 15),
  ];

  it('counts a taxon over every lineage, not over a top slice', () => {
    const bars = rankBarsFromLineages(lineages, 'phylum', 200, 15);
    expect(bars.map((b) => [b.label, b.count])).toEqual([
      ['Pseudomonadota', 80], ['Bacteroidota', 60], ['Actinomycetota', 40], ['Thermoproteota', 5],
    ]);
    expect(bars[0].percentage).toBeCloseTo(40);
  });

  it('puts every taxon past the top N into one Other bar, so the bars add up', () => {
    const bars = rankBarsFromLineages(lineages, 'phylum', 200, 2);
    expect(bars.map((b) => [b.label, b.count, !!b.other])).toEqual([
      ['Pseudomonadota', 80, false], ['Bacteroidota', 60, false], ['Other (2 phyla)', 45, true],
    ]);
    // Every member with a phylum assigned (200 minus the 15 without one).
    expect(bars.reduce((sum, b) => sum + b.count, 0)).toBe(185);
  });

  it('draws no Other bar when the top N is everything', () => {
    expect(rankBarsFromLineages(lineages, 'domain', 200, 15).some((b) => b.other)).toBe(false);
  });
});

describe('lineageSunburstRows', () => {
  it('cuts each lineage at its first missing rank and keeps every lineage', () => {
    expect(lineageSunburstRows([
      L('d__Bacteria', 'p__X', 'g__Y', 7),
      L('d__Bacteria', null, 'g__Z', 3),
    ])).toEqual([
      { segments: ['Bacteria', 'X'], value: 7 },
      { segments: ['Bacteria'], value: 3 },
    ]);
  });
});
