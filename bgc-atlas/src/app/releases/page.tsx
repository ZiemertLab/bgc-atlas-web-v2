"use client";

import Link from 'next/link';
import { Fragment, useEffect } from 'react';

import { MainLayout } from '@/components/layout/main-layout';
import { Badge } from '@/components/ui/badge';
import { CollapsibleSection } from '@/components/ui/collapsible-section';
import { ResizableTable, type TableColumn } from '@/components/ui/resizable-table';
import { withBase } from '@/lib/basePath';
import {
  clusteredText, releasePath, type NotesBlock, type ReleaseChangelog, type ReleaseCounts, type ReleaseSummary,
} from '@/lib/releases/types';
import { useReleases } from '@/lib/releases/use-releases';

// What changed from release to release. Every entry is written by scripts/export/cut_release.py when the
// release is cut (counts and files compared with the previous release, plus its notes), and read at
// runtime from /api/releases: a new release appears here without a deploy.

const COUNT_LABELS: [keyof ReleaseCounts, string][] = [
  ['bgcs', 'BGCs'],
  ['complete_bgcs', 'Complete BGCs'],
  ['gcfs', 'GCFs'],
  ['clustered_bgcs', 'BGCs in a GCF'],
  ['samples', 'Samples'],
  ['genomes', 'Genomes'],
  ['assemblies', 'Assemblies'],
];

const STATUS: Record<ReleaseSummary['status'], string> = {
  current: 'current',
  previous: 'previous',
  preview: 'preview',
  older: 'superseded',
};

const linkClass =
  'font-mono text-foreground underline underline-offset-2 decoration-foreground/50 hover:decoration-foreground';

/** Binary units labelled GB, as on Downloads. */
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

const signed = (n: number) => `${n > 0 ? '+' : '−'}${Math.abs(n).toLocaleString()}`;

/** The notes use `code` spans and nothing else inline. */
function Inline({ text }: { text: string }) {
  return (
    <>
      {text.split('`').map((part, i) => (i % 2 === 1
        ? <code key={i} className="font-mono text-[0.92em] text-foreground">{part}</code>
        : <Fragment key={i}>{part}</Fragment>))}
    </>
  );
}

function Block({ block }: { block: NotesBlock }) {
  if (block.type === 'p') {
    return <p className="max-w-3xl text-sm leading-relaxed text-foreground"><Inline text={block.text} /></p>;
  }
  return (
    <ul className="max-w-3xl list-disc space-y-1 pl-5 text-sm leading-relaxed text-foreground marker:text-muted-foreground">
      {block.items.map((item) => <li key={item}><Inline text={item} /></li>)}
    </ul>
  );
}

/** `43,623 added (list)`; an empty list is not linked. */
function IdCount({ n, verb, href }: { n: number; verb: string; href: string }) {
  return (
    <>
      {n.toLocaleString()} {verb}
      {n > 0 && <> (<a href={withBase(href)} className={linkClass}>list</a>)</>}
    </>
  );
}

type FileRow = { path: string; change: 'changed' | 'added' | 'removed'; size: string; records: string };

function fileRows(files: ReleaseChangelog['files']): FileRow[] {
  const recs = (prev: number | null | undefined, now: number | null | undefined) =>
    prev != null && now != null && prev !== now
      ? `${prev.toLocaleString()} → ${now.toLocaleString()}`
      : now != null ? now.toLocaleString() : '';
  return [
    ...files.changed.map((f) => ({
      path: f.path, change: 'changed' as const,
      size: `${formatSize(f.prevBytes)} → ${formatSize(f.bytes)}`, records: recs(f.prevRecords, f.records),
    })),
    ...files.added.map((f) => ({ path: f.path, change: 'added' as const, size: formatSize(f.bytes), records: recs(null, f.records) })),
    ...files.removed.map((f) => ({ path: f.path, change: 'removed' as const, size: formatSize(f.prevBytes), records: '' })),
  ];
}

const fileColumns: TableColumn<FileRow>[] = [
  { id: 'path', label: 'File', width: 320, sortable: false, renderCell: (r) => <span className="font-mono text-sm">{r.path}</span> },
  { id: 'change', label: 'Change', width: 110, sortable: false, renderCell: (r) => <span className="text-sm text-muted-foreground">{r.change}</span> },
  { id: 'size', label: 'Size', width: 190, sortable: false, renderCell: (r) => <span className="font-mono text-xs tabular-nums">{r.size}</span> },
  {
    id: 'records', label: 'Records', width: 240, sortable: false,
    headerTooltip: 'Regions in the archive and the nucleotide FASTA, proteins in the protein FASTA.',
    renderCell: (r) => <span className="font-mono text-xs tabular-nums">{r.records}</span>,
  },
];

function ReleaseEntry({ release }: { release: ReleaseSummary }) {
  const c = release.changelog;
  const rows = c ? fileRows(c.files) : [];
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-muted-foreground">
        {release.stage === 'beta' && <Badge variant="outline">beta</Badge>}
        <span className="font-mono tabular-nums">released {release.date}</span>
        <span>{STATUS[release.status]}</span>
        {c?.previous && <span>against <span className="font-mono">{c.previous}</span></span>}
        <a href={withBase(releasePath(release.id, 'RELEASE.md'))} className={linkClass}>RELEASE.md</a>
        <a href={withBase(releasePath(release.id, 'manifest.json'))} className={linkClass}>manifest.json</a>
        {!release.filesAvailable && <span>retired: data files deleted, notes and checksums kept</span>}
      </div>

      <dl className="grid grid-cols-1 gap-x-8 gap-y-2 text-sm sm:grid-cols-2 lg:grid-cols-3">
        {COUNT_LABELS.map(([key, label]) => {
          const value = release.counts[key];
          if (value == null) return null;
          const delta = c?.previous ? c.deltas[key] : null;
          return (
            <div key={key} className="leader-row">
              <dt className="whitespace-nowrap text-muted-foreground">{label}</dt>
              <span className="leader-dots" aria-hidden />
              <dd className="whitespace-nowrap font-mono font-medium tabular-nums text-foreground">
                {key === 'clustered_bgcs' ? clusteredText(release.counts) : value.toLocaleString()}
                {delta != null && delta !== 0 && <span className="ml-2 font-normal text-muted-foreground">{signed(delta)}</span>}
              </dd>
            </div>
          );
        })}
      </dl>

      {c?.previous ? (
        <p className="text-sm text-foreground">
          BGC ids: <IdCount n={c.bgcIdsAdded} verb="added" href={releasePath(release.id, 'bgc_ids_added.txt.gz')} />,{' '}
          <IdCount n={c.bgcIdsRemoved} verb="removed" href={releasePath(release.id, 'bgc_ids_removed.txt.gz')} />.
        </p>
      ) : c ? (
        <p className="text-sm text-muted-foreground">The first release: nothing to compare against.</p>
      ) : null}

      {c?.notes.map((section) => (
        <div key={section.heading} className="space-y-2">
          <h3 className="text-sm font-semibold">{section.heading}</h3>
          {section.blocks.map((block, i) => <Block key={i} block={block} />)}
        </div>
      ))}

      {rows.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold">Files</h3>
          <ResizableTable columns={fileColumns} data={rows} className="min-w-full" stickyFirstColumn />
          {c!.files.unchanged > 0 && (
            <p className="text-[13px] text-muted-foreground">
              {c!.files.unchanged.toLocaleString()} other files are unchanged.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

export default function ReleasesPage() {
  const { data, isLoading } = useReleases();
  const releases = data?.releases ?? [];
  const hash = typeof window === 'undefined' ? '' : decodeURIComponent(window.location.hash.slice(1));

  // The sections render only once the index has loaded, after the browser has already looked for the
  // anchor: scroll to it then.
  useEffect(() => {
    if (releases.length && hash) document.getElementById(hash)?.scrollIntoView();
  }, [releases.length, hash]);

  return (
    <MainLayout>
      <div className="mx-auto w-full max-w-[1100px] py-6">
        <header className="mb-8 border-b border-border pb-4">
          <div className="section-label mb-1.5">Downloads</div>
          <h1 className="atlas-rule mb-3 text-2xl font-semibold tracking-tight md:text-3xl">
            Data releases
          </h1>
          <p className="mt-3 max-w-3xl text-[15px] leading-relaxed text-muted-foreground">
            Every file on{' '}
            <Link href="/downloads" className="text-foreground underline underline-offset-4 decoration-foreground/40 hover:decoration-foreground">
              Downloads
            </Link>{' '}
            belongs to a numbered release. What changed in each, newest first; the same as plain text in{' '}
            <a href={withBase('/downloads/releases/CHANGELOG.md')} className={linkClass}>CHANGELOG.md</a>.
          </p>
          <p className="mt-2 max-w-3xl text-[13px] leading-relaxed text-muted-foreground">
            A new major version (R3) means BGC ids or file formats changed; a minor one (R2.1), that BGCs were added
            or removed; a patch (R2.0.1), corrections only. A beta may still change before its final release.
          </p>
        </header>

        {releases.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {isLoading ? 'Loading…' : 'Release information is unavailable right now.'}
          </p>
        ) : (
          <div className="space-y-4">
            {releases.map((release) => (
              <section key={release.id} id={release.id} className="scroll-mt-24">
                <CollapsibleSection
                  title={release.id}
                  badge={release.date}
                  defaultOpen={release.status === 'current' || release.id === hash}
                >
                  <ReleaseEntry release={release} />
                </CollapsibleSection>
              </section>
            ))}
          </div>
        )}
      </div>
    </MainLayout>
  );
}
