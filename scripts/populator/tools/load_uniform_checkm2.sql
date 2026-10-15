-- Load the uniform CheckM2 1.1.0 run.
-- Input: scripts/populator/data/qc/uniform_checkm2.tsv.gz, written by prepare_uniform_checkm2.py.
--
-- OVERWRITES, unlike backfill_genome_qc.sql: our values replace the published ones for every non-GTDB
-- genome-collection genome. GTDB keeps GTDB R232's values; the TSV's only GTDB rows are the 40 genomes R232
-- lacks, and those are filled only where empty. Every TSV row must update exactly one sample, or the
-- transaction rolls back, so run it before new-schema/postload/0129a_remove_culled_genomes.sql: the TSV
-- still names the culled genomes.
--
-- Run as the owner, from the repo root, after backfill_genome_qc.sql:
--   PGOPTIONS='-c statement_timeout=0' psql "$OWNER_URL" -v ON_ERROR_STOP=1 -f scripts/populator/tools/load_uniform_checkm2.sql

\set ON_ERROR_STOP on
BEGIN;

CREATE TEMP TABLE uniform_qc_in (
  external_id    text PRIMARY KEY,
  completeness   numeric NOT NULL,
  contamination  numeric NOT NULL,
  genome_quality text NOT NULL CHECK (genome_quality IN ('high', 'medium', 'low')),
  tool           text NOT NULL CHECK (tool = 'CheckM2'),
  source         text NOT NULL
) ON COMMIT DROP;

\copy uniform_qc_in FROM PROGRAM 'gzip -dc scripts/populator/data/qc/uniform_checkm2.tsv.gz' WITH (FORMAT csv, DELIMITER E'\t', HEADER true, NULL '')

-- Every row names an existing sample; GTDB rows only where GTDB has no values yet.
DO $$
DECLARE n_in int; n_match int; n_gtdb_filled int;
BEGIN
  SELECT count(*) INTO n_in FROM uniform_qc_in;
  SELECT count(*) INTO n_match FROM uniform_qc_in q JOIN samples s ON s.external_id = q.external_id;
  SELECT count(*) INTO n_gtdb_filled FROM uniform_qc_in q JOIN samples s ON s.external_id = q.external_id
   WHERE q.external_id LIKE 'gtdb|%' AND s.checkm_completeness IS NOT NULL;
  IF n_match <> n_in THEN RAISE EXCEPTION '% TSV rows, % match a sample', n_in, n_match; END IF;
  IF n_gtdb_filled > 0 THEN RAISE EXCEPTION '% GTDB rows already have values; GTDB keeps R232', n_gtdb_filled; END IF;
  RAISE NOTICE 'rows in: %', n_in;
END $$;

WITH upd AS (
  UPDATE samples s
     SET checkm_completeness  = q.completeness,
         checkm_contamination = q.contamination,
         genome_quality       = q.genome_quality,
         checkm_tool          = q.tool,
         checkm_source        = q.source
    FROM uniform_qc_in q
   WHERE s.external_id = q.external_id
  RETURNING 1
)
SELECT count(*) AS updated FROM upd \gset

SELECT :updated = (SELECT count(*) FROM uniform_qc_in) AS all_rows_updated \gset
\if :all_rows_updated
  \echo updated :updated samples
\else
  \echo 'updated row count differs from the TSV; rolling back'
  ROLLBACK;
  \quit
\endif

SELECT checkm_source, checkm_tool, genome_quality, count(*)
  FROM samples WHERE checkm_source IS NOT NULL GROUP BY 1, 2, 3 ORDER BY 1, 2, 3;

COMMIT;
