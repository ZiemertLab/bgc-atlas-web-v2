'use client';

import { apiFetch } from "@/lib/basePath";
import { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Loader2 } from 'lucide-react';

interface AntismashExtractionStatusProps {
  runId: string;
  hasArchive: boolean;
  initialStatus: 'idle' | 'ready';
  initialIndexRelativePath: string | null;
  initialRegionsRelativePath: string | null;
  onReady?: (payload: { indexRelativePath: string | null; regionsRelativePath: string | null }) => void;
}

type ExtractionStatus = 'idle' | 'extracting' | 'ready' | 'missing-file' | 'error';

export function AntismashExtractionStatus({
  runId,
  hasArchive,
  initialStatus,
  initialIndexRelativePath,
  initialRegionsRelativePath,
  onReady,
}: AntismashExtractionStatusProps) {
  const [status, setStatus] = useState<ExtractionStatus>(initialStatus);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!hasArchive) {
      setStatus('missing-file');
      setMessage('No archive file is available for this run.');
      return;
    }

    if (initialStatus === 'ready') {
      setStatus('ready');
      setMessage('Archive already extracted.');
      onReady?.({ indexRelativePath: initialIndexRelativePath, regionsRelativePath: initialRegionsRelativePath });
      return;
    }

    let isCancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    // Extraction can take minutes; start it and poll, so a dropped connection does not lose the
    // result. The server keeps extracting regardless.
    const POLL_MS = 2000;

    const applyTerminal = (payload: Record<string, unknown> | null, fallback: string) => {
      const status = payload?.status;
      if (status === 'ready') {
        setStatus('ready');
        setMessage('Extraction complete.');
        onReady?.({
          indexRelativePath: typeof payload?.indexRelativePath === 'string' ? payload.indexRelativePath : null,
          regionsRelativePath: typeof payload?.regionsRelativePath === 'string' ? payload.regionsRelativePath : null,
        });
        return true;
      }
      if (status === 'missing-file' || status === 'error') {
        setStatus(status === 'missing-file' ? 'missing-file' : 'error');
        setMessage((typeof payload?.message === 'string' && payload.message) || fallback);
        return true;
      }
      return false;
    };

    const describe = (payload: Record<string, unknown> | null) => {
      const elapsed = typeof payload?.elapsedMs === 'number' ? Math.round(payload.elapsedMs / 1000) : 0;
      const bytes = typeof payload?.archiveBytes === 'number' ? payload.archiveBytes : null;
      const size = bytes ? `${(bytes / 1024 ** 3).toFixed(1)} GB ` : '';
      const mins = Math.floor(elapsed / 60);
      const secs = String(elapsed % 60).padStart(2, '0');
      return `Extracting ${size}archive… ${mins}:${secs} elapsed`;
    };

    const poll = async () => {
      if (isCancelled) return;
      try {
        const response = await apiFetch(`/api/antismash/${runId}/extract`);
        const payload = await response.json().catch(() => null);
        if (isCancelled) return;
        if (applyTerminal(payload, 'Failed to extract archive.')) return;
        setMessage(describe(payload));
      } catch {
        // a failed poll is not a failed extraction — keep waiting
      }
      if (!isCancelled) {
        timer = setTimeout(poll, POLL_MS);
      }
    };

    const extract = async () => {
      setStatus('extracting');
      setMessage('Extracting archive…');

      try {
        const response = await apiFetch(`/api/antismash/${runId}/extract`, { method: 'POST' });
        const payload = await response.json().catch(() => null);
        if (isCancelled) return;
        if (applyTerminal(payload, 'Failed to extract archive.')) return;
        setMessage(describe(payload));
        timer = setTimeout(poll, POLL_MS);
      } catch (error) {
        if (isCancelled) return;
        setStatus('error');
        setMessage(error instanceof Error ? error.message : 'Unexpected error during extraction.');
      }
    };

    extract();

    return () => {
      isCancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [runId, hasArchive, initialStatus, initialIndexRelativePath, initialRegionsRelativePath, onReady]);

  let icon = null;
  let toneClass = 'text-muted-foreground';

  if (status === 'extracting' || status === 'idle') {
    icon = <Loader2 className="h-4 w-4 animate-spin" />;
  } else if (status === 'ready') {
    icon = <CheckCircle2 className="h-4 w-4 text-emerald-500" />;
    toneClass = 'text-emerald-600';
  } else {
    icon = <AlertTriangle className="h-4 w-4 text-amber-500" />;
    toneClass = 'text-amber-600';
  }

  return (
    <div className="rounded-lg border border-border bg-muted/30 p-4 text-sm">
      <div className="flex items-center gap-2">
        {icon}
        <span className={toneClass}>
          {message ||
            (status === 'extracting'
              ? 'Extracting archive...'
              : status === 'ready'
                ? 'Archive extracted.'
                : 'Checking archive status...')}
        </span>
      </div>
    </div>
  );
}
