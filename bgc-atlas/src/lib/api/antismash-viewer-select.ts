import { readdir } from 'fs/promises';
import type { Dirent } from 'fs';
import path from 'path';

// Converted MGnify tarballs hold two antiSMASH outputs: `<name>_basic/` (prescreen over the
// whole assembly) and `<name>/` (real pass over region-bearing contigs). Their record numbering
// differs, so a `bgcs.anchor` matches only one, and readdir order is not stable. The rule below
// must stay identical to `select_regions_js` in scripts/populator/adapters/anchors.py.

export const isPrescreenDir = (dirPath: string): boolean => {
  const name = dirPath.split('/').filter(Boolean).pop() ?? '';
  return name.endsWith('_basic');
};

/** Shallowest path first, then lexicographic. Never input order. */
const byDepthThenName = (a: string, b: string) => {
  const depthA = a.split('/').filter(Boolean).length;
  const depthB = b.split('/').filter(Boolean).length;
  return depthA !== depthB ? depthA - depthB : a.localeCompare(b);
};

// Prefers the real run; the prescreen only when it is the sole viewer.
export const chooseViewerDir = (dirPaths: string[]): string | null => {
  if (dirPaths.length === 0) {
    return null;
  }
  const sorted = [...dirPaths].sort(byDepthThenName);
  const real = sorted.filter(dir => !isPrescreenDir(dir));
  return (real.length > 0 ? real[0] : sorted[0]) ?? null;
};

export interface ResultsJsonCandidate {
  filePath: string;
  size: number;
}

// Size alone is not enough: the prescreen's whole-assembly JSON is far larger and its record
// indices match no stored anchor.
export const rankResultsJsonCandidates = <T extends ResultsJsonCandidate>(candidates: T[]): T[] => {
  const describe = (candidate: T) => {
    const segments = candidate.filePath.split('/');
    const dir = segments.slice(0, -1).join('/');
    return {
      prescreen: isPrescreenDir(dir),
      regions: candidate.filePath.toLowerCase().endsWith('_regions.json'),
    };
  };

  return [...candidates].sort((a, b) => {
    const da = describe(a);
    const db = describe(b);
    if (da.prescreen !== db.prescreen) {
      return da.prescreen ? 1 : -1;
    }
    if (da.regions !== db.regions) {
      return da.regions ? -1 : 1;
    }
    return b.size - a.size;
  });
};

export interface AntismashIndexLocation {
  relativeIndexPath: string;
  // metaSMASH's index.html is a dashboard that ignores the URL #hash; its regions.html honours it.
  relativeRegionsPath: string | null;
}

// Takes a path rather than a run id so it stays free of Prisma and testable on real trees.
export const findAntismashIndex = async (rootDir: string): Promise<AntismashIndexLocation | null> => {
  const queue: Array<{ relative: string; depth: number }> = [{ relative: '', depth: 0 }];
  const maxDepth = 6;

  // Collect every viewer rather than readdir's first; both are siblings, so `deepestDepth` stops
  // the descent once a depth yields a hit.
  const viewers = new Map<string, { hasRegionsHtml: boolean }>();
  let deepestDepth = maxDepth;

  while (queue.length > 0) {
    const { relative, depth } = queue.shift()!;
    if (depth > deepestDepth) {
      continue;
    }

    const dirPath = relative ? path.join(rootDir, relative) : rootDir;
    let entries: Dirent[];
    try {
      entries = await readdir(dirPath, { withFileTypes: true });
    } catch {
      continue;
    }

    if (entries.some(e => e.isFile() && e.name.toLowerCase() === 'index.html')) {
      viewers.set(relative, {
        // Per directory, so the chosen viewer never gets another viewer's regions.html.
        hasRegionsHtml: entries.some(e => e.isFile() && e.name.toLowerCase() === 'regions.html'),
      });
      deepestDepth = Math.min(deepestDepth, depth);
      continue;
    }

    for (const entry of entries) {
      if (entry.name.startsWith('.') || !entry.isDirectory()) {
        continue;
      }
      queue.push({
        relative: relative ? path.join(relative, entry.name) : entry.name,
        depth: depth + 1,
      });
    }
  }

  const chosen = chooseViewerDir([...viewers.keys()]);
  if (chosen === null) {
    return null;
  }

  const dirSegments = chosen ? chosen.split(path.sep).filter(Boolean) : [];
  return {
    relativeIndexPath: [...dirSegments, 'index.html'].join('/'),
    relativeRegionsPath: viewers.get(chosen)!.hasRegionsHtml
      ? [...dirSegments, 'regions.html'].join('/')
      : null,
  };
};
