"use client";

import { useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { apiFetch } from '@/lib/basePath';
import { MainLayout } from '@/components/layout/main-layout';
import { BigSliceResultsTable } from '@/components/search/bigslice-results-table';
import { SequenceResultsTable } from '@/components/search/sequence-results-table';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Skeleton } from '@/components/ui/skeleton';
import { formatElapsed } from '@/lib/utils/elapsed';
import { Button } from '@/components/ui/button';
import { ArrowLeft, Terminal } from 'lucide-react';

type JobType = 'bgc' | 'sequence';

interface JobMeta {
  status: string; // pending | running | completed | failed
  progress?: number;
  errorMessage?: string | null;
  createdAt?: string;
  /** When a worker first took the job; null while it is queued. */
  startedAt?: string | null;
  /** Parsed from DIAMOND's log; absent before the first block. */
  diamond?: {
    queryBlock: number;
    refBlock: number;
    refBlocks: number;
    fraction: number;
  } | null;
}

export default function SearchResultsPage() {
  const params = useParams();
  const jobId = (params?.id as string) || '';

  const [type, setType] = useState<JobType | null>(null);
  const [meta, setMeta] = useState<JobMeta | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [loading, setLoading] = useState(true);
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!jobId) return;
    let active = true;

    let transientFails = 0;
    const fetchOnce = async (): Promise<'stop' | 'continue'> => {
      try {
        const res = await apiFetch(`/api/search/results/${jobId}`);
        if (!active) return 'stop';
        if (res.status === 404) {
          setNotFound(true);
          setLoading(false);
          return 'stop';
        }
        // Non-OK (e.g. a 5xx HTML page during a restart) is transient.
        if (!res.ok) throw new Error(`Server responded ${res.status}`);
        const data = await res.json();
        if (!active) return 'stop';
        if (!data.success) {
          setError(data.error || 'Failed to load results');
          setLoading(false);
          return 'stop';
        }
        transientFails = 0;
        setError(null);
        const t = data.type as JobType;
        const m = (data.results?.[t] ?? {}) as JobMeta;
        setType(t);
        setMeta(m);
        setLoading(false);
        return m.status === 'completed' || m.status === 'failed' ? 'stop' : 'continue';
      } catch (e) {
        // Transient failure: keep polling rather than fail on a raw "Unexpected token '<'".
        if (!active) return 'stop';
        transientFails += 1;
        console.warn('results poll failed (will retry):', e);
        setLoading(false);
        if (transientFails >= 5) {
          setError('Having trouble reaching the server — still retrying…');
        }
        return 'continue';
      }
    };

    // One request at a time: the next poll is scheduled only once the last has
    // answered. A fixed interval let a slow poll overlap the next, so a late
    // "running" could land after "completed" had already stopped polling and put the
    // finished page back on its progress bar, for good.
    const poll = async () => {
      const r = await fetchOnce();
      if (r === 'continue' && active) pollRef.current = setTimeout(poll, 2000);
    };
    poll();

    return () => {
      active = false;
      if (pollRef.current) clearTimeout(pollRef.current);
    };
  }, [jobId]);

  // From when a worker took the job, so queued time does not count as running. started_at is
  // stamped once; created_at stands in for records that predate that.
  const startedAt = meta?.startedAt ?? meta?.createdAt;
  const startedMs = startedAt ? new Date(startedAt).getTime() : null;
  const [elapsed, setElapsed] = useState<number | null>(null);
  useEffect(() => {
    if (startedMs === null || (meta?.status !== 'running' && meta?.status !== 'pending')) {
      setElapsed(null);
      return;
    }
    const tick = () => setElapsed(Date.now() - startedMs);
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [startedMs, meta?.status]);

  return (
    <MainLayout>
    <div className="w-full py-8 space-y-6">
      <Link href="/search">
        <Button variant="ghost" size="sm">
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to search
        </Button>
      </Link>

      <div>
        <h1 className="text-2xl font-bold">Search Results</h1>
        <p className="mt-1 font-mono text-sm text-muted-foreground">Job ID: {jobId}</p>
      </div>

      {loading && <Skeleton className="h-40 w-full" />}

      {notFound && (
        <Alert variant="destructive">
          <Terminal className="h-4 w-4" />
          <AlertTitle>Job not found</AlertTitle>
          <AlertDescription>
            No results exist for this Job ID. It may have expired or been mistyped.
          </AlertDescription>
        </Alert>
      )}

      {error && !notFound && (
        <Alert variant="destructive">
          <Terminal className="h-4 w-4" />
          <AlertTitle>Error</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {!loading && !notFound && !error && meta && (
        meta.status === 'failed' ? (
          <Alert variant="destructive">
            <Terminal className="h-4 w-4" />
            <AlertTitle>Search failed</AlertTitle>
            <AlertDescription>{meta.errorMessage || 'The search job failed.'}</AlertDescription>
          </Alert>
        ) : meta.status !== 'completed' ? (
          <div className="space-y-3">
            <p className="text-sm font-medium">
              {meta.status === 'pending'
                ? 'Queued…'
                : type === 'bgc'
                  ? 'Matching against the atlas families…'
                  : 'Scanning 170.6M proteins…'}
              {meta.status !== 'pending' && elapsed !== null && (
                <span className="ml-2 font-normal tabular-nums text-muted-foreground">
                  {formatElapsed(elapsed)} elapsed
                </span>
              )}
            </p>
            {/* DIAMOND names the reference block it is scanning; before the first block it is
                loading the index, hence the indeterminate fallback. Blocks are not equal cost. */}
            {meta.diamond ? (
              <div
                className="h-1.5 w-full overflow-hidden rounded bg-muted"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={meta.diamond.refBlocks}
                aria-valuenow={meta.diamond.refBlock}
                aria-label="Reference blocks scanned"
              >
                <div
                  className="h-full rounded bg-foreground transition-[width] duration-700 ease-out"
                  style={{ width: `${meta.diamond.fraction * 100}%` }}
                />
              </div>
            ) : (
              <div className="relative h-1.5 w-full overflow-hidden rounded bg-muted">
                <div className="absolute inset-y-0 left-0 w-1/3 rounded bg-foreground animate-indeterminate-bar" />
              </div>
            )}
            {meta.diamond && (
              <p className="text-xs tabular-nums text-muted-foreground">
                Reference block {meta.diamond.refBlock} of {meta.diamond.refBlocks}
                {meta.diamond.queryBlock > 1 && ` · query block ${meta.diamond.queryBlock}`}
              </p>
            )}
            {/* Separate timings per search type: DIAMOND's would mislead a BiG-SLiCE wait. */}
            <p className="text-xs text-muted-foreground">
              {type === 'bgc'
                ? 'Most jobs finish in a few minutes. '
                : 'A single protein query takes about 2 minutes. A whole GenBank record takes '
                  + 'far longer — large NRPS/PKS genes match across the database, and 30 minutes '
                  + 'or more is normal. '}
              This page updates automatically — you can leave it open or come back to this URL
              later.
            </p>
          </div>
        ) : type === 'bgc' ? (
          <BigSliceResultsTable sessionId={jobId} />
        ) : (
          <SequenceResultsTable sessionId={jobId} />
        )
      )}
    </div>
    </MainLayout>
  );
}
