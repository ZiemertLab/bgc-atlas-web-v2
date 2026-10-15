/**
 * Data releases as the site shows them (docs/runbooks/data-releases.md). Client-safe: the
 * server reads them from the downloads directory (lib/releases/read.ts), pages get them from /api/releases.
 */

export interface ReleaseCounts {
  bgcs: number;
  complete_bgcs: number | null;
  gcfs: number;
  samples: number;
  metagenome_samples: number | null;
  genomes: number | null;
  assemblies: number;
  /** BGCs placed in a GCF: the coverage every GCF count is shown with. Absent from the earliest releases. */
  clustered_bgcs?: number | null;
}

/** `14,122,531 (88.4%)`: BGCs in a GCF and their share of all BGCs. */
export function clusteredText(counts: ReleaseCounts): string | null {
  if (counts.clustered_bgcs == null || !counts.bgcs) return null;
  const share = (100 * counts.clustered_bgcs) / counts.bgcs;
  return `${counts.clustered_bgcs.toLocaleString()} (${share.toFixed(1)}%)`;
}

export interface ReleaseSummary {
  id: string;
  /** UTC date of the cut, YYYY-MM-DD. */
  date: string;
  stage: 'beta' | 'final';
  /** current = what /downloads serves; previous = the one before it; older = superseded twice or more. */
  status: 'current' | 'previous' | 'preview' | 'older';
  counts: ReleaseCounts;
  /** False once retired: its notes, checksums and id lists stay, its data files are gone. */
  filesAvailable: boolean;
  keptPermanently: boolean;
  /** What changed from the previous release (scripts/export/cut_release.py); null if not recorded. */
  changelog: ReleaseChangelog | null;
}

export type NotesBlock = { type: 'p'; text: string } | { type: 'ul'; items: string[] };

export interface ReleaseChangelog {
  /** null: the first release. */
  previous: string | null;
  /** Against `previous`; null where either release lacks the figure. */
  deltas: Partial<Record<keyof ReleaseCounts, number | null>>;
  bgcIdsAdded: number;
  bgcIdsRemoved: number;
  files: {
    changed: { path: string; bytes: number; prevBytes: number; records: number | null; prevRecords: number | null }[];
    added: { path: string; bytes: number; records: number | null }[];
    removed: { path: string; prevBytes: number }[];
    unchanged: number;
  };
  /** The written notes: `Changes`, `Known issues`, ... */
  notes: { heading: string; blocks: NotesBlock[] }[];
}

export interface ReleaseFile {
  /** Relative to the release directory: `regions_nuc.fasta`, `db/bgcs.tsv.gz`. */
  path: string;
  bytes: number;
  records: number | null;
}

export interface ReleasesPayload {
  /** The release /downloads serves; null before the first release or when the index cannot be read. */
  latest: ReleaseSummary | null;
  /** Newest first. Alphas are never listed. */
  releases: ReleaseSummary[];
  /** The latest release's files. */
  files: ReleaseFile[];
  bgcIdsAdded: number;
  bgcIdsRemoved: number;
  previousId: string | null;
}

/** Under /downloads/: the files of one release. */
export const releasePath = (id: string, file: string) => `/downloads/releases/${id}/${file}`;
