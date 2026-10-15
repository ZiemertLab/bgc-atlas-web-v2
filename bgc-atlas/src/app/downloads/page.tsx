"use client";

import { withBase } from "@/lib/basePath";
import { MainLayout } from '@/components/layout/main-layout';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { CollapsibleSection } from '@/components/ui/collapsible-section';
import { ResizableTable, type TableColumn } from '@/components/ui/resizable-table';
import { clusteredText, releasePath, type ReleaseFile, type ReleaseSummary } from '@/lib/releases/types';
import { finalOf, useReleases } from '@/lib/releases/use-releases';
import { Download } from 'lucide-react';
import Link from 'next/link';

// What is published, and in what order. Sizes, record counts and the release come from the latest
// release's manifest.json (scripts/export/cut_release.py), so cutting a release needs no deploy. What each
// file contains, and how to join them, is documented in db/README.txt.
type Entry = {
  /** Relative to the release directory. */
  path: string;
  downloadName: string;
  format: string;
  /** One line on what the file is for, where the name does not say. */
  note?: string;
};

const db = (file: string, format: string): Entry => ({ path: `db/${file}`, downloadName: file, format });

const CATEGORIES: { title: string; files: Entry[] }[] = [
  {
    title: 'Region GenBank archives',
    files: [
      { path: 'all_regions_gbk.tar.gz', downloadName: 'all_regions_gbk.tar.gz', format: 'TAR.GZ' },
      {
        path: 'all_regions_gbk.index.tsv.gz', downloadName: 'all_regions_gbk.index.tsv.gz', format: 'TSV.GZ',
        note: 'Where each region sits in all_regions_gbk.tar.gz. Belongs to this release of the archive.',
      },
      {
        path: 'extract_gbk.py', downloadName: 'extract_gbk.py', format: 'PY',
        note: 'Pulls listed BGCs out of a local copy of the archive using the index, without unpacking it. Python 3.8+, no dependencies; see --help.',
      },
    ],
  },
  {
    title: 'All region sequences (combined)',
    files: [
      { path: 'regions_nuc.fasta', downloadName: 'bgc-atlas_all_regions_nuc.fasta', format: 'FASTA' },
      { path: 'regions_prot.faa', downloadName: 'bgc-atlas_all_regions_prot.faa', format: 'FAA' },
    ],
  },
  {
    title: 'Genomes',
    files: [{
      ...db('genomes.tsv.gz', 'TSV.GZ'),
      note: 'One row per genome (isolate, MAG, SAG): CheckM2 completeness and contamination with their source, MIMAG quality, lineage and BGC count.',
    }],
  },
  {
    title: 'Gene cluster families',
    files: [db('gcfs.tsv.gz', 'TSV.GZ'), db('bgc_gcf.tsv.gz', 'TSV.GZ')],
  },
  {
    title: 'BiG-SLiCE clustering runs',
    files: [
      { path: 'clustering-v3/bigslice-v3-seed.tar.gz', downloadName: 'bgc-atlas_bigslice-v3-seed.tar.gz', format: 'TAR.GZ' },
      { path: 'clustering-v3/bigslice-v3-residual.tar.gz', downloadName: 'bgc-atlas_bigslice-v3-residual.tar.gz', format: 'TAR.GZ' },
      { path: 'clustering-v3/README.txt', downloadName: 'README_clustering-v3.txt', format: 'TXT' },
    ],
  },
  {
    title: 'Database tables',
    files: [
      db('bgc_atlas_v2_tables_tsv.tar.gz', 'TAR.GZ'),
      db('bgc_atlas_v2_tables_parquet.tar.gz', 'TAR.GZ'),
      db('bgc_atlas_v2_core.dump', 'PGDUMP'),
      db('README.txt', 'TXT'),
    ],
  },
  {
    title: 'Provenance and join keys',
    files: [
      { path: 'bgc_uuid_source.parquet', downloadName: 'bgc_uuid_source.parquet', format: 'PARQUET' },
      { path: 'bgc_uuid_source.tsv.gz', downloadName: 'bgc_uuid_source.tsv.gz', format: 'TSV.GZ' },
      { path: 'README_bgc_uuid_source.md', downloadName: 'README_bgc_uuid_source.md', format: 'MD' },
      {
        path: 'bgc_id_redirects.tsv.gz', downloadName: 'bgc_id_redirects.tsv.gz', format: 'TSV.GZ',
        note: 'BGC ids removed on 2026-10-05 (assemblies loaded twice), each mapped to the BGC that replaced it.',
      },
    ],
  },
];

/** What a record is, for the files whose count the manifest states. */
const RECORD_UNITS: Record<string, string> = {
  'all_regions_gbk.tar.gz': 'regions',
  'all_regions_gbk.index.tsv.gz': 'regions',
  'regions_nuc.fasta': 'regions',
  'regions_prot.faa': 'proteins',
};

/** Binary units labelled GB, as this page always has (the 181 GB archive is 166.5 of these). */
function formatSize(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i += 1;
  }
  return i === 0 ? `${value} B` : `${value.toFixed(1)} ${units[i]}`;
}

const STATUS_LABELS: Record<ReleaseSummary['status'], string> = {
  current: 'Current',
  previous: 'Previous',
  preview: 'Preview',
  older: 'Superseded',
};

const linkClass =
  'font-mono text-foreground underline underline-offset-2 decoration-foreground/50 hover:decoration-foreground';

export default function DownloadsPage() {
  const { data, isLoading } = useReleases();
  const latest = data?.latest ?? null;
  const files = new Map<string, ReleaseFile>((data?.files ?? []).map((f) => [f.path, f]));
  // Until the release is known (or if it cannot be read) the links go to the top-level names, which
  // always serve the latest release.
  const href = (file: string) => withBase(latest ? releasePath(latest.id, file) : `/downloads/${file}`);
  const fmt = (value?: number | null) => (value == null ? '—' : value.toLocaleString());

  const releaseColumns: TableColumn<ReleaseSummary>[] = [
    {
      id: 'id', label: 'Release', width: 150, sortable: false,
      renderCell: (r) => <span className="font-mono text-sm text-foreground">{r.id}</span>,
    },
    {
      id: 'date', label: 'Released', width: 120, sortable: false,
      renderCell: (r) => <span className="font-mono text-xs tabular-nums text-muted-foreground">{r.date}</span>,
    },
    {
      id: 'bgcs', label: 'BGCs', width: 130, sortable: false,
      renderCell: (r) => <span className="font-mono text-sm tabular-nums">{r.counts.bgcs.toLocaleString()}</span>,
    },
    {
      id: 'status', label: 'Status', width: 120, sortable: false,
      renderCell: (r) => <span className="text-sm text-muted-foreground">{STATUS_LABELS[r.status]}</span>,
    },
    {
      id: 'files', label: 'Files', width: 260, sortable: false,
      headerTooltip: 'A retired release keeps its notes, checksums and lists of added and removed BGC ids; its data files are deleted.',
      renderCell: (r) => (
        <span className="text-sm text-muted-foreground">
          {r.filesAvailable ? 'Available' : 'Retired: notes and checksums only'}
          {r.keptPermanently && ', kept permanently'}
        </span>
      ),
    },
    {
      id: 'notes', label: 'Changes', width: 120, sortable: false,
      renderCell: (r) => (
        <Link href={`/releases#${r.id}`} className={`${linkClass} text-xs`}>
          {r.id}
        </Link>
      ),
    },
  ];

  return (
    <MainLayout>
      <div className="w-full py-6">
        <header className="mb-6 border-b border-border pb-4">
          <h1 className="atlas-rule mb-3 text-2xl font-semibold tracking-tight md:text-3xl">
            Downloads
          </h1>
          <p className="mt-3 max-w-3xl text-[14px] leading-relaxed text-muted-foreground">
            Bulk sequence, clustering and database exports for offline analysis.
            Contents and join instructions are in{' '}
            <a href={href('db/README.txt')} className={linkClass}>
              db/README.txt
            </a>
            .
          </p>
        </header>

        <section id="releases" className="mb-8 scroll-mt-24 border-b border-border pb-4">
          <div className="section-label mb-2.5">Data release</div>
          {latest ? (
            <>
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span className="font-mono text-lg font-semibold text-foreground">{latest.id}</span>
                {latest.stage === 'beta' && <Badge variant="outline">beta</Badge>}
                <span className="font-mono text-xs tabular-nums text-muted-foreground">
                  released {latest.date}
                </span>
              </div>
              <p className="mt-2 max-w-3xl text-[13px] leading-relaxed text-muted-foreground">
                {latest.stage === 'beta' && (
                  <>A pre-release: complete and public, but it may still change before {finalOf(latest.id)}. </>
                )}
                Intermediate releases are kept until superseded twice, the first and last release of each
                major version permanently.
              </p>
              <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[13px]">
                <Link href="/releases" className={linkClass}>Changes by release</Link>
                <a href={href('RELEASE.md')} className={linkClass}>Release notes</a>
                <a href={href('SHA256SUMS')} className={linkClass}>SHA256SUMS</a>
                <a href={href('manifest.json')} className={linkClass}>manifest.json</a>
              </p>
            </>
          ) : (
            <p className="text-[13px] text-muted-foreground">
              {isLoading ? 'Loading…' : 'Release information is unavailable right now; the files below are the latest release.'}
            </p>
          )}

          <dl className="mt-4 grid grid-cols-1 gap-x-8 gap-y-2 text-sm sm:grid-cols-2 lg:grid-cols-3">
            {([
              ['BGCs', latest?.counts.bgcs],
              ['Complete BGCs', latest?.counts.complete_bgcs],
              ['Samples', latest?.counts.samples],
              ['GCFs', latest?.counts.gcfs],
              ['BGCs in a GCF', latest ? clusteredText(latest.counts) : null],
              ['Assemblies', latest?.counts.assemblies],
            ] as const).map(([label, value]) => (
              <div key={label} className="leader-row">
                <dt className="whitespace-nowrap text-muted-foreground">{label}</dt>
                <span className="leader-dots" aria-hidden />
                <dd className="whitespace-nowrap font-mono font-medium tabular-nums text-foreground">
                  {typeof value === 'string' ? value : fmt(value)}
                </dd>
              </div>
            ))}
          </dl>
        </section>

        <div className="space-y-10">
          {CATEGORIES.map((category) => ({
            ...category,
            // Once the release is known, list only what it contains: a file added in a later
            // release must not link to a 404 while an older release is current.
            files: latest ? category.files.filter((f) => files.has(f.path)) : category.files,
          })).filter((category) => category.files.length > 0).map((category) => (
            <section key={category.title}>
              <div className="mb-3 border-b border-border pb-2">
                <h2 className="text-base font-medium">{category.title}</h2>
              </div>
              <ul className="divide-y divide-border">
                {category.files.map((file) => {
                  const meta = files.get(file.path);
                  const unit = RECORD_UNITS[file.path];
                  return (
                    <li
                      key={file.path}
                      className="grid gap-3 py-4 sm:grid-cols-[1fr_auto] sm:items-center"
                    >
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <h4 className="break-all font-mono text-sm font-medium text-foreground">
                            {file.path.split('/').pop()}
                          </h4>
                          <Badge variant="outline">{file.format}</Badge>
                        </div>
                        {file.note && (
                          <p className="mt-1 max-w-2xl text-[13px] leading-relaxed text-muted-foreground">{file.note}</p>
                        )}
                        <div className="mt-1.5 flex flex-wrap items-center gap-4 font-mono text-xs tabular-nums text-muted-foreground">
                          <span>{meta ? formatSize(meta.bytes) : '—'}</span>
                          {meta?.records != null && unit && (
                            <span>{meta.records.toLocaleString()} {unit}</span>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-3 sm:justify-end">
                        <a
                          href={href(`${file.path}.sha256`)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="font-mono text-xs text-muted-foreground hover:text-foreground hover:underline"
                          title="SHA256 checksum for this file (opens as text; sha256sum -c)"
                        >
                          sha256
                        </a>
                        <Button asChild size="sm">
                          <a href={href(file.path)} download={file.downloadName}>
                            <Download className="size-3.5" />
                            Download
                          </a>
                        </Button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>

        {(data?.releases.length ?? 0) > 1 && (
          <CollapsibleSection title="All releases" badge={data!.releases.length} className="mt-10">
            <ResizableTable
              columns={releaseColumns}
              data={data!.releases}
              className="min-w-full"
              stickyFirstColumn
            />
          </CollapsibleSection>
        )}
      </div>
    </MainLayout>
  );
}
