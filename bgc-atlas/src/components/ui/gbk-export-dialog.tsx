'use client';

import { useState, type ReactNode } from 'react';
import { Clock, Download, Loader2 } from 'lucide-react';
import { withBase } from '@/lib/basePath';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';

interface GbkExportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description: ReactNode;
  /** Creates the export job; resolves to its id, throws with the message to show. */
  createJob: (email: string | undefined) => Promise<string>;
}

/**
 * Confirms a GBK export and opens its job page, /exports/<id>, in a new tab --
 * an export can run for an hour, so it must not hold the page it started from.
 *
 * A dialog, not window.prompt: a popup is only allowed for a few seconds after a
 * click, and the time spent in a prompt counts against it, so a window.open after
 * the prompt closed was blocked and the job page replaced the current one.
 */
export function GbkExportDialog({ open, onOpenChange, title, description, createJob }: GbkExportDialogProps) {
  const [email, setEmail] = useState('');
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleOpenChange = (next: boolean) => {
    if (!next) setError(null);
    onOpenChange(next);
  };

  const start = async () => {
    if (starting) return;
    setError(null);
    // Opened here, inside the click, before any await: once the request resolves it
    // is no longer a user gesture, and popup blockers stop a window.open then. It
    // shows a 'Starting your export' page until the job exists, never about:blank.
    const tab = window.open(withBase('/exports/starting'), '_blank');
    setStarting(true);
    try {
      const id = await createJob(email.trim() || undefined);
      window.dispatchEvent(new Event('bgc-jobs-updated'));
      handleOpenChange(false);
      const href = withBase(`/exports/${id}`);
      if (tab) {
        tab.opener = null;
        tab.location.href = href;
      } else {
        // Popup blocked anyway; the job is under Recent Jobs, so Back loses nothing.
        window.location.href = href;
      }
    } catch (e) {
      tab?.close();
      setError(e instanceof Error ? e.message : 'Failed to start GBK export');
    } finally {
      setStarting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="flex gap-2.5 rounded-md border border-warning/30 bg-warning/5 p-3 text-sm">
          <Clock className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden />
          <p>
            <span className="font-medium">Large exports can take up to an hour.</span>{' '}
            <span className="text-muted-foreground">
              The job page opens in a new tab and the export keeps running if you close it.
              It stays under Recent Jobs; leave an email to be told when it&apos;s ready.
            </span>
          </p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="gbk-email" className="text-xs">Email (optional)</Label>
          <Input id="gbk-email" type="email" placeholder="you@example.com"
            value={email} onChange={(e) => setEmail(e.target.value)} className="h-9" />
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="outline" onClick={() => handleOpenChange(false)}>Cancel</Button>
          <Button onClick={() => void start()} disabled={starting}>
            {starting
              ? <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              : <Download className="mr-2 h-4 w-4" />}
            Start export
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
