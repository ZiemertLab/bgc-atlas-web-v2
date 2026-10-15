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
        'gcf_route_counts_mv',
    ],
    [
        'bgc_biome_summary_mv',            // the long pole
        'bgc_data_source_counts',
        'bgc_gold_ecosystem_distribution_mv',
        'gcf_gold_ecosystem_distribution_mv',
        'study_ecosystem_dist',
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
