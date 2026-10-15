-- Full rebuild of gcf_taxonomy_distribution_mv (a plain table despite the name, so no
-- matview refresh rebuilds it) for clustering-v3. Must run after the cutover: it is keyed
-- on gcf_id and no v2 id survives. It TRUNCATEs, so outside a cutover run it in a
-- maintenance window.

-- work_mem is per plan node per worker (x hash_mem_multiplier 2.0); 512MB can OOM the
-- cluster on this many-node query, so keep it modest with parallelism off.
SET work_mem = '128MB';
SET max_parallel_workers_per_gather = 0;
SET statement_timeout = 0;

TRUNCATE gcf_taxonomy_distribution_mv;

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
  -- No hop through bgcs: bgc_gcf.bgc_id is FK-guaranteed.
  LEFT JOIN bgc_taxonomy bt ON bt.bgc_id = bg.bgc_id
  LEFT JOIN taxonomies t    ON t.id = bt.taxonomy_id
  -- Primary membership only, so a family's taxonomy sums to its member count.
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

ANALYZE gcf_taxonomy_distribution_mv;
SELECT count(*) AS rows_backfilled FROM gcf_taxonomy_distribution_mv;

-- Required: after TRUNCATE + INSERT the planner treats the table as empty and /api/gcfs
-- picks a nested loop over every family.
ANALYZE gcf_taxonomy_distribution_mv;
