import { describe, expect, it } from 'vitest';
import { getEcosystemColor } from './chart-utils';
import { ECOSYSTEM_PALETTE } from './ecosystem-palette';
import { GOLD_AQUATIC_BADGE_CLASS, GOLD_AQUATIC_COLOR_HEX, GOLD_PLANTS_COLOR_HEX, getEcosystemChartColorHex, getGOLDBadgeClass } from './gold-parser';

const HOST = ECOSYSTEM_PALETTE['host-associated'].hex;
const ENV = ECOSYSTEM_PALETTE.environmental.hex;
const UNKNOWN = ECOSYSTEM_PALETTE.unknown.hex;

describe('getEcosystemColor', () => {
  it('colours top-level names and the plants bucket', () => {
    expect(getEcosystemColor('Host-associated')).toBe(HOST);
    expect(getEcosystemColor('Environmental')).toBe(ENV);
    expect(getEcosystemColor('Host-assoc.: Plants')).toBe(GOLD_PLANTS_COLOR_HEX);
  });

  it('colours plant leaves green, as the GCF index stores them', () => {
    for (const leaf of ['Plants', 'Roots', 'Rhizome', 'Endosphere', 'Phyllosphere']) {
      expect(getEcosystemColor(leaf)).toBe(GOLD_PLANTS_COLOR_HEX);
    }
  });

  it('colours other leaves by their top level', () => {
    expect(getEcosystemColor('Human')).toBe(HOST);
    expect(getEcosystemColor('Digestive system')).toBe(HOST);
    // Mostly environmental (99.3% of samples), a few under Plants.
    expect(getEcosystemColor('Soil')).toBe(ENV);
  });

  it('colours aquatic leaves blue and leaves terrestrial green', () => {
    for (const leaf of ['Aquatic', 'Marine', 'Freshwater', 'Sediment']) {
      expect(getEcosystemColor(leaf)).toBe(GOLD_AQUATIC_COLOR_HEX);
    }
    expect(getEcosystemColor('Terrestrial')).toBe(ENV);
    expect(getEcosystemColor('Air')).toBe(ENV);
  });

  it('colours aquatic paths blue in charts and badges', () => {
    expect(getEcosystemColor('Environmental:Aquatic:Marine')).toBe(GOLD_AQUATIC_COLOR_HEX);
    expect(getEcosystemChartColorHex('Environmental:Aquatic')).toBe(GOLD_AQUATIC_COLOR_HEX);
    expect(getEcosystemChartColorHex('Environmental:Terrestrial:Soil')).toBe(ENV);
    expect(getGOLDBadgeClass('Environmental:Aquatic:Freshwater')).toBe(GOLD_AQUATIC_BADGE_CLASS);
    // Level 1 alone stays green: there is no aquatic key at that level.
    expect(getEcosystemChartColorHex('Environmental')).toBe(ENV);
  });

  it('colours full paths by branch', () => {
    expect(getEcosystemColor('Host-associated:Plants:Roots')).toBe(GOLD_PLANTS_COLOR_HEX);
    expect(getEcosystemColor('Host-associated:Human:Skin')).toBe(HOST);
  });

  it('does not guess a leaf split between branches', () => {
    expect(getEcosystemColor('Wood')).toBe(UNKNOWN);
    // GOLD has both Aquatic:Wetlands and Terrestrial:Wetlands.
    expect(getEcosystemColor('Wetlands')).toBe(UNKNOWN);
    expect(getEcosystemColor('No such leaf')).toBe(UNKNOWN);
    expect(getEcosystemColor('')).toBe(UNKNOWN);
  });
});
