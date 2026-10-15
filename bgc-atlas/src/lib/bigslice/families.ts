// The clustering is served by two BiG-SLiCE models with independent id spaces, so an id needs its tier:
//   seed        bigslice-output-v3           gcf.id 1–373,816  ->  GCF-<tag>-000042
//   fragmented  bigslice-output-residual-v3  gcf.id 1–427,746  ->  GCF-<tag>-F-400042
// The tag is the release the clustering first shipped in (lib/clustering.ts), so the number stays
// the data.db gcf.id. Resolved by name rather than uuid5(name): MIBiG-only reference families
// have no Atlas row.

import { CURRENT_CLUSTERING } from '@/lib/clustering';

export type BiGSliceTier = 'seed' | 'fragmented';

/** Applied to fragmented NAMES so the two tiers never collide in one namespace. */
const FRAGMENTED_OFFSET = 400_000;

// Applied here because BiG-SLiCE query mode ignores `--threshold` (hardcoded threshold=None).
export const CLUSTERING_THRESHOLD = 0.4;

export function atlasGcfName(tier: BiGSliceTier, bigsliceGcfId: number): string {
  const id = tier === 'fragmented' ? FRAGMENTED_OFFSET + bigsliceGcfId : bigsliceGcfId;
  const prefix = `GCF-${CURRENT_CLUSTERING.tag}-`;
  return `${tier === 'fragmented' ? `${prefix}F-` : prefix}${String(id).padStart(6, '0')}`;
}

export function isMember(distance: number): boolean {
  return distance <= CLUSTERING_THRESHOLD;
}
