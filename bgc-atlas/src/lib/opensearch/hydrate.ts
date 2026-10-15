// Hydrate display-only related fields (sample, GCF names) from Postgres for the ~25
// rows on the current page, rather than re-indexing 16.5M docs.
import { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';

export interface HydratedFields {
  sample_id: string | null;
  sample_name: string | null;
  gcf_name: string | null;
}

export async function hydrateDisplayFields(
  bgcIds: string[],
): Promise<Record<string, HydratedFields>> {
  const ids = bgcIds.filter(Boolean);
  if (!ids.length) return {};
  const rows = await prisma.$queryRaw<
    Array<{ bgc_id: string; sample_id: string | null; sample_name: string | null; gcf_name: string | null }>
  >(Prisma.sql`
    SELECT DISTINCT ON (b.id)
      b.id::text        AS bgc_id,
      s.id::text        AS sample_id,
      COALESCE(s.name, s.external_id) AS sample_name,
      g.name            AS gcf_name
    FROM bgcs b
    -- v3: a BGC can be in several families; is_primary keeps this to one row per
    -- BGC. Without it the hydrate fans out and the caller silently gets duplicates.
    -- pin to the primary 0.4 resolution for one family name per BGC.
    LEFT JOIN bgc_gcf bgf         ON bgf.bgc_id = b.id AND bgf.is_primary
    LEFT JOIN gcfs g              ON g.id = bgf.gcf_id
    LEFT JOIN assemblies a        ON b.assembly = a.id
    LEFT JOIN sample_assemblies sa ON sa.assembly_id = a.id
    LEFT JOIN samples s           ON sa.sample_id = s.id
    WHERE b.id = ANY(${ids}::uuid[])
    ORDER BY b.id
  `);
  const out: Record<string, HydratedFields> = {};
  for (const r of rows) {
    out[r.bgc_id] = { sample_id: r.sample_id, sample_name: r.sample_name, gcf_name: r.gcf_name };
  }
  return out;
}

// GCF ids -> gcfs.name, for labelling the gcf_id distribution chart.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export async function hydrateGcfNames(ids: string[]): Promise<Record<string, string>> {
  const clean = ids.filter((id) => UUID_RE.test(id)); // guard the ::uuid[] cast
  if (!clean.length) return {};
  const rows = await prisma.$queryRaw<Array<{ id: string; name: string | null }>>(Prisma.sql`
    SELECT id::text AS id, name FROM gcfs WHERE id = ANY(${clean}::uuid[])
  `);
  const out: Record<string, string> = {};
  for (const r of rows) if (r.name) out[r.id] = r.name;
  return out;
}
