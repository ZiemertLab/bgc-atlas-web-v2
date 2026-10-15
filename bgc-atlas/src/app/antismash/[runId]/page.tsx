import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { MainLayout } from '@/components/layout/main-layout';
import { getAntismashRun } from '@/lib/api/antismash';
import { AntismashRunClient } from './antismash-run-client';

export const dynamic = 'force-dynamic';

interface AntiSmashRunPageProps {
  params: Promise<{
    runId: string;
  }>;
  searchParams?: Promise<{
    anchor?: string;
  }>;
}

// Not indexed: each visit triggers an on-demand extraction.
const robots = { index: false, follow: true } as const;

export async function generateMetadata({ params }: AntiSmashRunPageProps): Promise<Metadata> {
  const { runId } = await params;
  const run = await getAntismashRun(runId).catch(() => null);
  if (!run) {
    return { title: 'antiSMASH run', robots };
  }
  const name = run.name ?? run.id;
  const assemblyName = run.assembly?.external_id ?? run.assembly?.name ?? null;
  return {
    robots,
    title: `antiSMASH: ${name}`,
    description: assemblyName
      ? `antiSMASH results for ${name} (assembly ${assemblyName}) — ${run.num_bgcs ?? 0} BGCs detected.`
      : `antiSMASH results for ${name} — ${run.num_bgcs ?? 0} BGCs detected.`,
  };
}

export default async function AntiSmashRunPage({ params, searchParams }: AntiSmashRunPageProps) {
  const [{ runId }, resolvedSearchParams] = await Promise.all([
    params,
    searchParams ?? Promise.resolve({} as { anchor?: string }),
  ]);
  const run = await getAntismashRun(runId);

  if (!run) {
    notFound();
  }

  return (
    <MainLayout>
      <div className="flex w-full flex-col gap-6 py-10">
        <AntismashRunClient run={run} initialAnchor={resolvedSearchParams?.anchor ?? null} />
      </div>
    </MainLayout>
  );
}
