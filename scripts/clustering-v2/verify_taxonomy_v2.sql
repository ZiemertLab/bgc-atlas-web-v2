-- taxonomy v2 post-load gates. Run after load_taxonomy_v2.sh, before dropping tax_stage_*.
--   psql -d bgc_atlas_v2 -f scripts/clustering-v2/verify_taxonomy_v2.sql
-- Expected values come from an offline reconciliation of the build files.

\set ON_ERROR_STOP on
SET statement_timeout = 0;
SET work_mem = '512MB';

\echo '--- 1. coverage -------------------------------------------------------'
SELECT count(*) AS bgc_taxonomy_rows,
       (SELECT count(*) FROM bgcs) AS bgcs_total,
       round(100.0 * count(*) / (SELECT count(*) FROM bgcs), 2) AS coverage_pct,
       CASE WHEN round(100.0 * count(*) / (SELECT count(*) FROM bgcs), 2) BETWEEN 99.0 AND 100.0
            THEN 'PASS' ELSE 'FAIL — expected ~99.6%' END AS gate
FROM bgc_taxonomy;

\echo '--- 2. one row per BGC, no orphans ------------------------------------'
SELECT (SELECT count(*) FROM (SELECT bgc_id FROM bgc_taxonomy GROUP BY bgc_id HAVING count(*) > 1) x) AS duplicate_bgcs,
       (SELECT count(*) FROM bgc_taxonomy bt WHERE NOT EXISTS (SELECT 1 FROM bgcs b WHERE b.id = bt.bgc_id)) AS orphan_bgc_ids,
       (SELECT count(*) FROM bgc_taxonomy bt WHERE NOT EXISTS (SELECT 1 FROM taxonomies t WHERE t.id = bt.taxonomy_id)) AS orphan_taxonomy_ids,
       CASE WHEN (SELECT count(*) FROM (SELECT bgc_id FROM bgc_taxonomy GROUP BY bgc_id HAVING count(*) > 1) x) = 0
            THEN 'PASS' ELSE 'FAIL — bgc_id is not unique' END AS gate;

\echo '--- 3. GTDB isolates kept genome-derived taxonomy ---------------------'
-- A genome R232 still carries must take its R232 lineage, never a prediction. Genomes R232
-- dropped keep their previous lineage (gtdb_legacy) or, on a fresh database, are predicted.
WITH gtdb AS (
  SELECT b.id, g.accession IS NOT NULL AS in_r232
  FROM bgcs b
  JOIN assemblies a ON a.id = b.assembly
                   AND a.data_source_ids @> ARRAY['eb473234-fae6-5fa1-8a99-8014e567fd3f'::uuid]
  LEFT JOIN tax_stage_gtdb g ON g.accession = a.accession
)
SELECT count(*) AS gtdb_bgcs,
       count(*) FILTER (WHERE g.in_r232) AS in_r232,
       count(*) FILTER (WHERE g.in_r232 AND bt.method = 'gtdb_r232') AS refreshed_r232,
       count(*) FILTER (WHERE g.in_r232 AND bt.method IS DISTINCT FROM 'gtdb_r232') AS wrongly_assigned,
       count(*) FILTER (WHERE NOT g.in_r232 AND bt.method = 'gtdb_legacy') AS kept_previous_release,
       count(*) FILTER (WHERE NOT g.in_r232 AND bt.method = 'orf_lca_v1') AS dropped_predicted,
       CASE WHEN count(*) FILTER (WHERE g.in_r232 AND bt.method IS DISTINCT FROM 'gtdb_r232') = 0
            THEN 'PASS' ELSE 'FAIL — an R232 genome lacks its R232 lineage' END AS gate
FROM gtdb g LEFT JOIN bgc_taxonomy bt ON bt.bgc_id = g.id;

\echo '--- 4. method split ---------------------------------------------------'
SELECT method, count(*) AS rows,
       round(100.0 * count(*) / sum(count(*)) OVER (), 2) AS pct
FROM bgc_taxonomy GROUP BY method ORDER BY 2 DESC;

\echo '--- 5. rank matches the depth of the joined lineage -------------------'
SELECT count(*) AS rank_depth_mismatches,
       CASE WHEN count(*) = 0 THEN 'PASS' ELSE 'FAIL' END AS gate
FROM bgc_taxonomy bt
JOIN taxonomies t ON t.id = bt.taxonomy_id
WHERE bt.rank <> (ARRAY['domain','phylum','class','order','family','genus','species'])[t.rank_depth];

\echo '--- 6. vocabulary gate: names must exist in GTDB R232 -----------------'
-- Catches a regression in the underscore normalizer. Bacteria only. The reference comes
-- from the staged file: pre-existing lineages kept their old taxonomies.source.
WITH ref_genus AS (
  SELECT DISTINCT s.genus FROM tax_stage_lineages s
  WHERE s.source = 'gtdb_r232' AND s.genus IS NOT NULL AND s.domain = 'd__Bacteria'
),
used AS (
  SELECT t.genus, count(*) AS n
  FROM bgc_taxonomy bt
  JOIN taxonomies t ON t.id = bt.taxonomy_id
  WHERE bt.method = 'orf_lca_v1' AND t.genus IS NOT NULL AND t.domain = 'd__Bacteria'
  GROUP BY t.genus
)
SELECT sum(n) FILTER (WHERE genus IN (SELECT genus FROM ref_genus)) AS bgcs_with_known_genus,
       sum(n) AS bgcs_with_any_genus,
       round(100.0 * sum(n) FILTER (WHERE genus IN (SELECT genus FROM ref_genus)) / sum(n), 2) AS pct_known,
       CASE WHEN 100.0 * sum(n) FILTER (WHERE genus IN (SELECT genus FROM ref_genus)) / sum(n) >= 97.0
            THEN 'PASS' ELSE 'FAIL — normalizer regression, check restore_suffix()' END AS gate
FROM used;

\echo '--- 7. BGCs without taxonomy, by source -------------------------------'
-- Expected to be small (gate 1); a large count from one source means the build files did
-- not cover it or the join went wrong.
SELECT COALESCE(ds.names, '(no data_source_ids)') AS source,
       count(*) AS lost
FROM bgcs b
LEFT JOIN bgc_taxonomy bt ON bt.bgc_id = b.id
LEFT JOIN LATERAL (
    SELECT string_agg(d.name, '+' ORDER BY d.name) AS names
    FROM assemblies a
    CROSS JOIN LATERAL unnest(a.data_source_ids) AS u(dsid)
    JOIN data_sources d ON d.id = u.dsid
    WHERE a.id = b.assembly
) ds ON true
WHERE bt.bgc_id IS NULL
GROUP BY 1 ORDER BY 2 DESC;

\echo '--- 8. sanity: the deepest-called lineages ---------------------------'
SELECT bt.rank, count(*) AS bgcs,
       round(avg(bt.support)::numeric, 3) AS mean_support
FROM bgc_taxonomy bt GROUP BY bt.rank
ORDER BY array_position(ARRAY['domain','phylum','class','order','family','genus','species'], bt.rank);
