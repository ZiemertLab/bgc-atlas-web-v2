import { NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';

import prisma from '@/lib/prisma';
import { serverError } from '@/lib/api/errors';

// bgcs_in_study for up to MAX_IDS families within one study: a property of the
// (study, GCF) pair, so it can't sit on the GCF documents /api/gcfs serves.

const MAX_IDS = 200;

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const studyKey = params.get('study')?.trim();
  const ids = (params.get('gcfs') ?? '').split(',').map((s) => s.trim()).filter(Boolean);

  if (!studyKey || ids.length === 0) {
    return NextResponse.json({ success: true, data: { counts: {} } });
  }
  if (ids.length > MAX_IDS) {
    return NextResponse.json(
      { success: false, error: `At most ${MAX_IDS} gcf ids` },
      { status: 400 },
    );
  }

  try {
    const idList = Prisma.join(ids.map((i) => Prisma.sql`${i}::uuid`));
    const rows = await prisma.$queryRaw<{ gcf_id: string; bgcs_in_study: number }[]>(Prisma.sql`
      SELECT gcf_id::text AS gcf_id, bgcs_in_study
      FROM study_gcf
      WHERE study_key = ${studyKey} AND gcf_id IN (${idList})
    `);
    const counts = Object.fromEntries(rows.map((r) => [r.gcf_id, r.bgcs_in_study]));
    return NextResponse.json({ success: true, data: { counts } });
  } catch (error) {
    return serverError(error, 'Failed to load study GCF counts');
  }
}
