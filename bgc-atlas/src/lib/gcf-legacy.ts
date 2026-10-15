import { Prisma } from '@prisma/client';

import prisma from '@/lib/prisma';
import { PREVIOUS_CLUSTERINGS, PREVIOUS_CLUSTERING_ORDER, canonicalGcfName } from '@/lib/clustering';

/**
 * Families of a clustering that has been replaced.
 *
 * A re-clustering replaces every family. The old ones leave `gcfs`, but their names and uuids are in bookmarks,
 * citations and other sites, so they resolve to a page that says where their members went instead of a 404:
 * `gcf_legacy` keeps the old family, `gcf_successor` the new families that share its primary members.
 *
 * Successors are the families of the NEXT clustering, which may since have been replaced in turn (an August
 * family's successors are v2b2 families, retired by the R2.0-beta.3 re-clustering): those are listed as retired,
 * and their own page goes one step further.
 */

export interface RetiredFamily {
  id: string;
  name: string;
  petName: string | null;
  familyClass: string | null;
  /** The old family's size when its clustering was replaced (primary members at the time). */
  memberCount: number;
  /** The data release the old clustering was last part of, and how to describe it. */
  release: string | null;
  clusteringLabel: string;
  successors: {
    id: string;
    name: string;
    petName: string | null;
    listed: boolean;
    /** From a clustering that has since been replaced as well: its page lists where the members are now. */
    retired: boolean;
    sharedBgcs: number;
    /** Of the old family's members still in the corpus. */
    shareOfOld: number;
  }[];
  /** How many new families share members with it (successors lists the largest few). */
  successorCount: number;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SUCCESSORS_SHOWN = 12;

/**
 * By uuid, name or pet name (case-insensitive). Null when it is not a replaced family. A pet name reused by
 * several replaced clusterings gives the newest one's family. Every branch is an indexed equality.
 */
export async function findRetiredFamily(key: string): Promise<RetiredFamily | null> {
  const trimmed = key.trim();
  if (!trimmed) return null;
  const canonical = canonicalGcfName(trimmed);
  const where = UUID_RE.test(trimmed)
    ? Prisma.sql`l.gcf_id = ${trimmed}::uuid`
    : canonical
      ? Prisma.sql`l.name = ${canonical}`
      : Prisma.sql`l.pet_name = ${trimmed.toLowerCase()}`;

  const rows = await prisma.$queryRaw<{
    gcf_id: string; name: string; pet_name: string | null; family_class: string | null;
    n_bgc: number; clustering: string;
  }[]>(Prisma.sql`
    SELECT l.gcf_id::text, l.name, l.pet_name, l.family_class, l.n_bgc, l.clustering
    FROM gcf_legacy l WHERE ${where}
    ORDER BY array_position(ARRAY[${Prisma.join(PREVIOUS_CLUSTERING_ORDER)}]::text[], l.clustering) NULLS LAST
    LIMIT 1`);
  const row = rows[0];
  if (!row) return null;

  const [successors, [{ n }]] = await Promise.all([
    prisma.$queryRaw<{
      id: string; name: string; pet_name: string | null; listed: boolean; retired: boolean; shared_bgcs: number;
      share_of_old: number;
    }[]>(Prisma.sql`
      SELECT s.new_gcf_id::text AS id, coalesce(g.name, r.name) AS name, coalesce(g.pet_name, r.pet_name) AS pet_name,
             coalesce(g.listed, r.listed) AS listed, g.id IS NULL AS retired, s.shared_bgcs, s.share_of_old
      FROM gcf_successor s
      LEFT JOIN gcfs g ON g.id = s.new_gcf_id
      LEFT JOIN gcf_legacy r ON r.gcf_id = s.new_gcf_id AND g.id IS NULL
      WHERE s.old_gcf_id = ${row.gcf_id}::uuid AND coalesce(g.id, r.gcf_id) IS NOT NULL
      ORDER BY s.shared_bgcs DESC, 2
      LIMIT ${SUCCESSORS_SHOWN}`),
    prisma.$queryRaw<{ n: number }[]>(Prisma.sql`
      SELECT count(*)::int AS n FROM gcf_successor WHERE old_gcf_id = ${row.gcf_id}::uuid`),
  ]);

  const previous = PREVIOUS_CLUSTERINGS[row.clustering];
  return {
    id: row.gcf_id,
    name: row.name,
    petName: row.pet_name,
    familyClass: row.family_class,
    memberCount: row.n_bgc,
    release: previous?.release ?? null,
    clusteringLabel: previous?.label ?? 'a previous clustering',
    successors: successors.map((s) => ({
      id: s.id,
      name: s.name,
      petName: s.pet_name,
      listed: s.listed,
      retired: s.retired,
      sharedBgcs: Number(s.shared_bgcs),
      shareOfOld: Number(s.share_of_old),
    })),
    successorCount: n,
  };
}
