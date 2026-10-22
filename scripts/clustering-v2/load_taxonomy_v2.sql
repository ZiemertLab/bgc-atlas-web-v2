-- taxonomy v2: populate bgc_taxonomy from the staged build files (run by load_taxonomy_v2.sh).
-- Needs the tax_stage_* tables (new-schema/load-staging/0071_taxonomy_v2_schema.sql).
-- Run off-hours (full bgcs scan, 16.4M-row anti-join). Idempotent.

\set ON_ERROR_STOP on
SET statement_timeout = 0;
SET work_mem = '512MB';          -- keeps the anti-join off disk temp

\timing on

CREATE INDEX IF NOT EXISTS tmp_stage_pred_lineage ON tax_stage_pred (gtdb_lineage);
CREATE INDEX IF NOT EXISTS tmp_stage_gtdb_acc     ON tax_stage_gtdb (accession);
ANALYZE tax_stage_lineages;
ANALYZE tax_stage_pred;
ANALYZE tax_stage_gtdb;

-- Existing rows keep their id: bgc_taxonomy references it.
INSERT INTO taxonomies (gtdb_lineage, domain, phylum, class, order_name,
                        family, genus, species, source, is_partial, rank_depth)
SELECT s.gtdb_lineage, s.domain, s.phylum, s.class, s.order_name,
       s.family, s.genus, s.species, s.source, s.is_partial, s.rank_depth
FROM tax_stage_lineages s
ON CONFLICT (gtdb_lineage) DO NOTHING;

ANALYZE taxonomies;
SELECT 'taxonomies' AS step, count(*) AS total FROM taxonomies;

-- gtdb_lineage is NULL for a GTDB genome that R232 no longer carries.
DROP TABLE IF EXISTS tmp_gtdb_bgc;
CREATE UNLOGGED TABLE tmp_gtdb_bgc AS
SELECT b.id           AS bgc_id,
       g.gtdb_lineage AS gtdb_lineage
FROM bgcs b
JOIN assemblies a ON a.id = b.assembly
                 AND a.data_source_ids @> ARRAY['eb473234-fae6-5fa1-8a99-8014e567fd3f'::uuid]
LEFT JOIN tax_stage_gtdb g ON g.accession = a.accession;

ALTER TABLE tmp_gtdb_bgc ADD PRIMARY KEY (bgc_id);
ANALYZE tmp_gtdb_bgc;

SELECT 'gtdb bgcs' AS step,
       count(*)                                        AS total,
       count(*) FILTER (WHERE gtdb_lineage IS NOT NULL) AS in_r232,
       count(*) FILTER (WHERE gtdb_lineage IS NULL)     AS dropped_by_r232
FROM tmp_gtdb_bgc;

-- Lineages previously assigned to GTDB genomes that R232 dropped, kept across the TRUNCATE.
DROP TABLE IF EXISTS tmp_gtdb_prev;
CREATE UNLOGGED TABLE tmp_gtdb_prev AS
SELECT bt.bgc_id, bt.taxonomy_id
FROM bgc_taxonomy bt
JOIN tmp_gtdb_bgc g ON g.bgc_id = bt.bgc_id
WHERE g.gtdb_lineage IS NULL
  AND bt.method IN ('gtdb_r232', 'gtdb_legacy');

TRUNCATE bgc_taxonomy;

-- 3a. GTDB isolates present in R232.
INSERT INTO bgc_taxonomy (bgc_id, taxonomy_id, rank, support, method)
SELECT g.bgc_id, t.id,
       CASE t.rank_depth WHEN 7 THEN 'species' WHEN 6 THEN 'genus'
                         WHEN 5 THEN 'family'  WHEN 4 THEN 'order'
                         WHEN 3 THEN 'class'   WHEN 2 THEN 'phylum'
                         ELSE 'domain' END,
       NULL::real,
       'gtdb_r232'
FROM tmp_gtdb_bgc g
JOIN taxonomies t ON t.gtdb_lineage = g.gtdb_lineage
WHERE g.gtdb_lineage IS NOT NULL;

-- 3b. GTDB isolates R232 dropped keep the genome-derived lineage they had (none on a
--     fresh database; those fall through to 3c).
INSERT INTO bgc_taxonomy (bgc_id, taxonomy_id, rank, support, method)
SELECT p.bgc_id, p.taxonomy_id,
       CASE t.rank_depth WHEN 7 THEN 'species' WHEN 6 THEN 'genus'
                         WHEN 5 THEN 'family'  WHEN 4 THEN 'order'
                         WHEN 3 THEN 'class'   WHEN 2 THEN 'phylum'
                         ELSE 'domain' END,
       NULL::real,
       'gtdb_legacy'
FROM tmp_gtdb_prev p
JOIN taxonomies t ON t.id = p.taxonomy_id;

-- 3c. Everything without a row yet: the ORF-LCA prediction. The join to bgcs drops
--     predicted ids we do not hold, which would otherwise fail the FK.
INSERT INTO bgc_taxonomy (bgc_id, taxonomy_id, rank, support, method)
SELECT p.bgc_id, t.id, p.rank, p.support, 'orf_lca_v1'
FROM tax_stage_pred p
JOIN bgcs b       ON b.id = p.bgc_id
JOIN taxonomies t ON t.gtdb_lineage = p.gtdb_lineage
WHERE NOT EXISTS (SELECT 1 FROM bgc_taxonomy bt WHERE bt.bgc_id = p.bgc_id);

DROP TABLE tmp_gtdb_prev;

ANALYZE bgc_taxonomy;

SELECT method, count(*) AS rows FROM bgc_taxonomy GROUP BY method
UNION ALL
SELECT 'TOTAL', count(*) FROM bgc_taxonomy
ORDER BY 2 DESC;
