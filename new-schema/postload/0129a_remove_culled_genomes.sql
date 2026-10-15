-- Remove the 46,098 genomes culled from the atlas: 9,844 duplicate copies of a genome held by another
-- collection (GTDB keeps the genome), 32,448 below MIMAG medium quality (completeness < 50 or contamination
-- >= 10 on the uniform CheckM2 values) and 3,806 further 100%-identical genome copies. On the live
-- database this removed 46,098 samples, assemblies, analyses and antiSMASH runs and 166,457 BGCs.
--
-- The list is frozen in 0129a_culled_genomes.tsv.gz, keyed on samples.external_id (the populator's
-- natural key; samples.id = uuid5 of it). Removed ids get no redirect: they answer a plain 404.
-- Everything hanging off a culled sample goes with it; analyses and sequencing runs only when nothing
-- that survives still links to them.
--
-- Run from the repo root after the loads and the uniform CheckM2 load, before loading the clustering:
--   PGOPTIONS='-c statement_timeout=0' psql -d bgc_atlas_v2 -v ON_ERROR_STOP=1 \
--     -f new-schema/postload/0129a_remove_culled_genomes.sql
-- Idempotent: a second run finds nothing to remove.
\set ON_ERROR_STOP on
SET work_mem = '64MB';

BEGIN;

CREATE TEMP TABLE cull_in (external_id text PRIMARY KEY, source text, reason text) ON COMMIT DROP;
\copy cull_in FROM PROGRAM 'gzip -dc new-schema/postload/0129a_culled_genomes.tsv.gz' WITH (FORMAT csv, DELIMITER E'\t', HEADER true, QUOTE E'\x01')

CREATE TEMP TABLE rm_samples ON COMMIT DROP AS
SELECT s.id, c.reason FROM samples s JOIN cull_in c ON c.external_id = s.external_id;
CREATE TEMP TABLE rm_assemblies ON COMMIT DROP AS
SELECT DISTINCT sa.assembly_id AS id FROM sample_assemblies sa JOIN rm_samples r ON r.id = sa.sample_id;
CREATE TEMP TABLE rm_aruns ON COMMIT DROP AS
SELECT ar.id FROM antismash_runs ar JOIN rm_assemblies a ON a.id = ar.assembly_id;
CREATE TEMP TABLE rm_bgcs ON COMMIT DROP AS
SELECT b.id FROM bgcs b JOIN rm_assemblies a ON a.id = b.assembly;
ANALYZE rm_samples; ANALYZE rm_assemblies; ANALYZE rm_aruns; ANALYZE rm_bgcs;

-- analyses linked to something removed and to nothing that survives
CREATE TEMP TABLE rm_analyses ON COMMIT DROP AS
SELECT id FROM (
  SELECT analysis_id AS id FROM sample_analyses WHERE sample_id IN (SELECT id FROM rm_samples)
  UNION SELECT analysis_id FROM assembly_analyses WHERE assembly_id IN (SELECT id FROM rm_assemblies)
  UNION SELECT analysis_id FROM antismash_runs WHERE id IN (SELECT id FROM rm_aruns) AND analysis_id IS NOT NULL
) c
WHERE id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM sample_analyses x WHERE x.analysis_id = c.id AND x.sample_id NOT IN (SELECT id FROM rm_samples))
  AND NOT EXISTS (SELECT 1 FROM assembly_analyses x WHERE x.analysis_id = c.id AND x.assembly_id NOT IN (SELECT id FROM rm_assemblies))
  AND NOT EXISTS (SELECT 1 FROM antismash_runs x WHERE x.analysis_id = c.id AND x.id NOT IN (SELECT id FROM rm_aruns))
  AND NOT EXISTS (SELECT 1 FROM bgcs x WHERE x.analysis_id = c.id AND x.id NOT IN (SELECT id FROM rm_bgcs))
  AND NOT EXISTS (SELECT 1 FROM run_analyses x WHERE x.analysis_id = c.id);
-- sequencing runs linked only to removed samples / assemblies
CREATE TEMP TABLE rm_seqruns ON COMMIT DROP AS
SELECT id FROM (
  SELECT run_id AS id FROM sample_runs WHERE sample_id IN (SELECT id FROM rm_samples)
  UNION SELECT run_id FROM run_assemblies WHERE assembly_id IN (SELECT id FROM rm_assemblies)
) c
WHERE NOT EXISTS (SELECT 1 FROM sample_runs x WHERE x.run_id = c.id AND x.sample_id NOT IN (SELECT id FROM rm_samples))
  AND NOT EXISTS (SELECT 1 FROM run_assemblies x WHERE x.run_id = c.id AND x.assembly_id NOT IN (SELECT id FROM rm_assemblies));
ANALYZE rm_analyses; ANALYZE rm_seqruns;

DO $$
DECLARE n bigint;
BEGIN
  SELECT count(*) INTO n FROM cull_in;
  IF n <> 46098 THEN RAISE EXCEPTION 'culled-genome list has % rows, expected 46098', n; END IF;
  -- a culled genome's assembly must not also belong to a surviving sample
  SELECT count(*) INTO n FROM sample_assemblies sa JOIN rm_assemblies a ON a.id = sa.assembly_id
   WHERE sa.sample_id NOT IN (SELECT id FROM rm_samples);
  IF n > 0 THEN RAISE EXCEPTION '% culled assemblies also belong to a surviving sample', n; END IF;
  SELECT count(*) INTO n FROM bgcs b JOIN rm_aruns r ON r.id = b.antismash_run_id WHERE b.id NOT IN (SELECT id FROM rm_bgcs);
  IF n > 0 THEN RAISE EXCEPTION '% surviving BGCs point at a culled antiSMASH run', n; END IF;
END $$;

SELECT reason, count(*) AS samples FROM rm_samples GROUP BY reason ORDER BY reason;
SELECT (SELECT count(*) FROM rm_samples) AS samples, (SELECT count(*) FROM rm_assemblies) AS assemblies,
       (SELECT count(*) FROM rm_aruns) AS antismash_runs, (SELECT count(*) FROM rm_analyses) AS analyses,
       (SELECT count(*) FROM rm_bgcs) AS bgcs, (SELECT count(*) FROM rm_seqruns) AS seqruns;

-- BGCs first (cascades bgc_taxonomy, bgc_gcf, bgc_features; gcfs.representative_bgc_id goes NULL);
-- antiSMASH runs explicitly, since their FK to assemblies is only SET NULL.
DELETE FROM bgcs WHERE id IN (SELECT id FROM rm_bgcs);
DELETE FROM antismash_runs WHERE id IN (SELECT id FROM rm_aruns);
DELETE FROM assemblies WHERE id IN (SELECT id FROM rm_assemblies);
DELETE FROM analyses WHERE id IN (SELECT id FROM rm_analyses);
-- The cascade from samples scans sample_measurements once per deleted sample without this index.
CREATE INDEX IF NOT EXISTS idx_sample_measurements_sample_id ON sample_measurements (sample_id);
DELETE FROM samples WHERE id IN (SELECT id FROM rm_samples);
DELETE FROM runs WHERE id IN (SELECT id FROM rm_seqruns);

COMMIT;
