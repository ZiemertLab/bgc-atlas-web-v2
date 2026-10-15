import { NextResponse } from 'next/server';
import { findBgcRedirect, redirectToTwin } from '@/lib/bgc/redirect';
import { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import { getOrSetCache } from '@/lib/cache';
import { bgcMibigHomology } from '@/lib/opensearch/client';
import { stripSourcePrefixes } from '@/lib/utils/sample-id';
import { collapseConsecutiveLevels } from '@/lib/utils/metadata-parser';
import { serverError } from '@/lib/api/errors';

const isValidUuid = (id: string) => {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
};

// A cold row costs ~1-2s of random-read I/O. After a data reload, flush Redis `bgcs:detail:*`.
const DETAIL_CACHE_TTL_SECONDS = 60 * 60 * 24; // 1 day

interface RouteParams {
  params: Promise<{ id?: string }>;
}

type RawRow = {
  id: string;
  assembly: string;
  assembly_source_type: string | null;
  filename: string | null;
  product_category: string[] | null;
  product: string[] | null;
  is_complete: boolean;
  contig: string | null;
  start_pos: number;
  end_pos: number;
  num_cds_features: number | null;
  gcf_id: string | null;
  // lower = better
  distance: number | string | { toNumber?: () => number } | null;
  gcf_name: string | null;
  gcf_pet_name: string | null;
  gcf_family_class: string | null;
  length: number | string;
  antismash_run_id: string | null;
  anchor: string | null;
  resolved_biome_level_1: string | null;
  resolved_biome_level_2: string | null;
  resolved_biome_level_3: string | null;
  resolved_biome_level_4: string | null;
  environment_biome: string | null;
  environment_feature: string | null;
  environment_material: string | null;
  sample_ids: string[] | null;
  sample_labels: string[] | null;
  gold_ecosystem_path: string | null;
  gold_ecosystem_metadata: Record<string, unknown> | null;
  taxonomy_domain: string | null;
  taxonomy_phylum: string | null;
  taxonomy_class: string | null;
  taxonomy_order: string | null;
  taxonomy_family: string | null;
  taxonomy_genus: string | null;
  taxonomy_species: string | null;
  gtdb_lineage: string | null;
};

type AlsoInRow = {
  id: string;
  name: string | null;
  pet_name: string | null;
  family_class: string | null;
  listed: boolean;
  distance: number | string | { toNumber?: () => number } | null;
  rank: number | string;
};

// Prisma returns numerics as number | string | Decimal depending on the column.
const toNumberOrNull = (v: number | string | { toNumber?: () => number } | null | undefined): number | null => {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return Number.isNaN(v) ? null : v;
  if (typeof v === 'object' && 'toNumber' in v && typeof v.toNumber === 'function') return v.toNumber();
  const n = Number(v);
  return Number.isNaN(n) ? null : n;
};

export async function GET(request: Request, { params }: RouteParams) {
  try {
    const { id: bgcId } = await params;

    if (!bgcId || typeof bgcId !== 'string' || !isValidUuid(bgcId)) {
      return NextResponse.json(
        { success: false, error: 'Invalid BGC ID' },
        { status: 400 }
      );
    }

    // Bump the version whenever the payload shape changes: a stale entry still
    // deserialises and reads as a real (e.g. "no MIBiG hit") answer.
    const cacheKey = `bgcs:detail:v7:${bgcId}`;

    const payload = await getOrSetCache(cacheKey, async () => {
      const rows = await prisma.$queryRaw<RawRow[]>(Prisma.sql`
        SELECT
          b.id,
          b.assembly,
          a.source_type AS assembly_source_type,
          b.filename,
          b.product_category,
          b.product,
          b.is_complete,
          b.contig,
          b.start_pos,
          b.end_pos,
          b.num_cds_features,
          bg.gcf_id,
          bg.distance,
          g.name AS gcf_name,
          g.pet_name AS gcf_pet_name,
          g.family_class AS gcf_family_class,
          (b.end_pos - b.start_pos) AS length,
          b.antismash_run_id,
          b.anchor,
          bbs.resolved_biome_level_1,
          bbs.resolved_biome_level_2,
          bbs.resolved_biome_level_3,
          bbs.resolved_biome_level_4,
          bbs.environment_biome,
          bbs.environment_feature,
          bbs.environment_material,
          gs.gold_ecosystem_path,
          gs.gold_ecosystem_metadata,
          COALESCE(
            (SELECT array_agg(asam.sample_id::text)
             FROM unnest(asm.sample_ids) AS asam(sample_id)),
            ARRAY[]::text[]
          ) AS sample_ids,
          COALESCE(asm.sample_labels, ARRAY[]::text[]) AS sample_labels,
          t.domain AS taxonomy_domain,
          t.phylum AS taxonomy_phylum,
          t.class AS taxonomy_class,
          t.order_name AS taxonomy_order,
          t.family AS taxonomy_family,
          t.genus AS taxonomy_genus,
          t.species AS taxonomy_species,
          t.gtdb_lineage
        FROM bgcs b
        LEFT JOIN assemblies a ON a.id = b.assembly
        -- A BGC can be in several families; is_primary picks the displayed one
        -- and prevents the join fanning out.
        LEFT JOIN bgc_gcf bg ON bg.bgc_id = b.id AND bg.is_primary
        LEFT JOIN gcfs g ON g.id = bg.gcf_id
        LEFT JOIN bgc_biome_summary_mv bbs ON bbs.bgc_id = b.id
        LEFT JOIN assembly_samples_mv asm ON asm.assembly_id = b.assembly
        LEFT JOIN bgc_taxonomy bt ON bt.bgc_id = b.id
        LEFT JOIN taxonomies t ON t.id = bt.taxonomy_id
        LEFT JOIN LATERAL (
          SELECT
            sb.gold_ecosystem_path,
            sb.gold_ecosystem_metadata
          FROM sample_assemblies sa
          JOIN sample_summary sb ON sb.id = sa.sample_id
          WHERE sa.assembly_id = b.assembly
          LIMIT 1
        ) gs ON true
        WHERE b.id = ${bgcId}::uuid
        LIMIT 1
      `);

      const r = rows[0];
      if (!r) return { success: false as const, error: 'BGC not found', notFound: true as const };

      // ORDER BY rank (best bitscore), not distance: a secondary can be nearer
      // than the primary, since distance derives from percent identity.
      const alsoInFamilies = (await prisma.$queryRaw<AlsoInRow[]>(Prisma.sql`
        SELECT g.id, g.name, g.pet_name, g.family_class, g.listed, bg.distance, bg.rank
        FROM bgc_gcf bg
        JOIN gcfs g ON g.id = bg.gcf_id
        WHERE bg.bgc_id = ${bgcId}::uuid AND NOT bg.is_primary
        ORDER BY bg.rank
      `)).map((f) => ({
        id: f.id,
        name: f.name,
        petName: f.pet_name,
        familyClass: f.family_class,
        listed: f.listed,
        rank: Number(f.rank),
        distance: toNumberOrNull(f.distance),
      }));

      const product_category: string[] = Array.isArray(r.product_category) ? r.product_category : [];
      const product: string[] = Array.isArray(r.product) ? r.product : [];

      let category: string | null = null;
      let categories: string[] = [];
      if (product_category.length > 1) {
        category = 'Hybrid';
        categories = product_category;
      } else if (product_category.length === 1) {
        category = product_category[0];
        categories = product_category;
      }

      const distanceRaw = typeof r.distance === 'number'
        ? r.distance
        : (typeof r.distance === 'object' && r.distance !== null && 'toNumber' in r.distance
          ? (r.distance as { toNumber: () => number }).toNumber()
          : Number(r.distance));
      const distance = r.distance === null || r.distance === undefined || Number.isNaN(distanceRaw)
        ? null
        : distanceRaw;

      const length = typeof r.length === 'number' ? r.length : Number(r.length);

      // Flat-biome (metalog/SPIRE) samples repeat the same term at every level.
      const resolvedLevels = collapseConsecutiveLevels([
        r.resolved_biome_level_1,
        r.resolved_biome_level_2,
        r.resolved_biome_level_3,
        r.resolved_biome_level_4,
      ]);

      const environmentContext = [
        r.environment_biome,
        r.environment_feature,
        r.environment_material,
      ].filter((value): value is string => Boolean(value && value.trim()));

      // Prefer the raw ENVO biome term; the lineage just mirrors the GOLD path.
      const envBiome = (r.environment_biome ?? '').trim();
      const biomeLevels = envBiome ? [envBiome] : resolvedLevels;
      const biomeDisplay = biomeLevels.length > 0
        ? biomeLevels.join(' > ')
        : (environmentContext[0] ?? 'Unknown');

      // MIBiG hit from the bgc_facets index. Never fatal: OpenSearch being down
      // must not 500 a page that otherwise came from Postgres.
      let mibigHomology = null as Awaited<ReturnType<typeof bgcMibigHomology>>;
      try {
        mibigHomology = await bgcMibigHomology(r.id);
      } catch (err) {
        console.error(`[bgcs/${bgcId}] MIBiG homology lookup failed:`, err);
      }

      return {
        success: true as const,
        data: {
          id: r.id,
          assembly: r.assembly,
          assemblyDisplay: r.assembly,
          assemblySourceType: r.assembly_source_type,
          name: r.filename,
          category,
          categories,
          productCategories: product_category,
          products: product,
          completeness: r.is_complete === true ? 'complete' : 'partial',
          // start/end are offsets into this contig.
          contig: r.contig ?? null,
          startPos: Number(r.start_pos),
          endPos: Number(r.end_pos),
          length,
          genes: r.num_cds_features ?? null,
          gcf: r.gcf_id ?? null,
          gcfName: r.gcf_name ?? null,
          gcfPetName: r.gcf_pet_name ?? null,
          gcfFamilyClass: r.gcf_family_class ?? null,
          distance,
          alsoInFamilies,
          // Similarity to a MIBiG cluster; distinct from the family's
          // `mibigAnchors`, which is co-membership.
          mibigHomology,
          antismashRunId: r.antismash_run_id ?? null,
          anchor: r.anchor ?? null,
          biome: biomeDisplay,
          biomeLevels,
          biomeEnvironment: environmentContext,
          goldEcosystemPath: r.gold_ecosystem_path ?? null,
          goldEcosystemMetadata: r.gold_ecosystem_metadata ?? null,
          sampleIds: Array.isArray(r.sample_ids) ? r.sample_ids : [],
          sampleLabels: stripSourcePrefixes(r.sample_labels),
          taxonomyDomain: r.taxonomy_domain ?? null,
          taxonomyPhylum: r.taxonomy_phylum ?? null,
          taxonomyClass: r.taxonomy_class ?? null,
          taxonomyOrder: r.taxonomy_order ?? null,
          taxonomyFamily: r.taxonomy_family ?? null,
          taxonomyGenus: r.taxonomy_genus ?? null,
          taxonomySpecies: r.taxonomy_species ?? null,
          gtdbLineage: r.gtdb_lineage ?? null,
        },
      };
    }, DETAIL_CACHE_TTL_SECONDS);

    if ('notFound' in payload && payload.notFound) {
      // A removed duplicate answers as its twin. 308 keeps the method.
      const twin = await findBgcRedirect(bgcId);
      if (twin) {
        const target = new URL(request.url);
        target.pathname = target.pathname.replace(/[^/]+$/, twin);
        return redirectToTwin(target);
      }
      return NextResponse.json({ success: false, error: 'BGC not found' }, { status: 404 });
    }

    return NextResponse.json(payload, {
      headers: {
        'Cache-Control': `public, s-maxage=${DETAIL_CACHE_TTL_SECONDS}, stale-while-revalidate=${DETAIL_CACHE_TTL_SECONDS}`,
      },
    });
  } catch (error: unknown) {
    return serverError(error, 'Error in /api/bgcs/[id]');
  }
}
