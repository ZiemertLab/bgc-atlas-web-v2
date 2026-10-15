import fs from 'node:fs';
import path from 'node:path';

/**
 * Delete hash-named snapshot files a manifest no longer points at.
 * Never touches `.manifest.json`; an empty `keep` (a run that wrote nothing)
 * aborts rather than deleting the whole family.
 */
export function pruneSuperseded(opts: {
  outDir: string;
  pattern: RegExp;
  keep: Iterable<string>;
  label: string;
}): string[] {
  const { outDir, pattern, label } = opts;
  const keep = new Set(opts.keep);

  if (keep.size === 0) {
    console.warn(`  ${label}: nothing was written this run — skipping prune rather than deleting every snapshot.`);
    return [];
  }

  const stale = fs.readdirSync(outDir).filter(
    (f) => pattern.test(f) && !f.endsWith('.manifest.json') && !keep.has(f),
  );

  if (stale.length === 0) {
    console.log(`  ${label}: no superseded files to remove.`);
    return [];
  }

  for (const f of stale) {
    const full = path.join(outDir, f);
    const kb = (fs.statSync(full).size / 1024).toFixed(1);
    fs.unlinkSync(full);
    console.log(`  ${label}: removed superseded ${f} (${kb} KB)`);
  }
  return stale;
}
