import { NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import { getOrSetCache } from '@/lib/cache';
import { serverError } from '@/lib/api/errors';
import { findRetiredFamily } from '@/lib/gcf-legacy';

const isValidUuid = (id: string) => {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
};

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;

    if (!isValidUuid(id)) {
      return NextResponse.json(
        {
          success: false,
          error: 'Invalid GCF ID format',
          message: 'GCF ID must be a valid UUID',
        },
        { status: 400 }
      );
    }

    // Bump on every shape change: a cached entry missing a newer field (e.g.
    // `mibigAnchors`) reads as a real empty answer.
    const cacheKey = `gcf:detail:v3:${id}`;

    const payload = await getOrSetCache(cacheKey, async () => {
      type GcfSummaryRow = {
        gcf_id: string;
        gcf_name: string | null;
        cluster_method: string | null;
        family_class: string | null;
        listed: boolean | null;
        pet_name: string | null;
        representative_bgc_id: string | null;
        description: string | null;
        gcf_created_at: Date | string;
        gcf_updated_at: Date | string;
        member_bgc_count: number | string;
        assembly_count: number | string;
        complete_bgc_count: number | string;
        partial_bgc_count: number | string;
        // lower = better
        avg_distance: number | string | { toNumber?: () => number } | null;
        min_distance: number | string | { toNumber?: () => number } | null;
        max_distance: number | string | { toNumber?: () => number } | null;
        median_distance: number | string | { toNumber?: () => number } | null;
        unique_product_categories: number | string;
        product_categories: string[] | null;
        unique_taxa_count: number | string;
        seed_assignments: number | string;
        derived_assignments: number | string;
        novel_assignments: number | string;
        // From gcf_route_counts_mv (nullable).
        contained_assignments: number | string | null;
        orphan_query_assignments: number | string | null;
        first_bgc_added: Date | string | null;
        last_bgc_added: Date | string | null;
        median_complete_len: number | string | null;
        min_len: number | string | null;
        max_len: number | string | null;
        length_member_count: number | string | null;
      };

      const summaryRows = await prisma.$queryRaw<GcfSummaryRow[]>(Prisma.sql`
        SELECT s.*, g.family_class, g.listed, g.pet_name,
               gl.median_complete_len, gl.min_len, gl.max_len,
               gl.member_count AS length_member_count,
               rc.contained_assignments, rc.orphan_query_assignments
        FROM gcf_summary_mv s
        JOIN gcfs g ON g.id = s.gcf_id
        -- LEFT: a family with no members has no row.
        LEFT JOIN gcf_length_stats_mv gl ON gl.gcf_id = s.gcf_id
        -- derived_assignments is contained + orphan_query, which are different
        -- events, so the split is fetched separately.
        LEFT JOIN gcf_route_counts_mv rc ON rc.gcf_id = s.gcf_id
        WHERE s.gcf_id = ${id}::uuid
      `);

      if (summaryRows.length === 0) {
        return null;
      }

      const summary = summaryRows[0];

      // The GOLD ecosystem distribution is loaded lazily by its own endpoint.

      type ProductRow = {
        product_category: string;
        product: string;
        bgc_count: number | string;
      };

      const productTypeRows = await prisma.$queryRaw<ProductRow[]>(Prisma.sql`
        SELECT
          product_category,
          product,
          bgc_count
        FROM gcf_product_type_matrix_mv
        WHERE gcf_id = ${id}::uuid
        ORDER BY bgc_count DESC
      `);

      // Category counts overlap (hybrids count under both); combinations are a
      // partition. Product rows are neither.
      type CategoryCountRow = { key: string; bgc_count: number | string };

      const categoryMemberRows = await prisma.$queryRaw<CategoryCountRow[]>(Prisma.sql`
        SELECT category AS key, bgc_count
        FROM gcf_product_category_distribution_mv
        WHERE gcf_id = ${id}::uuid
        ORDER BY bgc_count DESC, category ASC
      `);

      const categoryCombinationRows = await prisma.$queryRaw<CategoryCountRow[]>(Prisma.sql`
        SELECT combination AS key, bgc_count
        FROM gcf_category_combination_mv
        WHERE gcf_id = ${id}::uuid
        ORDER BY bgc_count DESC, combination ASC
      `);

      // representative_bgc_id is currently unpopulated, so fall back to an
      // exemplar member (complete > family-central > longest).
      let representativeBgc = null;
      {
        type RepBgcRow = {
          id: string;
          filename: string | null;
          product_category: string[] | null;
          product: string[] | null;
          is_complete: boolean;
          start_pos: number;
          end_pos: number;
          num_cds_features: number | null;
          assembly: string;
          anchor: string | null;
        };

        // Primary members only.
        const repSelector = summary.representative_bgc_id
          ? Prisma.sql`WHERE b.id = ${summary.representative_bgc_id}::uuid`
          : Prisma.sql`
              JOIN bgc_gcf bg ON bg.bgc_id = b.id
                AND bg.gcf_id = ${id}::uuid
                AND bg.is_primary
              ORDER BY
                b.is_complete DESC,
                bg.distance ASC NULLS LAST,
                (b.end_pos - b.start_pos) DESC,
                b.id ASC`;

        const repBgcRows = await prisma.$queryRaw<RepBgcRow[]>(Prisma.sql`
          SELECT
            b.id,
            b.filename,
            b.product_category,
            b.product,
            b.is_complete,
            b.start_pos,
            b.end_pos,
            b.num_cds_features,
            b.assembly,
            b.anchor
          FROM bgcs b
          ${repSelector}
          LIMIT 1
        `);

        if (repBgcRows.length > 0) {
          const rep = repBgcRows[0];
          representativeBgc = {
            id: rep.id,
            name: rep.filename ?? rep.id,
            productCategory: Array.isArray(rep.product_category) ? rep.product_category : [],
            productType: Array.isArray(rep.product) ? rep.product : [],
            isComplete: rep.is_complete,
            length: rep.end_pos - rep.start_pos + 1,
            genes: rep.num_cds_features,
            assembly: rep.assembly,
            // Without an anchor the viewer would show the contig's first region,
            // possibly a different BGC, so the page suppresses it.
            anchor: rep.anchor,
          };
        }
      }

      type SourceTypeRow = {
        source_type: string | null;
        assembly_count: number | string;
        bgc_count: number | string;
        // lower = better
        avg_distance: number | string | { toNumber?: () => number } | null;
      };

      const sourceTypeRows = await prisma.$queryRaw<SourceTypeRow[]>(Prisma.sql`
        SELECT
          source_type,
          assembly_count,
          bgc_count,
          avg_distance
        FROM gcf_assembly_source_stats_mv
        WHERE gcf_id = ${id}::uuid
        ORDER BY bgc_count DESC
      `);

      // MIBiG references that are members of this family (distance <= 0.4).
      type MibigAnchorRow = {
        mibig_accession: string;
        compounds: string[] | null;
        chem_classes: string[] | null;
        producer: string | null;
        mibig_version: number | string | null;
        mibig_status: string | null;
        membership_distance: number | string | null;
      };

      const mibigAnchorRows = await prisma.$queryRaw<MibigAnchorRow[]>(Prisma.sql`
        SELECT mibig_accession, compounds, chem_classes, producer, mibig_version,
               mibig_status, membership_distance
        FROM gcf_mibig_anchor
        WHERE gcf_id = ${id}::uuid
        ORDER BY membership_distance ASC NULLS LAST, mibig_accession ASC
      `);

      // The taxonomy summary is loaded lazily with the taxonomy distribution.

      const toNum = (val: number | string | { toNumber?: () => number } | null | undefined): number | null => {
        if (val === null || val === undefined) return null;
        if (typeof val === 'number') return val;
        if (typeof val === 'object' && 'toNumber' in val && typeof val.toNumber === 'function') {
          return val.toNumber();
        }
        const num = Number(val);
        return Number.isFinite(num) ? num : null;
      };

      return {
        success: true,
        data: {
          id: summary.gcf_id,
          name: summary.gcf_name ?? `GCF_${summary.gcf_id.slice(0, 8)}`,
          clusterMethod: summary.cluster_method,
          familyClass: summary.family_class ?? null,
          listed: summary.listed ?? null,
          petName: summary.pet_name ?? null,
          description: summary.description,
          createdAt: summary.gcf_created_at,
          updatedAt: summary.gcf_updated_at,

          memberBgcCount: toNum(summary.member_bgc_count) ?? 0,
          assemblyCount: toNum(summary.assembly_count) ?? 0,
          completeBgcCount: toNum(summary.complete_bgc_count) ?? 0,
          partialBgcCount: toNum(summary.partial_bgc_count) ?? 0,

          // BiG-SLiCE distances, lower = better
          avgDistance: toNum(summary.avg_distance),
          minDistance: toNum(summary.min_distance),
          maxDistance: toNum(summary.max_distance),
          medianDistance: toNum(summary.median_distance),

          uniqueProductCategories: toNum(summary.unique_product_categories) ?? 0,
          productCategories: Array.isArray(summary.product_categories) ? summary.product_categories : [],

          uniqueTaxaCount: toNum(summary.unique_taxa_count) ?? 0,

          // Median over complete members, else the longest member as a lower
          // bound (see lib/utils/bgc-length.ts).
          lengthStats: summary.length_member_count === null || summary.length_member_count === undefined
            ? null
            : {
                medianCompleteLen: toNum(summary.median_complete_len),
                minLen: toNum(summary.min_len),
                maxLen: toNum(summary.max_len),
                completeCount: toNum(summary.complete_bgc_count) ?? 0,
                memberCount: toNum(summary.length_member_count) ?? 0,
              },

          // Assignments (route taxonomy: seed / derived / novel)
          seedAssignments: toNum(summary.seed_assignments) ?? 0,
          containedAssignments: toNum(summary.contained_assignments) ?? 0,
          orphanQueryAssignments: toNum(summary.orphan_query_assignments) ?? 0,
          derivedAssignments: toNum(summary.derived_assignments) ?? 0,
          novelAssignments: toNum(summary.novel_assignments) ?? 0,

          firstBgcAdded: summary.first_bgc_added,
          lastBgcAdded: summary.last_bgc_added,

          representativeBgc,

          productTypeDistribution: productTypeRows.map((row) => ({
            productCategory: row.product_category,
            productType: row.product,
            bgcCount: toNum(row.bgc_count) ?? 0,
          })),

          categoryMembers: categoryMemberRows.map((row) => ({
            category: row.key,
            bgcCount: toNum(row.bgc_count) ?? 0,
          })),
          categoryCombinations: categoryCombinationRows.map((row) => ({
            combination: row.key,
            bgcCount: toNum(row.bgc_count) ?? 0,
          })),

          // Co-membership, not the per-BGC KnownClusterBLAST homology; never summed.
          mibigAnchors: mibigAnchorRows.map((row) => ({
            accession: row.mibig_accession,
            compounds: Array.isArray(row.compounds) ? row.compounds : [],
            chemClasses: Array.isArray(row.chem_classes) ? row.chem_classes : [],
            producer: row.producer,
            // MIBiG 4.x 404s on an unversioned accession, so the link needs this.
            mibigVersion: toNum(row.mibig_version),
            status: row.mibig_status,
            distance: toNum(row.membership_distance),
          })),

          sourceTypeDistribution: sourceTypeRows.map((row) => ({
            sourceType: row.source_type ?? 'Unknown',
            assemblyCount: toNum(row.assembly_count) ?? 0,
            bgcCount: toNum(row.bgc_count) ?? 0,
            avgDistance: toNum(row.avg_distance),
          })),
        },
        message: 'GCF details fetched successfully',
      };
    });

    if (!payload) {
      // A family of a replaced clustering: 410 Gone, with where its members went, so the page can say so
      // rather than 404 (bookmarks and citations of the old families keep working).
      const retired = await findRetiredFamily(id);
      if (retired) {
        return NextResponse.json(
          { success: false, error: 'Family from a previous clustering', retired },
          { status: 410, headers: { 'Cache-Control': 'public, s-maxage=3600' } },
        );
      }
      return NextResponse.json(
        {
          success: false,
          error: 'GCF not found',
          message: `No GCF found with ID: ${id}`,
        },
        { status: 404 }
      );
    }

    return NextResponse.json(payload, {
      headers: {
        'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600',
      },
    });
  } catch (error) {
    return serverError(error, 'GCF detail API Error');
  }
}
