-- Prewarm Tier 1: index-descent path + small join tables -> shared_buffers.
-- ~2.0 GB, sub-second; run hourly.
--
-- to_regclass() skips a missing name (status 'missing'); a ::regclass cast
-- would abort the whole SELECT. Sizes are approximate.

\set ON_ERROR_STOP on
CREATE EXTENSION IF NOT EXISTS pg_prewarm;

\timing on

SELECT t.relname,
       CASE WHEN r.oid IS NULL THEN 'missing' ELSE 'ok' END AS status,
       pg_size_pretty(pg_relation_size(r.oid)) AS size,
       CASE WHEN r.oid IS NULL THEN NULL ELSE pg_prewarm(r.oid, 'buffer') END AS blocks
FROM (VALUES
  ('bgcs_pkey'),                        -- 681 MB  PK descent for /api/bgcs/[id]
  ('idx_bgc_biome_summary_bgc'),        -- 496 MB  biome MV join
  ('sample_summary_id_idx'),            --  26 MB  gold-ecosystem LATERAL join
  ('idx_sample_assemblies_assembly_id'),--  35 MB  sample_assemblies join
  ('assemblies_pkey'),                  --  35 MB  assembly join
  ('idx_assembly_samples_mv_assembly'), --  27 MB  sample-labels MV join
  ('idx_bgc_gcf_gcf_primary'),          -- 120 MB  per-GCF primary members (export-gbk, GCF panels)
  ('idx_bgcs_assembly'),                -- 136 MB  per-assembly BGC count (assemblies endpoint)
  ('taxonomies_pkey'),                  --  10 MB  taxonomy join
  ('assemblies'),                       -- 176 MB  small heap (source_type)
  ('sample_assemblies'),                --  58 MB  small heap
  ('assembly_samples_mv'),              -- 178 MB  small heap (sample_ids/labels)
  ('taxonomies')                        --  82 MB  small heap (lineage)
) AS t(relname)
LEFT JOIN LATERAL (SELECT to_regclass(t.relname) AS oid) r ON true;
