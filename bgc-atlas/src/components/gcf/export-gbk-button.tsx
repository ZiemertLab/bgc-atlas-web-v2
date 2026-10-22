'use client';

import { apiFetch } from "@/lib/basePath";
import { storeJob } from '@/lib/utils/job-cookies';
import Link from 'next/link';
import { useState } from 'react';
import { Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { GbkExportDialog } from '@/components/ui/gbk-export-dialog';
import { GCF_GBK_EXPORT_MAX_MEMBERS } from '@/lib/gcf/export-limits';

interface ExportGbkButtonProps {
  gcfId: string;
  gcfName: string;
  memberCount?: number;
}

export function ExportGbkButton({ gcfId, gcfName, memberCount }: ExportGbkButtonProps) {
  const [open, setOpen] = useState(false);

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

  const createJob = async (email: string | undefined): Promise<string> => {
    const response = await apiFetch(`/api/gcfs/${gcfId}/export-gbk`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ email }),
    });

    const data = await response.json();

    if (!data.success) {
      throw new Error(data.error || 'Failed to create export job');
    }

    storeJob(String(data.exportJobId), 'export', `GBK export · ${gcfName}`);
    return String(data.exportJobId);
  };

  return (
    <>
      <Button onClick={() => setOpen(true)} variant="outline" className="gap-2">
        <Download className="h-4 w-4" />
        Download GBK Files
      </Button>
      <GbkExportDialog
        open={open}
        onOpenChange={setOpen}
        title="Download GBK files"
        description={<>Packages the GenBank (.gbk) files of every BGC in {gcfName} into a zip.</>}
        createJob={createJob}
      />
    </>
  );
}
