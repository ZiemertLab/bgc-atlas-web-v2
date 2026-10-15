'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { AntismashExtractionStatus } from '@/components/ui/antismash-extraction-status';
import type { AntismashRunRecord } from '@/lib/api/antismash';
import { withBase } from '@/lib/basePath';

interface AntismashRunClientProps {
  run: AntismashRunRecord;
  initialAnchor?: string | null;
}

type ViewMode = 'status' | 'viewer';

const buildIframeSrc = (
  runId: string,
  indexPath: string,
  regionsPath: string | null,
  anchor?: string | null,
) => {
  // metaSMASH's index.html ignores the #hash; its regions.html honours it.
  // antiSMASH runs have no regions.html and index.html is the viewer.
  const relativePath = anchor && regionsPath ? regionsPath : indexPath;
  const sanitized = relativePath
    .split(/[\\/]+/)
    .filter(Boolean)
    .map(segment => encodeURIComponent(segment))
    .join('/');

  const hash = anchor ? `#${encodeURIComponent(anchor)}` : '';
  return withBase(`/antismash/${runId}/files/${sanitized}${hash}`);
};

export function AntismashRunClient({ run, initialAnchor = null }: AntismashRunClientProps) {
  const [anchor] = useState<string | null>(initialAnchor ?? null);
  const [iframeSrc, setIframeSrc] = useState<string | null>(() =>
    run.extraction.isExtracted && run.extraction.indexRelativePath
      ? buildIframeSrc(run.id, run.extraction.indexRelativePath, run.extraction.regionsRelativePath, initialAnchor)
      : null
  );
  const [viewMode, setViewMode] = useState<ViewMode>(iframeSrc ? 'viewer' : 'status');
  // The viewer applies the #hash only after a heavy init (seconds on large runs),
  // so overlay a loading indicator until the target region is displayed.
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [regionReady, setRegionReady] = useState(false);

  const handleReady = useCallback(
    ({ indexRelativePath, regionsRelativePath }: { indexRelativePath: string | null; regionsRelativePath: string | null }) => {
      if (!indexRelativePath) {
        return;
      }
      setIframeSrc(buildIframeSrc(run.id, indexRelativePath, regionsRelativePath, anchor));
      setViewMode('viewer');
    },
    [run.id, anchor]
  );

  const hasArchive = Boolean(run.file_path);
  const initialStatus = run.extraction.isExtracted && run.extraction.indexRelativePath ? 'ready' : 'idle';

  const metaItems = useMemo(
    () => [
      { label: 'Name', value: run.name ?? '—', monospace: false },
      { label: 'BGCs Detected', value: run.num_bgcs.toString(), monospace: false },
      {
        label: 'Extraction Directory',
        value: run.extraction.directory ?? 'Not extracted yet',
        monospace: true,
      },
    ],
    [run]
  );

  useEffect(() => {
    if (viewMode !== 'viewer' || !iframeSrc || !anchor) {
      setRegionReady(true);
      return;
    }
    setRegionReady(false);
    let cancelled = false;
    const startedAt = Date.now();
    const MAX_WAIT_MS = 30_000;
    let timer: ReturnType<typeof setTimeout>;
    const poll = () => {
      if (cancelled) return;
      let shown = false;
      try {
        const win = iframeRef.current?.contentWindow;
        const el = win?.document.getElementById(anchor);
        shown = !!el && win!.getComputedStyle(el).display !== 'none';
      } catch {
        // iframe still navigating; keep polling
      }
      if (shown || Date.now() - startedAt > MAX_WAIT_MS) {
        setRegionReady(true);
        return;
      }
      timer = setTimeout(poll, 250);
    };
    timer = setTimeout(poll, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [viewMode, iframeSrc, anchor]);

  if (viewMode === 'viewer' && iframeSrc) {
    return (
      <div className="flex w-full flex-col gap-6">
        <div className="relative w-full overflow-hidden rounded-xl border bg-background shadow-sm">
          <iframe
            ref={iframeRef}
            title={`antiSMASH results for ${run.name ?? run.id}`}
            src={iframeSrc}
            className="h-[calc(100vh-12rem)] min-h-[70vh] w-full"
          />
          {anchor && !regionReady && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-background/90 backdrop-blur-sm">
              <Loader2 className="size-6 animate-spin text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                Loading region <span className="font-mono">{anchor}</span>…
              </p>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex w-full flex-col gap-6">
      <AntismashExtractionStatus
        runId={run.id}
        hasArchive={hasArchive}
        initialStatus={initialStatus}
        initialIndexRelativePath={run.extraction.indexRelativePath}
        initialRegionsRelativePath={run.extraction.regionsRelativePath}
        onReady={handleReady}
      />
      <Card>
        <CardHeader>
          <CardTitle className="text-2xl font-semibold">antiSMASH Run</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="divide-y divide-border text-sm">
            {metaItems.map(item => (
              <div
                key={item.label}
                className="flex flex-col gap-1 py-4 sm:flex-row sm:items-center sm:justify-between"
              >
                <dt className="text-muted-foreground">{item.label}</dt>
                <dd className={item.monospace ? 'font-mono text-foreground sm:text-right' : 'font-medium text-foreground sm:text-right'}>
                  {item.value}
                </dd>
              </div>
            ))}
          </dl>
        </CardContent>
      </Card>
    </div>
  );
}
