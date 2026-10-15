// antiSMASH facet values that mean "could not make a call"; left alone they sort to the
// top of the value picker and read as real values.
import type { FacetBucket } from '@/lib/opensearch/client';

const PLACEHOLDERS: Record<string, Record<string, string>> = {
  // antiSMASH's unpredicted-substrate monomer: 54.5% of BGCs with any monomer.
  monomers: { X: 'unpredicted' },
};

/**
 * Label a field's placeholder values and sort them below the real ones. They stay
 * selectable: it is a legitimate query over 1.46M BGCs.
 */
export function demotePlaceholders(field: string, buckets: FacetBucket[]): FacetBucket[] {
  const map = PLACEHOLDERS[field];
  if (!map) return buckets;
  const found = buckets.some((b) => b.value in map);
  if (!found) return buckets;

  const real: FacetBucket[] = [];
  const placeholders: FacetBucket[] = [];
  for (const b of buckets) {
    if (b.value in map) placeholders.push({ ...b, label: map[b.value] });
    else real.push(b);
  }
  return [...real, ...placeholders];
}
