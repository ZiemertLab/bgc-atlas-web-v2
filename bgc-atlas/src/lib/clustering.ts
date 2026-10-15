/**
 * Which clustering the site serves. Client-safe.
 *
 * A re-clustering renumbers its families from 1, so family names carry the data release the clustering first
 * shipped in: GCF-v2b6-000042 is family 42 of the clustering released in R2.0-beta.6. Families of a replaced
 * clustering keep resolving to a page that says where their members went (gcf_legacy, gcf_successor), except
 * v2b5 (R2.0-beta.5), which was dropped rather than retired: its names do not resolve, and the v2b4 families
 * point straight at v2b6.
 *
 * When the R2.0 release renames this clustering's families (v2b6 -> v2), `tag` changes here and in
 * scripts/clustering-v3/gcf_pet_name.py PET_OFFSET; the pet names stay.
 */
export const CURRENT_CLUSTERING = {
  /** In family names: GCF-<tag>-000042, GCF-<tag>-F-400042. */
  tag: 'v2b6',
  /** The data release the clustering first shipped in. */
  release: 'R2.0-beta.6',
} as const;

/**
 * How a replaced clustering is described to readers, by its gcf_legacy.clustering label, NEWEST FIRST: a pet name
 * reused by several replaced clusterings resolves to the newest one's family. `release`
 * is the last data release the clustering was part of.
 */
export const PREVIOUS_CLUSTERINGS: Record<string, { release: string; label: string }> = {
  'v2b4-2026-10-12': { release: 'R2.0-beta.4', label: 'the clustering of 12 October 2026' },
  'v2b2-2026-10-09': { release: 'R2.0-beta.3', label: 'the clustering of 9 October 2026' },
  'v3-2026-08': { release: 'R2.0-beta.1', label: 'the August 2026 clustering' },
};

/** gcf_legacy.clustering labels, newest first. */
export const PREVIOUS_CLUSTERING_ORDER: string[] = Object.keys(PREVIOUS_CLUSTERINGS);

/** GCF-v2b6-000042 / GCF-v2b6-F-400042, or the untagged v3 forms; false for anything else. */
export const GCF_NAME_RE = /^GCF-(?:v\d+(?:\.\d+)?(?:[ab]\d+)?-)?(?:(?:CC-)?\d{2}-|F-)?\d{6}$/i;

const NAME_PARTS_RE = /^GCF-(?:(v\d+(?:\.\d+)?(?:[ab]\d+)?)-)?((?:(?:CC-)?\d{2}-|F-)?\d{6})$/i;

/**
 * A family name as it is stored, however it was typed: `GCF-` and the `F-`/`CC-` segments upper-case, the release
 * tag lower-case (gcf-v2b2-f-400001 -> GCF-v2b2-F-400001). Null when it is not a family name. Lets every name lookup
 * be one indexed equality instead of an upper()/lower() scan.
 */
export function canonicalGcfName(input: string): string | null {
  const m = NAME_PARTS_RE.exec(input.trim());
  if (!m) return null;
  return `GCF-${m[1] ? `${m[1].toLowerCase()}-` : ''}${m[2].toUpperCase()}`;
}
