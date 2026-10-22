// Kept free of Prisma so scripts/refresh-views-cron.sh can read it with a bare `node -e`.

/**
 * Every matview, in dependency order: tier N reads only base tables and matviews
 * from tiers < N. Derived from pg_depend; re-derive with docs/runbooks/post-load-refresh.md §7
 * after adding a matview (a wrong order is silently one generation stale).
 *
 * Every matview needs the unique index REFRESH CONCURRENTLY requires; a refresh that fails
 * for want of one is swallowed and the endpoint still reports success.
 * work_mem is left at the default: large values OOM across plan nodes and workers.
 */
export const REFRESH_TIERS: readonly (readonly string[])[] = [
    [
        'sample_summary',
        'sample_map_view',
        'sample_biome_levels_mv',
        'sample_gcf_counts_mv',
        'sample_parent_key',
        'assembly_samples_mv',
        'source_type_statistics',
        'data_source_statistics',
        'bgc_product_category_distribution_mv',
        'bgc_gold_bucket_counts',
        'bgc_product_facet_counts',
        'gcf_summary_mv',
        'gcf_sample_map_mv',
        'gcf_assembly_source_stats_mv',
        'gcf_length_stats_mv',
        'gcf_product_category_distribution_mv',
        'gcf_category_combination_mv',
        'gcf_product_type_matrix_mv',
        // Reads bgcs + bgc_gcf: members per (family, product), the source of
        // gcf_distributions_mv.product_type_member_share.
        'gcf_product_type_member_mv',
        'gcf_route_counts_mv',
        // Reads bgcs only. Backs the per-assembly # BGCs in the
        // Samples page Assemblies view (/api/assemblies); missed here, an assembly
        // loaded since the last build reads 0 BGCs.
        'assembly_bgc_counts_mv',
    ],
    [
        'bgc_biome_summary_mv',            // the long pole
        'bgc_data_source_counts',
        'bgc_gold_ecosystem_distribution_mv',
        'gcf_gold_ecosystem_distribution_mv',
        // Reads assembly_samples_mv (tier 1), so it lands after it: each member's GOLD path
        // via its assembly's first-ranked sample, from which every ecosystem column of
        // gcf_distributions_mv (tier 3) is built.
        'gcf_member_ecosystem_mv',
        'study_ecosystem_dist',
        // The study page's geography, environment and map points; read sample_summary and
        // sample_parent_key (tier 1).
        'study_geo_mv',
        'study_map_points_mv',
        'sample_source_type_counts',
    ],
    [
        'bgc_biome_level_1_distribution_mv',
        'bgc_biome_level_2_distribution_mv',
        'bgc_biome_level_3_distribution_mv',
        'bgc_biome_level_4_distribution_mv',
        'bgc_environment_distribution_mv',
        'bgc_feature_distribution_mv',
        'bgc_material_distribution_mv',
        'gcf_distributions_mv',
        'gcf_environmental_distribution_mv',
    ],
];

// Rollback copies (`<name>_preNNNN`) kept by a migration that replaced a view.
const UNTRACKED_OK = /_pre\d{4}$/;

// Live matviews (names from pg_matviews) that the weekly cron would never refresh.
export function untrackedMatviews(live: readonly string[]): string[] {
    const tracked = new Set(REFRESH_TIERS.flat());
    return live.filter((v) => !tracked.has(v) && !UNTRACKED_OK.test(v)).sort();
}
