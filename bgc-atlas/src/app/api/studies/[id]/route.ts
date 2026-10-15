import { NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';

import prisma from '@/lib/prisma';
import { abstractState } from '@/lib/abstract-license';
import { getOrSetCache } from '@/lib/cache';
import { doiUrl } from '@/lib/utils/accession';
import { serverError } from '@/lib/api/errors';

// Per-study detail from the precomputed study_bgc_summary plus small live
// metadata for one logical study. ?brief=1 serves the /studies row expander
// (abstract and GCF names only). Samples are paged via /api/samples?studyKey=.

const MAP_CAP = 2000;

type SummaryRow = {
  study_key: string; study_id: string; title: string | null; study_name: string | null;
  center_name: string | null; accession: string | null; bioproject: string | null; study_type: string | null;
  sample_count: number; total_bgcs: number; clustered_bgcs: number; gcf_coverage: number | null;
  distinct_gcfs: number; exclusive_gcfs: number; rare_gcfs: number; pct_complete: number | null;
  product_type_count: number; product_category_dist: Record<string, number> | null;
  top_exclusive_gcfs: { gcf_id: string; bgcs_in_study: number }[] | null;
  primary_biome: string | null; gold_bucket: string | null;
};

type TopGcf = { gcf_id: string; bgcs_in_study: number };

type SiblingRow = {
  id: string; accession: string | null; bioproject: string | null; abstract: string | null;
  abstract_source: string | null; abstract_doi: string | null; abstract_license: string | null;
  abstract_publisher: string | null; abstract_withheld: boolean; doi: string | null; pmid: string | null;
};

function fetchSiblings(studyKey: string) {
  return prisma.$queryRaw<SiblingRow[]>(Prisma.sql`
    SELECT id::text AS id, accession, bioproject, abstract,
           abstract_source, abstract_doi, abstract_license, abstract_publisher,
           abstract_withheld, metadata->>'doi' AS doi, metadata->>'pmid' AS pmid
    FROM studies
    WHERE COALESCE(NULLIF(study_name, ''), accession, id::text) = ${studyKey}
  `);
}

// metalog joins several papers per study with commas/semicolons.
function splitIds(value: string | null): string[] {
  if (!value) return [];
  return [...new Set(value.split(/[,;]/).map((p) => p.trim()).filter(Boolean))];
}

function collapseSiblings(siblings: SiblingRow[], fallback: { accession: string | null; bioproject: string | null }) {
  const accessions = [...new Set(siblings.map((s) => s.accession).filter(Boolean))] as string[];
  const bioprojects = [...new Set(siblings.map((s) => s.bioproject).filter(Boolean))] as string[];

  // Provenance must come from the same row as the text (siblings can cite
  // different papers); fall back to a withheld row to keep the publisher link.
  const source = siblings.find((s) => s.abstract) ?? siblings.find((s) => s.abstract_withheld) ?? null;
  const doi = source?.abstract_doi ?? null;

  return {
    abstract: source?.abstract ?? null,
    abstract_source: source?.abstract_source ?? null,
    abstract_doi: doi,
    // Where the abstract may be read; a withheld one especially needs it.
    abstract_url: doi ? doiUrl(doi) : null,
    abstract_license: source?.abstract_license ?? null,
    abstract_publisher: source?.abstract_publisher ?? null,
    abstract_withheld: source?.abstract_withheld ?? false,
    // Distinguishes "no abstract" from "withheld by licence" (see lib/abstract-license.ts).
    abstract_state: abstractState({
      hasAbstract: !!source?.abstract,
      withheld: !!source?.abstract_withheld,
    }),
    dois: [...new Set(siblings.flatMap((s) => splitIds(s.doi)))],
    pmids: [...new Set(siblings.flatMap((s) => splitIds(s.pmid)))],
    accessions: accessions.length ? accessions : fallback.accession ? [fallback.accession] : [],
    bioprojects: bioprojects.length ? bioprojects : fallback.bioproject ? [fallback.bioproject] : [],
  };
}

async function withGcfNames(topExclusive: TopGcf[] | null) {
  const top = Array.isArray(topExclusive) ? topExclusive : [];
  if (!top.length) return [];
  const gcfIdList = Prisma.join(top.map((g) => Prisma.sql`${g.gcf_id}::uuid`));
  // pet_name + dom_category ride on the same bounded PK lookup (<=20 ids).
  const gcfRows = await prisma.$queryRaw<
    { id: string; name: string | null; pet_name: string | null; dom_category: string | null }[]
  >(Prisma.sql`
    SELECT id::text AS id, name, pet_name, dom_category FROM gcfs WHERE id IN (${gcfIdList})
  `);
  const byId = Object.fromEntries(gcfRows.map((r) => [r.id, r]));
  return top.map((g) => ({
    ...g,
    name: byId[g.gcf_id]?.name ?? null,
    pet_name: byId[g.gcf_id]?.pet_name ?? null,
    dom_category: byId[g.gcf_id]?.dom_category ?? null,
  }));
}

export async function GET(request: Request, context: { params: Promise<{ id?: string }> }) {
  const { id } = (await context.params) ?? {};
  if (!id) {
    return NextResponse.json({ success: false, error: 'Missing study id' }, { status: 400 });
  }

  const brief = ['1', 'true'].includes(
    (new URL(request.url).searchParams.get('brief') ?? '').toLowerCase()
  );

  const fetchBrief = async () => {
    const summaryRows = await prisma.$queryRaw<
      { study_key: string; accession: string | null; bioproject: string | null; top_exclusive_gcfs: TopGcf[] | null }[]
    >(Prisma.sql`
      SELECT sbs.study_key, sbs.accession, sbs.bioproject, sbs.top_exclusive_gcfs
      FROM studies st
      JOIN study_bgc_summary sbs
        ON sbs.study_key = COALESCE(NULLIF(st.study_name, ''), st.accession, st.id::text)
      WHERE st.id = ${id}::uuid
      LIMIT 1
    `);
    const summary = summaryRows?.[0];
    if (!summary) return null;

    const [siblings, topExclusive] = await Promise.all([
      fetchSiblings(summary.study_key),
      withGcfNames(summary.top_exclusive_gcfs),
    ]);

    return {
      study: { study_key: summary.study_key, ...collapseSiblings(siblings, summary) },
      top_exclusive_gcfs: topExclusive,
    };
  };

  const fetchDetail = async () => {
    const summaryRows = await prisma.$queryRaw<SummaryRow[]>(Prisma.sql`
      SELECT sbs.study_key, sbs.study_id, sbs.title, sbs.study_name, sbs.center_name,
             sbs.accession, sbs.bioproject, sbs.study_type, sbs.sample_count,
             sbs.total_bgcs::int AS total_bgcs, sbs.clustered_bgcs::int AS clustered_bgcs,
             sbs.gcf_coverage, sbs.distinct_gcfs::int AS distinct_gcfs,
             sbs.exclusive_gcfs::int AS exclusive_gcfs, sbs.rare_gcfs::int AS rare_gcfs,
             sbs.pct_complete, sbs.product_type_count, sbs.product_category_dist,
             sbs.top_exclusive_gcfs, sbs.primary_biome, sbs.gold_bucket
      FROM studies st
      JOIN study_bgc_summary sbs
        ON sbs.study_key = COALESCE(NULLIF(st.study_name, ''), st.accession, st.id::text)
      WHERE st.id = ${id}::uuid
      LIMIT 1
    `);
    const summary = summaryRows?.[0];
    if (!summary) return null;

    const siblings = await fetchSiblings(summary.study_key);
    const collapsed = collapseSiblings(siblings, summary);
    const idList = Prisma.join(siblings.map((s) => Prisma.sql`${s.id}::uuid`));

    // Counts DISTINCT parent_key: a MAG catalogue has one row per genome bin.
    // Bounds skip coordinates the source flags unreliable (one bad point can
    // drag the map's auto-fit thousands of km).
    const aggRows = await prisma.$queryRaw<
      { total: number; unit_count: number; geo_tagged: number; south: number | null; north: number | null; west: number | null; east: number | null }[]
    >(Prisma.sql`
      SELECT COUNT(DISTINCT pk.parent_key)::int AS total,
             COUNT(DISTINCT sm.id)::int AS unit_count,
             COUNT(DISTINCT pk.parent_key) FILTER (WHERE sm.latitude IS NOT NULL AND sm.longitude IS NOT NULL)::int AS geo_tagged,
             MIN(sm.latitude) FILTER (WHERE sm.location_resolution IS DISTINCT FROM 'unreliable')::float8 AS south,
             MAX(sm.latitude) FILTER (WHERE sm.location_resolution IS DISTINCT FROM 'unreliable')::float8 AS north,
             MIN(sm.longitude) FILTER (WHERE sm.location_resolution IS DISTINCT FROM 'unreliable')::float8 AS west,
             MAX(sm.longitude) FILTER (WHERE sm.location_resolution IS DISTINCT FROM 'unreliable')::float8 AS east
      FROM study_samples sts
      JOIN samples sm ON sm.id = sts.sample_id
      JOIN sample_parent_key pk ON pk.sample_id = sm.id
      WHERE sts.study_id IN (${idList})
    `);
    const agg = aggRows?.[0];

    const envRows = await prisma.$queryRaw<{ biome: string | null; count: number }[]>(Prisma.sql`
      SELECT ssum.primary_biome AS biome, COUNT(DISTINCT pk.parent_key)::int AS count
      FROM study_samples sts
      JOIN samples sm ON sm.id = sts.sample_id
      JOIN sample_parent_key pk ON pk.sample_id = sm.id
      LEFT JOIN sample_summary ssum ON ssum.id = sm.id
      WHERE sts.study_id IN (${idList})
      GROUP BY ssum.primary_biome
      ORDER BY count DESC
      LIMIT 12
    `);

    const points = await prisma.$queryRaw<
      { id: string; external_id: string | null; name: string | null; latitude: number; longitude: number;
        primary_biome: string | null; gold_ecosystem_path: string | null; bgc_count: number | null }[]
    >(Prisma.sql`
      SELECT DISTINCT ON (pk.parent_key)
             sm.id::text AS id, sm.external_id, sm.name,
             sm.latitude::float8 AS latitude, sm.longitude::float8 AS longitude,
             ssum.primary_biome, ssum.gold_ecosystem_path, ssum.bgc_count::int AS bgc_count
      FROM study_samples sts
      JOIN samples sm ON sm.id = sts.sample_id
      JOIN sample_parent_key pk ON pk.sample_id = sm.id
      LEFT JOIN sample_summary ssum ON ssum.id = sm.id
      WHERE sts.study_id IN (${idList})
        AND sm.latitude IS NOT NULL AND sm.longitude IS NOT NULL
        AND sm.location_resolution IS DISTINCT FROM 'unreliable'
      -- One pin per physical sample (MAG bins collapse); ORDER BY also makes the
      -- capped subset deterministic.
      ORDER BY pk.parent_key, ssum.bgc_count DESC NULLS LAST
      LIMIT ${MAP_CAP}
    `);

    const topExclusive = await withGcfNames(summary.top_exclusive_gcfs);

    return {
      study: {
        study_key: summary.study_key,
        study_id: summary.study_id,
        title: summary.title,
        study_name: summary.study_name,
        center_name: summary.center_name,
        study_type: summary.study_type,
        ...collapsed,
        primary_biome: summary.primary_biome,
        gold_bucket: summary.gold_bucket,
      },
      metrics: {
        total_bgcs: summary.total_bgcs,
        clustered_bgcs: summary.clustered_bgcs,
        gcf_coverage: summary.gcf_coverage,
        distinct_gcfs: summary.distinct_gcfs,
        exclusive_gcfs: summary.exclusive_gcfs,
        rare_gcfs: summary.rare_gcfs,
        pct_complete: summary.pct_complete,
        product_type_count: summary.product_type_count,
        sample_count: summary.sample_count,
        product_category_dist: summary.product_category_dist,
      },
      top_exclusive_gcfs: topExclusive,
      geography: {
        total: agg?.total ?? 0,
        // one per genome bin for a MAG catalogue
        unit_count: agg?.unit_count ?? 0,
        geo_tagged: agg?.geo_tagged ?? 0,
        bounds: agg && agg.geo_tagged > 0 ? { north: agg.north, south: agg.south, east: agg.east, west: agg.west } : null,
        points,
      },
      environment_distribution: envRows,
    };
  };

  try {
    // Versioned: older entries lack abstract_state/abstract_url.
    const data = brief
      ? await getOrSetCache(`studies:brief:v2:${id}`, fetchBrief, 300)
      : await getOrSetCache(`studies:detail:v2:${id}`, fetchDetail, 300);
    if (!data) {
      return NextResponse.json({ success: false, error: 'Study not found' }, { status: 404 });
    }
    return NextResponse.json({ success: true, data });
  } catch (error) {
    return serverError(error, 'Failed to load study detail');
  }
}
