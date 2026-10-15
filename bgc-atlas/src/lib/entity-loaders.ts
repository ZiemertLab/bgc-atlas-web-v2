import { cache } from 'react';
import { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import { PREVIOUS_CLUSTERING_ORDER, canonicalGcfName } from '@/lib/clustering';

// Shared by generateMetadata, JSON-LD and the social card (deduped by React's cache()). "missing"
// and "error" stay distinct: only a missing entity is noindexed, never a database blip.

export const isValidUuid = (id: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);

export const plural = (n: number, one: string, many: string) =>
  `${n.toLocaleString()} ${n === 1 ? one : many}`;

export type LoadResult<T> =
  | { status: 'ok'; row: T }
  | { status: 'missing' }
  | { status: 'error' };

export interface GcfRow {
  name: string | null;
  member_bgc_count: number;
  pet_name: string | null;
  description: string | null;
  cluster_method: string | null;
  unique_taxa_count: number | null;
  product_categories: string[] | null;
}

export const loadGcf = cache(async (id: string): Promise<LoadResult<GcfRow>> => {
  if (!isValidUuid(id)) return { status: 'missing' };
  try {
    // The materialized view (`gcf_name`), not the live `gcf_summary` view (`name`), which costs
    // ~1 s per request on the largest family. pet_name rides the join from gcfs.
    const rows = await prisma.$queryRaw<
      Array<{
        name: string | null;
        member_bgc_count: number | string | bigint;
        pet_name: string | null;
        description: string | null;
        cluster_method: string | null;
        unique_taxa_count: number | string | bigint | null;
        product_categories: string[] | null;
      }>
    >(Prisma.sql`
      SELECT m.gcf_name AS name, m.member_bgc_count, g.pet_name,
             m.description, m.cluster_method, m.unique_taxa_count, m.product_categories
      FROM gcf_summary_mv m
      JOIN gcfs g ON g.id = m.gcf_id
      WHERE m.gcf_id = ${id}::uuid
      LIMIT 1
    `);
    const row = rows[0];
    if (!row) return { status: 'missing' };
    return {
      status: 'ok',
      row: {
        name: row.name,
        pet_name: row.pet_name,
        // Postgres count() arrives as a BigInt, which JSON.stringify refuses.
        member_bgc_count: Number(row.member_bgc_count),
        description: row.description,
        cluster_method: row.cluster_method,
        unique_taxa_count:
          row.unique_taxa_count === null ? null : Number(row.unique_taxa_count),
        product_categories: row.product_categories,
      },
    };
  } catch (error) {
    console.error('GCF lookup failed', error);
    return { status: 'error' };
  }
});

/**
 * A family's page lives at /gcfs/<uuid>, but its name or pet name is what people
 * cite and type. Resolves either to a uuid so the route can redirect there; null
 * when nothing matches. In order:
 *
 *   1. a current family's name (GCF-v2b6-000001, however it was typed: see
 *      canonicalGcfName)
 *   2. a current family's pet name (stored lower-case, so folded)
 *   3. a replaced clustering's family name (GCF-000001, GCF-v2b2-F-400042) --
 *      its uuid shows where the members went (gcf-legacy.ts)
 *   4. a replaced family's pet name, newest replaced clustering first
 *
 * A re-clustering reuses pet names (the alias space is smaller than two
 * clusterings). The current family wins (2 before 4) because it is the one the
 * site shows under that name today, then the newest replaced clustering (user
 * decision 2026-10-12); the /gcfs search still points a reader typing an old
 * alias at its old family. Every lookup is an indexed equality.
 */
export const resolveGcfId = cache(async (id: string): Promise<string | null> => {
  if (isValidUuid(id)) return id;
  const pet = id.toLowerCase();
  const name = canonicalGcfName(id) ?? id;
  try {
    const rows = await prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT id FROM (
        SELECT id::text AS id, 1 AS rank, 0 AS age FROM gcfs WHERE name = ${name}
        UNION ALL
        SELECT id::text, 2, 0 FROM gcfs WHERE pet_name = ${pet}
        UNION ALL
        SELECT gcf_id::text, 3, 0 FROM gcf_legacy WHERE name = ${name}
        UNION ALL
        SELECT gcf_id::text, 4, array_position(ARRAY[${Prisma.join(PREVIOUS_CLUSTERING_ORDER)}]::text[], clustering)
        FROM gcf_legacy WHERE pet_name = ${pet}
      ) found
      ORDER BY rank, age NULLS LAST
      LIMIT 1
    `);
    return rows[0]?.id ?? null;
  } catch (error) {
    console.error('GCF name lookup failed', error);
    return null;
  }
});

export const gcfName = (row: GcfRow, id: string) => row.name ?? `GCF_${id.slice(0, 8)}`;

export const gcfDescription = (row: GcfRow, id: string) =>
  `${gcfName(row, id)}${row.pet_name ? ` (alias ${row.pet_name})` : ''}: gene cluster ` +
  `family with ${plural(row.member_bgc_count, 'member BGC', 'member BGCs')} across the BGC Atlas dataset.`;

export const gcfStructuredDescription = (row: GcfRow, id: string) =>
  [
    row.description ??
      `${gcfName(row, id)}: gene cluster family containing ${plural(row.member_bgc_count, 'BGC', 'BGCs')}.`,
    row.cluster_method ? `Clustered with ${row.cluster_method}.` : null,
    row.unique_taxa_count
      ? `Spans ${plural(row.unique_taxa_count, 'unique taxon', 'unique taxa')}.`
      : null,
  ]
    .filter(Boolean)
    .join(' ');

export interface BgcRow {
  contig: string | null;
  product: string[] | null;
  start_pos: number;
  end_pos: number;
}

export const loadBgc = cache(async (id: string): Promise<LoadResult<BgcRow>> => {
  if (!isValidUuid(id)) return { status: 'missing' };
  try {
    // One primary-key row per page render is fine; one bgcs lookup per list result is not.
    const rows = await prisma.$queryRaw<BgcRow[]>(Prisma.sql`
      SELECT contig, product, start_pos, end_pos
      FROM bgcs WHERE id = ${id}::uuid LIMIT 1
    `);
    const row = rows[0];
    return row ? { status: 'ok', row } : { status: 'missing' };
  } catch (error) {
    console.error('BGC lookup failed', error);
    return { status: 'error' };
  }
});

export const bgcProducts = (row: BgcRow) => (row.product ?? []).filter(Boolean);

// Leads with what distinguishes one BGC from another rather than the uuid.
export const bgcLabel = (row: BgcRow) => {
  const types = bgcProducts(row);
  return types.length ? types.slice(0, 2).join(', ') : 'BGC';
};

export const bgcKb = (row: BgcRow) => Math.round((row.end_pos - row.start_pos) / 100) / 10;

export const bgcDescription = (row: BgcRow) =>
  `${bgcLabel(row)} biosynthetic gene cluster${row.contig ? ` on contig ${row.contig}` : ''}, ` +
  `${bgcKb(row).toLocaleString()} kb, in the BGC Atlas.`;

export interface StudyRow {
  title: string | null;
  study_name: string | null;
  study_key: string;
  sample_count: number;
  total_bgcs: number;
  abstract: string | null;
  abstract_source: string | null;
  abstract_license: string | null;
}

export const loadStudy = cache(async (id: string): Promise<LoadResult<StudyRow>> => {
  if (!isValidUuid(id)) return { status: 'missing' };
  try {
    // Resolves the physical studies.id to its logical summary row; the abstract columns let callers
    // apply the UI's licence gate.
    const rows = await prisma.$queryRaw<StudyRow[]>(Prisma.sql`
      SELECT sbs.title, sbs.study_name, sbs.study_key,
             sbs.sample_count, sbs.total_bgcs::int AS total_bgcs,
             st.abstract, st.abstract_source, st.abstract_license
      FROM studies st
      JOIN study_bgc_summary sbs
        ON sbs.study_key = COALESCE(NULLIF(st.study_name, ''), st.accession, st.id::text)
      WHERE st.id = ${id}::uuid
      LIMIT 1
    `);
    const row = rows[0];
    return row ? { status: 'ok', row } : { status: 'missing' };
  } catch (error) {
    // Logged: a swallowed error would quietly fall back to a generic title.
    console.error('Study lookup failed', error);
    return { status: 'error' };
  }
});

export const studyName = (row: StudyRow) => row.title || row.study_name || row.study_key;

export const studySummary = (row: StudyRow) =>
  `${studyName(row)}: ${plural(row.sample_count, 'sample', 'samples')} and ` +
  `${plural(row.total_bgcs, 'biosynthetic gene cluster', 'biosynthetic gene clusters')} in the BGC Atlas.`;
