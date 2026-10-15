-- Fill published CheckM values for MAG catalogs that had none. Input: scripts/populator/data/qc/genome_qc.tsv.gz, written by
-- prepare_genome_qc.py. Needs migration 0121 (checkm_tool / checkm_source).
--
-- Never overwrites: only rows whose checkm_completeness is still NULL are touched,
-- so a re-run is a no-op and values from a source's own ingest win.
--
-- Run as the owner, from the repo root:
--   psql "$OWNER_URL" -v ON_ERROR_STOP=1 -f scripts/populator/tools/backfill_genome_qc.sql

\set ON_ERROR_STOP on
BEGIN;

CREATE TEMP TABLE genome_qc_in (
  external_id    text PRIMARY KEY,
  completeness   numeric NOT NULL,
  contamination  numeric NOT NULL,
  genome_quality text NOT NULL,
  tool           text,
  source         text NOT NULL
) ON COMMIT DROP;

\copy genome_qc_in FROM PROGRAM 'gzip -dc scripts/populator/data/qc/genome_qc.tsv.gz' WITH (FORMAT csv, DELIMITER E'\t', HEADER true, NULL '')

SELECT count(*) AS rows_in FROM genome_qc_in;

UPDATE samples s
   SET checkm_completeness  = q.completeness,
       checkm_contamination = q.contamination,
       genome_quality       = q.genome_quality,
       checkm_tool          = q.tool,
       checkm_source        = q.source
  FROM genome_qc_in q
 WHERE s.external_id = q.external_id
   AND s.checkm_completeness IS NULL;

SELECT count(*) AS now_with_qc
  FROM samples s JOIN genome_qc_in q ON q.external_id = s.external_id
 WHERE s.checkm_completeness IS NOT NULL;

COMMIT;
