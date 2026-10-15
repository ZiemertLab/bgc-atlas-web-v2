import { describe, it, expect } from 'vitest';
import { CURRENT_CLUSTERING } from './clustering';
import {
  GCF_NAME_TOOLTIP,
  FRAGMENTED_TOOLTIP,
  TIER_EXPLAINER,
  GCF_NAME_EXAMPLES,
} from './gcf-naming';

// Names carry the current clustering's release tag (lib/clustering.ts): GCF-<tag>-000042, GCF-<tag>-F-400042.
const NAME = new RegExp(`^GCF-${CURRENT_CLUSTERING.tag}-(F-)?(\\d{6})$`);

describe('GCF naming copy', () => {
  it('name and tier agree in every example', () => {
    for (const { name, tier } of GCF_NAME_EXAMPLES) {
      const m = name.match(NAME);
      expect(m, name).not.toBeNull();
      const [, f, id] = m!;
      expect(tier).toBe(f ? 'Fragmented' : 'Seed');
      // The +400000 offset keeps the two tiers' ids (and aliases) from colliding.
      expect(Number(id) >= 400_000).toBe(Boolean(f));
    }
  });

  it('covers both tiers', () => {
    const tiers = new Set(GCF_NAME_EXAMPLES.map((e) => e.tier));
    expect(tiers).toEqual(new Set(['Seed', 'Fragmented']));
  });

  it('every example matches the documented grammar', () => {
    for (const { name } of GCF_NAME_EXAMPLES) {
      expect(name).toMatch(NAME);
    }
  });

  it('no example carries a v2 resolution segment', () => {
    // v3 is single-resolution.
    for (const { name } of GCF_NAME_EXAMPLES) {
      expect(name).not.toMatch(/-0[47]-/);
      expect(name).not.toContain('CC-');
    }
  });

  it('every alias is two words, matching the bijection it comes from', () => {
    for (const { alias } of GCF_NAME_EXAMPLES) {
      expect(alias.split('-')).toHaveLength(2);
    }
  });

  it('aliases are unique across the examples', () => {
    const aliases = GCF_NAME_EXAMPLES.map((e) => e.alias);
    expect(new Set(aliases).size).toBe(aliases.length);
  });

  it('name tooltip decodes the F segment', () => {
    // The id boundary was dropped from the tooltip on purpose; only the prefix must decode.
    expect(GCF_NAME_TOOLTIP).toContain(`GCF-${CURRENT_CLUSTERING.tag}-F-`);
    expect(GCF_NAME_TOOLTIP).toContain('fragmented');
  });

  it('name tooltip no longer mentions a resolution', () => {
    expect(GCF_NAME_TOOLTIP).not.toContain('0.4');
    expect(GCF_NAME_TOOLTIP).not.toContain('0.7');
    expect(GCF_NAME_TOOLTIP).not.toContain('resolution');
  });

  it('fragmented tooltip explains what the tier is, not just the letter', () => {
    expect(FRAGMENTED_TOOLTIP).toMatch(/truncat/);
    expect(FRAGMENTED_TOOLTIP).toContain('seed');
    // It must not overclaim: a quarter of these families DO have a complete member.
    expect(FRAGMENTED_TOOLTIP).toContain('core-complete');
  });

  it('tier explainer defines both tiers, not just the letter', () => {
    expect(TIER_EXPLAINER).toMatch(/\bSeed\b/);
    expect(TIER_EXPLAINER).toMatch(/\bFragmented\b/i);
    expect(TIER_EXPLAINER).toMatch(/contig edge/);
  });

  it('tier explainer covers every tier the legend can render', () => {
    // A tier without a sentence here would render an undefined word in the Tier column.
    for (const { tier } of GCF_NAME_EXAMPLES) {
      expect(TIER_EXPLAINER.toLowerCase(), tier).toContain(tier.toLowerCase());
    }
  });
});
