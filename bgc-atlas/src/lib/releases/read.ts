import { readFile } from 'node:fs/promises';
import path from 'node:path';

import type { ReleaseChangelog, ReleaseFile, ReleasesPayload, ReleaseSummary } from './types';

/**
 * Reads releases/releases.json and the latest release's manifest.json from the directory nginx serves as
 * /downloads/ (both written by scripts/export/cut_release.py). Cutting a release then needs no build or
 * restart: the site sees it within CACHE_TTL_MS.
 */
const DOWNLOADS_DIR = process.env.DOWNLOADS_DIR || '/data/bgc-atlas/data-v2/populator-out-sequences';
const CACHE_TTL_MS = 5 * 60_000;

interface IndexEntry {
  id: string;
  date: string;
  stage: 'alpha' | 'beta' | 'final';
  status: ReleaseSummary['status'];
  counts: ReleaseSummary['counts'];
  retired_at: string | null;
  kept_permanently: boolean;
  changelog?: {
    previous: string | null;
    deltas: ReleaseChangelog['deltas'];
    bgc_ids_added: number;
    bgc_ids_removed: number;
    files: {
      changed: { path: string; bytes: number; prev_bytes: number; records: number | null; prev_records: number | null }[];
      added: { path: string; bytes: number; records: number | null }[];
      removed: { path: string; prev_bytes: number }[];
      unchanged: number;
    };
    notes: ReleaseChangelog['notes'];
  };
}

function toChangelog(c: NonNullable<IndexEntry['changelog']>): ReleaseChangelog {
  return {
    previous: c.previous,
    deltas: c.deltas,
    bgcIdsAdded: c.bgc_ids_added,
    bgcIdsRemoved: c.bgc_ids_removed,
    files: {
      changed: c.files.changed.map((f) => ({
        path: f.path, bytes: f.bytes, prevBytes: f.prev_bytes, records: f.records, prevRecords: f.prev_records,
      })),
      added: c.files.added,
      removed: c.files.removed.map((f) => ({ path: f.path, prevBytes: f.prev_bytes })),
      unchanged: c.files.unchanged,
    },
    notes: c.notes,
  };
}

interface Manifest {
  release: string;
  previous: string | null;
  bgc_ids_added: number;
  bgc_ids_removed: number;
  files: ReleaseFile[];
}

const EMPTY: ReleasesPayload = {
  latest: null, releases: [], files: [], bgcIdsAdded: 0, bgcIdsRemoved: 0, previousId: null,
};

let cached: { value: ReleasesPayload; at: number } | null = null;

async function load(): Promise<ReleasesPayload> {
  const index = JSON.parse(
    await readFile(path.join(DOWNLOADS_DIR, 'releases', 'releases.json'), 'utf8'),
  ) as { latest: string | null; releases: IndexEntry[] };
  if (!index.latest) return EMPTY;

  const releases: ReleaseSummary[] = index.releases
    .filter((r) => r.stage !== 'alpha')
    .map((r) => ({
      id: r.id,
      date: r.date,
      stage: r.stage === 'final' ? 'final' : 'beta',
      status: r.status,
      counts: r.counts,
      filesAvailable: !r.retired_at,
      keptPermanently: r.kept_permanently,
      changelog: r.changelog ? toChangelog(r.changelog) : null,
    }));

  const manifest = JSON.parse(
    await readFile(path.join(DOWNLOADS_DIR, 'releases', index.latest, 'manifest.json'), 'utf8'),
  ) as Manifest;

  return {
    latest: releases.find((r) => r.id === index.latest) ?? null,
    releases,
    files: manifest.files.map(({ path: p, bytes, records }) => ({ path: p, bytes, records })),
    bgcIdsAdded: manifest.bgc_ids_added,
    bgcIdsRemoved: manifest.bgc_ids_removed,
    previousId: manifest.previous,
  };
}

/** Never throws: an unreadable index is "no release information", not a broken page. */
export async function readReleases(): Promise<ReleasesPayload> {
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.value;
  let value = EMPTY;
  try {
    value = await load();
  } catch (error) {
    console.error('Failed to read the data releases index:', error);
    // Keep serving the last good read rather than flapping to nothing.
    if (cached) value = cached.value;
  }
  cached = { value, at: Date.now() };
  return value;
}
