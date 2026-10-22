-- Rebuild gcf_taxonomy_counts: primary members per family and
-- taxonomy_id, which /api/gcfs/[id]/taxonomy-distribution reads instead of
-- aggregating bgc_gcf x bgc_taxonomy per request.
--
-- Run after every re-clustering (beside backfill_taxonomy_dist.sql) and after any
-- change to bgc_taxonomy:
--   psql -d bgc_atlas_v2 -f scripts/clustering-v3/build_gcf_taxonomy_counts.sql
--
-- Built into a side table and swapped in at the end, so the panel never reads a
-- half-built table. The route falls back to the live aggregate for a family with no
-- rows, so a stale table after a re-clustering is slow, not empty -- but rebuild it.
--
-- Memory settings as in backfill_taxonomy_dist.sql: work_mem is per plan node per
-- worker and is doubled by hash_mem_multiplier, and 512MB OOM-killed the cluster
-- once (migration 0073). One GROUP BY here, so 128MB with no parallel workers.
SET work_mem = '128MB';
SET max_parallel_workers_per_gather = 0;
SET statement_timeout = 0;

DROP TABLE IF EXISTS gcf_taxonomy_counts_new;

CREATE TABLE gcf_taxonomy_counts_new AS
SELECT bg.gcf_id, bt.taxonomy_id, COUNT(*)::int AS bgc_count
FROM bgc_gcf bg
-- LEFT: an unclassified BGC has no bgc_taxonomy row, and the route reports those
-- as bgcs_without_taxonomy from the NULL bucket.
LEFT JOIN bgc_taxonomy bt ON bt.bgc_id = bg.bgc_id
-- Primary membership only, as the route has always counted, so the panel sums to
-- the member count shown beside it.
WHERE bg.is_primary
GROUP BY bg.gcf_id, bt.taxonomy_id;

ALTER TABLE gcf_taxonomy_counts_new ALTER COLUMN gcf_id SET NOT NULL;
ALTER TABLE gcf_taxonomy_counts_new ALTER COLUMN bgc_count SET NOT NULL;
CREATE INDEX idx_gcf_taxonomy_counts_new_gcf_id ON gcf_taxonomy_counts_new (gcf_id);
ANALYZE gcf_taxonomy_counts_new;

-- The swap waits at most 10 s for a reader's lock rather than queueing every
-- request behind it.
SET lock_timeout = '10s';
BEGIN;
DROP TABLE gcf_taxonomy_counts;
ALTER TABLE gcf_taxonomy_counts_new RENAME TO gcf_taxonomy_counts;
ALTER INDEX idx_gcf_taxonomy_counts_new_gcf_id RENAME TO idx_gcf_taxonomy_counts_gcf_id;
COMMENT ON TABLE gcf_taxonomy_counts IS
  'Primary members per (family, taxonomy_id); NULL taxonomy_id = unclassified. '
  'Built by scripts/clustering-v3/build_gcf_taxonomy_counts.sql.';
GRANT SELECT ON gcf_taxonomy_counts TO bgc_app;
COMMIT;

SELECT COUNT(*) AS rows, COUNT(DISTINCT gcf_id) AS families, SUM(bgc_count) AS primary_members
FROM gcf_taxonomy_counts;
