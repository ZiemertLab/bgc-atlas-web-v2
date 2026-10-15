'use client';

import { apiFetch, withBase } from "@/lib/basePath";
import { storeJob } from '@/lib/utils/job-cookies';
import Link from 'next/link';
import { useState } from 'react';
import { Download, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from '@/lib/hooks/use-toast';
import { GCF_GBK_EXPORT_MAX_MEMBERS } from '@/lib/gcf/export-limits';

interface ExportGbkButtonProps {
  gcfId: string;
  gcfName: string;
  memberCount?: number;
}

export function ExportGbkButton({ gcfId, gcfName, memberCount }: ExportGbkButtonProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);

  // The server enforces the cap on primary members; this only saves a round trip.
  if (memberCount !== undefined && memberCount > GCF_GBK_EXPORT_MAX_MEMBERS) {
    return (
      <span className="text-sm text-muted-foreground">
        GenBank export is limited to families of {GCF_GBK_EXPORT_MAX_MEMBERS.toLocaleString()} BGCs;
        {' '}use the region archives on{' '}
        <Link href="/downloads" className="underline underline-offset-2 hover:text-foreground">
          Downloads
        </Link>
        .
      </span>
    );
  }

  const handleClick = async () => {
    if (isSubmitting) return;

    const email = window.prompt(
      `Export the GBK files of every BGC in ${gcfName}?\n\n`
        + `Large exports can take up to an hour. The job page opens in a new tab, and the `
        + `export keeps running if you close it.\n\n`
        + `Optionally enter your email to be notified when it's ready (or leave blank):`
    );

    if (email === null) return;

    // Opened before any await, while the click still counts as a user gesture,
    // or popup blockers stop it.
    const tab = window.open(withBase('/exports/starting'), '_blank');
    setIsSubmitting(true);

    try {
      const response = await apiFetch(`/api/gcfs/${gcfId}/export-gbk`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email: email.trim() || undefined }),
      });

      const data = await response.json();

      if (!data.success) {
        throw new Error(data.error || 'Failed to create export job');
      }

      storeJob(String(data.exportJobId), 'export', `GBK export · ${gcfName}`);
      const href = withBase(`/exports/${data.exportJobId}`);
      if (tab) {
        tab.opener = null;
        tab.location.href = href;
      } else {
        window.location.href = href;
      }
      setIsSubmitting(false);
    } catch (error) {
      tab?.close();
      const message = error instanceof Error ? error.message : 'Unknown error.';
      toast({
        variant: 'destructive',
        title: 'Export failed',
        description: message,
      });
      setIsSubmitting(false);
    }
  };

  return (
    <Button
      onClick={handleClick}
      variant="outline"
      className="gap-2"
      disabled={isSubmitting}
    >
      {isSubmitting ? (
        <>
          <Loader2 className="h-4 w-4 animate-spin" />
          Creating Export...
        </>
      ) : (
        <>
          <Download className="h-4 w-4" />
          Download GBK Files
        </>
      )}
    </Button>
  );
}
