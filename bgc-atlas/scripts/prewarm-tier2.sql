-- Prewarm Tier 2: large heaps -> OS page cache (mode 'read'). ~11 GB, several
-- minutes cold; run once a day off-hours.
--
-- statement_timeout is lifted because DATABASE_URL carries the app's 120s cap.
-- Missing names are skipped (see tier 1). Sizes are approximate.

\set ON_ERROR_STOP on
CREATE EXTENSION IF NOT EXISTS pg_prewarm;
SET statement_timeout = 0;

\timing on

SELECT t.relname,
       CASE WHEN r.oid IS NULL THEN 'missing' ELSE 'ok' END AS status,
       pg_size_pretty(pg_relation_size(r.oid)) AS size,
       CASE WHEN r.oid IS NULL THEN NULL ELSE pg_prewarm(r.oid, 'read') END AS blocks
FROM (VALUES
  ('bgcs'),                 -- 6.3 GB  detail/list heap
  ('bgc_biome_summary_mv'), -- 4.2 GB  biome MV heap
  ('sample_summary')        -- 0.9 GB  sample/gold MV heap
) AS t(relname)
LEFT JOIN LATERAL (SELECT to_regclass(t.relname) AS oid) r ON true;
