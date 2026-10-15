import { describe, it, expect } from 'vitest';
import { demotePlaceholders } from '@/lib/opensearch/facet-placeholders';

const b = (value: string, count: number) => ({ value, count });

// antiSMASH emits "X" for an unpredicted substrate; it is the largest Monomer value by 3.5x.
describe('demotePlaceholders', () => {
  it('labels the monomer placeholder and moves it last', () => {
    const out = demotePlaceholders('monomers', [
      b('X', 1456340), b('mal', 417584), b('Ser', 232006),
    ]);
    expect(out.map((x) => x.value)).toEqual(['mal', 'Ser', 'X']);
    expect(out[2]).toEqual({ value: 'X', count: 1456340, label: 'unpredicted' });
  });

  it('keeps real values in their original frequency order', () => {
    const out = demotePlaceholders('monomers', [
      b('X', 1456340), b('mal', 417584), b('Ser', 232006), b('Gly', 159769),
    ]);
    expect(out.slice(0, 3).map((x) => x.value)).toEqual(['mal', 'Ser', 'Gly']);
    expect(out.slice(0, 3).every((x) => x.label === undefined)).toBe(true);
  });

  it('leaves the placeholder selectable rather than dropping it', () => {
    const out = demotePlaceholders('monomers', [b('X', 1456340)]);
    expect(out).toHaveLength(1);
    expect(out[0].value).toBe('X');
  });

  it('does not touch other fields that happen to contain an X', () => {
    const input = [b('X', 5), b('AMP-binding', 3)];
    expect(demotePlaceholders('antismash_domains', input)).toBe(input);
  });

  it('is a no-op when the field has no placeholder present', () => {
    const input = [b('mal', 417584), b('Ser', 232006)];
    expect(demotePlaceholders('monomers', input)).toBe(input);
  });

  it('handles an empty list', () => {
    expect(demotePlaceholders('monomers', [])).toEqual([]);
  });
});
