import { notFound, redirect } from 'next/navigation';

import prisma from '@/lib/prisma';

export const dynamic = 'force-dynamic';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface Props {
  params: Promise<{ sampleId: string }>;
}

// A genome is one assembly with one antiSMASH run, so the genomes table links
// here instead of fetching the run id for every expanded row: the lookup
// (two index scans, < 1 ms) runs only when someone actually follows the link.
export default async function AntismashForSamplePage({ params }: Props) {
  const { sampleId } = await params;
  if (!UUID_RE.test(sampleId)) notFound();

  const rows = await prisma.$queryRaw<{ id: string }[]>`
    SELECT r.id::text AS id
      FROM sample_assemblies sa
      JOIN antismash_runs r ON r.assembly_id = sa.assembly_id
     WHERE sa.sample_id = ${sampleId}::uuid
     ORDER BY r.created_at DESC NULLS LAST
     LIMIT 1`;
  if (rows.length === 0) notFound();

  redirect(`/antismash/${rows[0].id}`);
}
