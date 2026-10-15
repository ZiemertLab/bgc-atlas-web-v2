import { CURRENT_CLUSTERING } from '@/lib/clustering';

// How GCF names are explained in the UI. Grammar: GCF-<tag>-<id6> (seed) | GCF-<tag>-F-<id6>
// (fragmented). The tag is the data release the clustering first shipped in (lib/clustering.ts);
// a re-clustering renumbers its families from 1, so without the tag a name would denote an
// unrelated family in each run. Names from replaced clusterings resolve to a page saying where
// those families' members went. The fragmented tier is offset by 400000 because both tiers' id
// counters start at 1 and the alias is a function of the id.
export const GCF_NAME_TOOLTIP =
  `Family name: GCF-${CURRENT_CLUSTERING.tag}-<id>, or GCF-${CURRENT_CLUSTERING.tag}-F-<id> for a fragmented family. ` +
  `${CURRENT_CLUSTERING.tag} is the data release the clustering first appeared in (${CURRENT_CLUSTERING.release}).`;

export const FRAGMENTED_TOOLTIP =
  'Fragmented family (the F in the name): found by clustering the BGCs the main seed ' +
  'could not place, most of which are truncated at a contig edge. About a quarter of ' +
  'these families do contain at least one core-complete member; the rest are built ' +
  'entirely from partial regions, so the product they encode is usually not readable.';

// The Tier column of the legend table; the only place either tier is defined.
export const TIER_EXPLAINER =
  'Seed families come from the first clustering pass, over BGCs that are complete or ' +
  'at least median length. Fragmented families come from a second pass over what ' +
  'it could not place, so their members are mostly regions truncated at a contig edge.';

// Literal gcfs.pet_name values: the encoder reads wordlists from disk at import
// time and cannot be imported into app code.
export const GCF_NAME_EXAMPLES = [
  { name: 'GCF-v2b6-000042',   tier: 'Seed',       alias: 'uplifting-mooneye' },
  { name: 'GCF-v2b6-000336',   tier: 'Seed',       alias: 'jubilant-kalong' },
  { name: 'GCF-v2b6-F-400042', tier: 'Fragmented', alias: 'diligent-whippoorwill' },
  { name: 'GCF-v2b6-F-400004', tier: 'Fragmented', alias: 'purified-grizzly' },
] as const;

export type GcfNameExample = (typeof GCF_NAME_EXAMPLES)[number];
