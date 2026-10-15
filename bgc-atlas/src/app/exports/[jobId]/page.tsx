'use client';

import { apiFetch, withBase } from "@/lib/basePath";
import { use, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { formatDistanceToNow } from 'date-fns';
import { ArrowLeft, Clock, Download, Loader2 } from 'lucide-react';
import { MainLayout } from '@/components/layout/main-layout';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { CollapsibleSection } from '@/components/ui/collapsible-section';
import { CopyLinkButton } from '@/components/ui/copy-link-button';
import { Progress } from '@/components/ui/progress';
import { PROPERTY_GBK_EXPORT_MAX_REGIONS } from '@/lib/gcf/export-limits';

interface ExportJobData {
  id: string;
  kind: 'gcf' | 'regions';
  gcfId: string | null;
  gcfName: string | null;
  searchConditions: string[];
  searchHref: string | null;
  status: string;
  progress: number;
  totalBgcs: number | null;
  processedBgcs: number;
  missingFiles: number;
  outputFilename: string | null;
  fileSizeBytes: number | null;
  startedAt: string | null;
  completedAt: string | null;
  durationMs: number | null;
  errorMessage: string | null;
  expiresAt: string | null;
  isDeleted: boolean;
  fileExists: boolean;
  downloadUrl: string | null;
  createdAt: string | null;
}

const POLL_MS = 5000;

const formatFileSize = (bytes: number) => {
  const units = ['bytes', 'KB', 'MB', 'GB'];
  let i = 0;
  let v = bytes;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i += 1; }
  return `${i === 0 ? v : v.toLocaleString(undefined, { maximumFractionDigits: 1 })} ${units[i]}`;
};

const formatDuration = (ms: number) => {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
};

function StatusBadge({ status, available }: { status: string; available: boolean }) {
  if (status === 'running') {
    return (
      <Badge variant="outline" className="gap-1.5">
        <Loader2 className="size-3 animate-spin" aria-hidden /> Running
      </Badge>
    );
  }
  if (status === 'pending') return <Badge variant="outline">Queued</Badge>;
  if (status === 'failed') return <Badge variant="outline" className="border-destructive/40 text-destructive">Failed</Badge>;
  if (status === 'completed' && available) {
    return <Badge variant="outline" className="border-success/40 text-success">Ready</Badge>;
  }
  if (status === 'completed') return <Badge variant="outline" className="text-muted-foreground">Expired</Badge>;
  return <Badge variant="outline" className="text-muted-foreground">{status}</Badge>;
}

function Leader({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className="leader-row">
      <dt className="whitespace-nowrap text-muted-foreground">{label}</dt>
      <span className="leader-dots" aria-hidden />
      <dd className={`font-mono font-medium tabular-nums ${className ?? 'text-foreground'}`}>{children}</dd>
    </div>
  );
}

export default function ExportStatusPage({
  params,
}: {
  params: Promise<{ jobId: string }>;
}) {
  const { jobId } = use(params);
  const [exportData, setExportData] = useState<ExportJobData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const fetchStatus = useCallback(async () => {
    try {
      const response = await apiFetch(`/api/exports/${jobId}`);
      const result = await response.json();
      if (!result.success) throw new Error(result.error || 'Failed to fetch export status');
      setExportData(result.data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch export status');
    } finally {
      setLoading(false);
      setNow(Date.now());
    }
  }, [jobId]);

  // Depend on status alone: exportData is a new reference on every fetch and would restart the interval.
  const status = exportData?.status;
  const active = status === 'pending' || status === 'running';

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  useEffect(() => {
    if (!active) return;
    const interval = setInterval(fetchStatus, POLL_MS);
    return () => clearInterval(interval);
  }, [fetchStatus, active]);

  if (loading) {
    return (
      <MainLayout>
        <div className="mx-auto flex min-h-[400px] w-full max-w-[1100px] items-center justify-center py-8">
          <Loader2 className="size-6 animate-spin text-muted-foreground" aria-label="Loading" />
        </div>
      </MainLayout>
    );
  }

  if (error || !exportData) {
    return (
      <MainLayout>
        <div className="mx-auto w-full max-w-[1100px] py-8">
          <div className="section-label mb-1.5">GBK export</div>
          <h1 className="mb-3 text-2xl font-semibold tracking-tight">Export not found</h1>
          <p className="text-sm text-muted-foreground">
            This export does not exist, or its record has been removed.
          </p>
          <Link href="/search?tab=properties" className="mt-4 inline-block">
            <Button variant="ghost" size="sm"><ArrowLeft className="size-3.5" /> Back to search</Button>
          </Link>
        </div>
      </MainLayout>
    );
  }

  const d = exportData;
  const isRegions = d.kind === 'regions';
  const available = d.status === 'completed' && d.fileExists && !!d.downloadUrl;
  const total = d.totalBgcs ?? 0;
  const done = d.status === 'completed';
  const packaged = done ? Math.max(0, total - d.missingFiles) : d.processedBgcs;
  const elapsedMs = d.startedAt ? (d.completedAt ? new Date(d.completedAt).getTime() : now) - new Date(d.startedAt).getTime() : null;

  const backHref = isRegions ? (d.searchHref ?? '/search?tab=properties') : `/gcfs/${d.gcfId}`;
  const backLabel = isRegions ? 'Back to search' : 'Back to GCF';

  return (
    <MainLayout>
      <div className="mx-auto w-full max-w-[1100px] py-8">
        <header className="mb-6 border-b border-border pb-4">
          <div className="section-label mb-1.5">GBK export</div>
          <div className="atlas-rule mb-3">
            <h1 className={`text-2xl font-semibold tracking-tight md:text-3xl ${isRegions ? '' : 'font-mono'}`}>
              {isRegions ? 'Property search regions' : d.gcfName}
            </h1>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            <StatusBadge status={d.status} available={available} />
            <Badge variant="outline" className="font-mono" title="Export job id">{d.id}</Badge>
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <Link href={backHref}>
              <Button variant="ghost" size="sm">
                <ArrowLeft className="size-3.5" />
                {backLabel}
              </Button>
            </Link>
            {available && (
              <Button size="sm" asChild>
                <a href={withBase(d.downloadUrl as string)} download>
                  <Download className="size-3.5" />
                  Download zip
                </a>
              </Button>
            )}
            <CopyLinkButton className="ml-auto" label="Copy link to this export" />
          </div>
        </header>

        <section className="mb-6 border-b border-border pb-4">
          <div className="section-label mb-2.5">Summary</div>
          <dl className="grid grid-cols-1 gap-x-8 gap-y-2 text-sm sm:grid-cols-2 lg:grid-cols-3">
            <Leader label="Regions">{total ? total.toLocaleString() : '—'}</Leader>
            <Leader label={done ? 'Packaged' : 'Processed'}>{packaged.toLocaleString()}</Leader>
            {d.missingFiles > 0 && (
              <Leader label="Not packaged" className="text-warning">{d.missingFiles.toLocaleString()}</Leader>
            )}
            {d.fileSizeBytes != null && <Leader label="Zip size">{formatFileSize(d.fileSizeBytes)}</Leader>}
            {elapsedMs != null && (
              <Leader label={done || d.status === 'failed' ? 'Took' : 'Running for'}>{formatDuration(elapsedMs)}</Leader>
            )}
            {d.createdAt && !d.startedAt && (
              <Leader label="Queued">{formatDistanceToNow(new Date(d.createdAt), { addSuffix: true })}</Leader>
            )}
            {available && d.expiresAt && (
              <Leader label="Kept until">
                {new Date(d.expiresAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
              </Leader>
            )}
          </dl>
        </section>

        {active && (
          <section className="mb-6 space-y-3 border-b border-border pb-4">
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span className="text-muted-foreground">
                {d.status === 'pending'
                  ? 'Waiting for the export ahead of it to finish.'
                  : d.processedBgcs === 0
                    ? 'Finding the matching regions…'
                    : `${d.processedBgcs.toLocaleString()} of ${total.toLocaleString()} regions`}
              </span>
              <span className="font-mono tabular-nums">{d.progress}%</span>
            </div>
            <Progress value={d.progress} aria-label="Export progress" />
            <div className="flex gap-2.5 rounded-md border border-warning/30 bg-warning/5 p-3 text-sm">
              <Clock className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
              <p>
                <span className="font-medium">Large exports can take up to an hour.</span>{' '}
                <span className="text-muted-foreground">
                  This page updates by itself. You can close it: the export keeps running, and stays
                  under Recent Jobs on the search page.
                </span>
              </p>
            </div>
          </section>
        )}

        {d.status === 'failed' && (
          <section className="mb-6 border-b border-border pb-4 text-sm">
            <div className="section-label mb-2 text-destructive">Export failed</div>
            <p className="text-muted-foreground">{d.errorMessage || 'The export stopped without saying why.'}</p>
          </section>
        )}

        {done && !available && (
          <section className="mb-6 border-b border-border pb-4 text-sm text-muted-foreground">
            This zip has expired and been deleted. Start the export again to rebuild it.
          </section>
        )}

        {isRegions && (
          <CollapsibleSection title="Search" defaultOpen>
            {d.searchConditions.length > 0 ? (
              <ul className="space-y-1 font-mono text-sm">
                {d.searchConditions.map((c, i) => <li key={i}>{c}</li>)}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">No filters: every BGC, in the search&apos;s sort order.</p>
            )}
            {total >= PROPERTY_GBK_EXPORT_MAX_REGIONS && (
              <p className="mt-3 text-sm text-muted-foreground">
                The search matched more than the export limit; the zip holds the first{' '}
                {total.toLocaleString()} matches, in the search&apos;s sort order.
              </p>
            )}
            {d.searchHref && (
              <Link href={d.searchHref} className="mt-3 inline-block text-sm underline underline-offset-4">
                Open this search
              </Link>
            )}
          </CollapsibleSection>
        )}
      </div>
    </MainLayout>
  );
}
