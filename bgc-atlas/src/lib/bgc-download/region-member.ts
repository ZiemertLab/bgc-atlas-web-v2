import path from 'path';

// bgcs.filename is `{ARCHIVE}_{CONTIG}.regionNNN`; the archive stores `{CONTIG}.regionNNN.gbk`
// under `{ARCHIVE}/`. Same rule as lib/queue/gcf-export.ts.
export function regionMemberName(filename: string, archivePath: string | null): string {
  const archiveBase = archivePath ? path.basename(archivePath, '.tar.gz') : null;
  let contig = filename;
  if (archiveBase && filename.startsWith(`${archiveBase}_`)) {
    contig = filename.slice(archiveBase.length + 1);
  }
  return contig.endsWith('.gbk') ? contig : `${contig}.gbk`;
}

/** Escape tar's glob metacharacters so a contig name matches only itself. */
export function escapeTarGlob(name: string): string {
  return name.replace(/[\\*?[\]]/g, (c) => `\\${c}`);
}

export function downloadFilename(filename: string, format: 'gbk' | 'fna' | 'faa'): string {
  const base = filename.replace(/\.gbk$/, '').replace(/[^A-Za-z0-9._-]/g, '_');
  return `${base}.${format}`;
}
