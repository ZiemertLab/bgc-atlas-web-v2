-- Populate gcf_cooccurrence_stats -- the stats-panel payload.
--
-- Run after every co-occurrence recompute, then bust the gcf-cooccurrence* Redis keys.
--   psql -h localhost -U bgc_owner -d bgc_atlas_v2 -v ON_ERROR_STOP=1 \
--        -f scripts/clustering-v3/build_cooccurrence_stats.sql
--
-- SCHEMA_VERSION must match STATS_SCHEMA_VERSION in the stats route; bump both when the
-- payload's fields change.
\set SCHEMA_VERSION 1
\timing on

SET statement_timeout = 0;
-- work_mem is per sort node and several are live at once; 512MB can OOM-kill the server.
SET work_mem = '128MB';
SET max_parallel_workers_per_gather = 2;

DROP TABLE IF EXISTS _cooc_a, _cooc_b, _cooc_c;

\echo '=== pass A: gcf_cooccurrence_mv (19 GB) -- counts, means, quartiles ==='
CREATE UNLOGGED TABLE _cooc_a AS
SELECT
    count(*)                                                              AS total_pairs,
    count(*) FILTER (WHERE significance_category = 'highly_significant_positive') AS hsp,
    count(*) FILTER (WHERE significance_category = 'significant_positive')        AS sp,
    count(*) FILTER (WHERE significance_category = 'moderate_positive')           AS mp,
    count(*) FILTER (WHERE significance_category = 'neutral')                     AS neu,
    count(*) FILTER (WHERE significance_category = 'negative')                    AS neg,
    avg(jaccard_index)                                                    AS avg_jac,
    avg(obs_exp_ratio)                                                    AS avg_oe,
    min(jaccard_index)                                                    AS jac_min,
    max(jaccard_index)                                                    AS jac_max,
    min(obs_exp_ratio)                                                    AS oe_min,
    max(obs_exp_ratio)                                                    AS oe_max,
    percentile_cont(0.25) WITHIN GROUP (ORDER BY jaccard_index)           AS jac_q1,
    percentile_cont(0.50) WITHIN GROUP (ORDER BY jaccard_index)           AS jac_med,
    percentile_cont(0.75) WITHIN GROUP (ORDER BY jaccard_index)           AS jac_q3,
    percentile_cont(0.25) WITHIN GROUP (ORDER BY obs_exp_ratio)           AS oe_q1,
    percentile_cont(0.50) WITHIN GROUP (ORDER BY obs_exp_ratio)           AS oe_med,
    percentile_cont(0.75) WITHIN GROUP (ORDER BY obs_exp_ratio)           AS oe_q3
FROM gcf_cooccurrence_mv;

\echo '=== pass B: gcf_cooccurrence_enriched_mv (32 GB) -- product + ecosystem, ONE scan ==='
CREATE UNLOGGED TABLE _cooc_b AS
SELECT
    grouping(product_category_pair)   AS g_prod,
    grouping(same_dominant_ecosystem) AS g_eco,
    product_category_pair,
    same_dominant_ecosystem,
    count(*)                          AS pair_count,
    avg(jaccard_index)                AS avg_jac,
    avg(obs_exp_ratio)                AS avg_oe,
    count(*) FILTER (WHERE significance_category IN
        ('highly_significant_positive', 'significant_positive')) AS hs_count
FROM gcf_cooccurrence_enriched_mv
GROUP BY GROUPING SETS ((product_category_pair), (same_dominant_ecosystem));

\echo '=== pass C: id UNION (121.6M rows) -- per-GCF degree ==='
CREATE UNLOGGED TABLE _cooc_c AS
SELECT gcf_id, count(*) AS total_cooccurrences, avg(jaccard_index) AS avg_jac
FROM (
    SELECT gcf_id_a AS gcf_id, jaccard_index FROM gcf_cooccurrence_mv
    UNION ALL
    SELECT gcf_id_b AS gcf_id, jaccard_index FROM gcf_cooccurrence_mv
) u
GROUP BY gcf_id;

\echo '=== assemble the payload ==='
INSERT INTO gcf_cooccurrence_stats (schema_version, payload, n_pairs, computed_at)
SELECT
    :SCHEMA_VERSION,
    jsonb_build_object(
      'totalPairs',           a.total_pairs,
      'totalGcfsInvolved',    (SELECT count(*) FROM _cooc_c),
      'bySignificanceCategory', jsonb_build_object(
          'highly_significant_positive', a.hsp,
          'significant_positive',        a.sp,
          'moderate_positive',           a.mp,
          'neutral',                     a.neu,
          'negative',                    a.neg),
      'avgJaccardIndex',      a.avg_jac,
      'medianJaccardIndex',   a.jac_med,
      'avgObsExpRatio',       a.avg_oe,
      'medianObsExpRatio',    a.oe_med,
      'jaccardDistribution',  jsonb_build_object(
          'min', a.jac_min, 'q1', a.jac_q1, 'median', a.jac_med,
          'q3', a.jac_q3, 'max', a.jac_max),
      'obsExpDistribution',   jsonb_build_object(
          'min', a.oe_min, 'q1', a.oe_q1, 'median', a.oe_med,
          'q3', a.oe_q3, 'max', a.oe_max),
      'topProductCategoryPairs', COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
                     'productCategoryPair', t.product_category_pair,
                     'pairCount',           t.pair_count,
                     'avgJaccardIndex',     t.avg_jac,
                     'avgObsExpRatio',      t.avg_oe) ORDER BY t.pair_count DESC)
          FROM (SELECT * FROM _cooc_b
                 WHERE g_prod = 0 AND product_category_pair <> 'Unknown × Unknown'
                 ORDER BY pair_count DESC LIMIT 15) t), '[]'::jsonb),
      'ecosystemPatterns', COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
                     'sameEcosystem',           COALESCE(t.same_dominant_ecosystem, false),
                     'pairCount',               t.pair_count,
                     'avgJaccardIndex',         t.avg_jac,
                     'highlySignificantCount',  t.hs_count)
                 ORDER BY t.same_dominant_ecosystem DESC NULLS LAST)
          FROM (SELECT * FROM _cooc_b WHERE g_eco = 0) t), '[]'::jsonb),
      'topGcfsByCooccurrence', COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
                     'gcfId',                x.gcf_id,
                     'gcfName',              x.gcf_name,
                     'totalCooccurrences',   x.total_cooccurrences,
                     'avgJaccardWithOthers', x.avg_jac,
                     'productCategories',    x.product_categories)
                 ORDER BY x.total_cooccurrences DESC)
          FROM (
            SELECT c.gcf_id::text AS gcf_id,
                   COALESCE(gs.gcf_name, 'GCF_' || left(c.gcf_id::text, 8)) AS gcf_name,
                   c.total_cooccurrences,
                   c.avg_jac,
                   COALESCE(to_jsonb(gs.product_categories), '[]'::jsonb) AS product_categories
            FROM _cooc_c c
            LEFT JOIN gcf_summary_mv gs ON gs.gcf_id = c.gcf_id
            ORDER BY c.total_cooccurrences DESC LIMIT 20) x), '[]'::jsonb)
    ),
    a.total_pairs,
    now()
FROM _cooc_a a
ON CONFLICT (schema_version) DO UPDATE
   SET payload = EXCLUDED.payload, n_pairs = EXCLUDED.n_pairs, computed_at = EXCLUDED.computed_at;

DROP TABLE _cooc_a, _cooc_b, _cooc_c;

\echo '=== result ==='
SELECT schema_version, n_pairs, computed_at,
       jsonb_pretty(payload #> '{bySignificanceCategory}') AS by_significance,
       payload -> 'totalGcfsInvolved' AS gcfs_involved,
       pg_size_pretty(length(payload::text)::bigint) AS payload_size
FROM gcf_cooccurrence_stats;
