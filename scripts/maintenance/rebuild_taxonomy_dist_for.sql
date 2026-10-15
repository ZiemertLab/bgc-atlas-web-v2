-- gcf_taxonomy_distribution_mv for a LIST of families, in place.
--
-- gcf_taxonomy_distribution_mv is a plain table no matview refresh rebuilds. Unlike the
-- full rebuild (backfill_taxonomy_dist.sql, which TRUNCATEs), readers keep the old rows
-- until this commits. Same derivation as the full rebuild, narrowed.
--
-- Run from the directory holding affected_gcf_ids.txt (one gcf id per line):
--   psql "$OWNER_URL" -v ON_ERROR_STOP=1 -f <repo>/scripts/maintenance/rebuild_taxonomy_dist_for.sql

\set ON_ERROR_STOP on
SET work_mem = '64MB';
SET max_parallel_workers_per_gather = 0;
SET statement_timeout = 0;

BEGIN;
CREATE TEMP TABLE affected (gcf_id uuid PRIMARY KEY) ON COMMIT DROP;
\copy affected from 'affected_gcf_ids.txt'
ANALYZE affected;

DELETE FROM gcf_taxonomy_distribution_mv d USING affected a WHERE d.gcf_id = a.gcf_id;

INSERT INTO gcf_taxonomy_distribution_mv (gcf_id, domain_distribution, rank_distributions)
WITH taxonomy_entries AS (
  SELECT bg.gcf_id,
    COALESCE(t.domain,     'd__Unknown') AS domain,
    COALESCE(t.phylum,     'p__Unknown') AS phylum,
    COALESCE(t.class,      'c__Unknown') AS class,
    COALESCE(t.order_name, 'o__Unknown') AS order_name,
    COALESCE(t.family,     'f__Unknown') AS family,
    COALESCE(t.genus,      'g__Unknown') AS genus,
    COALESCE(t.species,    's__Unknown') AS species
  FROM bgc_gcf bg
  JOIN affected a ON a.gcf_id = bg.gcf_id
  LEFT JOIN bgc_taxonomy bt ON bt.bgc_id = bg.bgc_id
  LEFT JOIN taxonomies t    ON t.id = bt.taxonomy_id
  -- Primary membership only, or secondary matches inflate the distribution.
  WHERE bg.is_primary
),
rank_counts AS (
  SELECT gcf_id, 'domain'::text AS rank, domain     AS taxon, COUNT(*)::int AS bgc_count FROM taxonomy_entries GROUP BY gcf_id, domain
  UNION ALL SELECT gcf_id, 'phylum',  phylum,     COUNT(*)::int FROM taxonomy_entries GROUP BY gcf_id, phylum
  UNION ALL SELECT gcf_id, 'class',   class,      COUNT(*)::int FROM taxonomy_entries GROUP BY gcf_id, class
  UNION ALL SELECT gcf_id, 'order',   order_name, COUNT(*)::int FROM taxonomy_entries GROUP BY gcf_id, order_name
  UNION ALL SELECT gcf_id, 'family',  family,     COUNT(*)::int FROM taxonomy_entries GROUP BY gcf_id, family
  UNION ALL SELECT gcf_id, 'genus',   genus,      COUNT(*)::int FROM taxonomy_entries GROUP BY gcf_id, genus
  UNION ALL SELECT gcf_id, 'species', species,    COUNT(*)::int FROM taxonomy_entries GROUP BY gcf_id, species
),
rank_percentages AS (
  SELECT gcf_id, rank, taxon, bgc_count,
         SUM(bgc_count) OVER (PARTITION BY gcf_id, rank) AS total_count
  FROM rank_counts
),
aggregated AS (
  SELECT gcf_id, rank,
         jsonb_object_agg(taxon, ROUND((bgc_count::numeric / NULLIF(total_count, 0)) * 100, 2)) AS distribution
  FROM rank_percentages
  GROUP BY gcf_id, rank
),
per_gcf AS (
  SELECT gcf_id, jsonb_object_agg(rank, distribution) AS rd
  FROM aggregated GROUP BY gcf_id
)
SELECT gcf_id, COALESCE(rd -> 'domain', '{}'::jsonb) AS domain_distribution, rd AS rank_distributions
FROM per_gcf;

SELECT count(*) AS families_recomputed FROM gcf_taxonomy_distribution_mv d JOIN affected a USING (gcf_id);
COMMIT;
ANALYZE gcf_taxonomy_distribution_mv;
