-- Tier 1 metadata for the GTDB genomes the old atlas's dump lacked (the archaea).
-- Input: scripts/populator/data/gtdb/archaea_release_metadata.tsv.gz, written by
-- prepare_gtdb_archaea_metadata.py from ar53_metadata_r232.tsv.gz.
--
-- Only GTDB samples whose metadata has no gtdb_taxonomy are touched, so a re-run is a
-- no-op and no bacterium's dump-derived metadata is replaced.
--
-- Run as the owner, from the repo root:
--   psql "$OWNER_URL" -v ON_ERROR_STOP=1 -f scripts/populator/tools/backfill_gtdb_archaea_metadata.sql

\set ON_ERROR_STOP on
BEGIN;

CREATE TEMP TABLE gtdb_release_md_in (
  accession text PRIMARY KEY,
  metadata  jsonb NOT NULL
) ON COMMIT DROP;

\copy gtdb_release_md_in FROM PROGRAM 'gzip -dc scripts/populator/data/gtdb/archaea_release_metadata.tsv.gz' WITH (FORMAT csv, DELIMITER E'\t', HEADER true)

SELECT count(*) AS rows_in FROM gtdb_release_md_in;

UPDATE samples s
   SET metadata    = COALESCE(s.metadata, '{}'::jsonb) || m.metadata,
       genome_size = COALESCE(s.genome_size, (m.metadata->>'genome_size')::bigint),
       updated_at  = now()
  FROM gtdb_release_md_in m
 WHERE s.external_id = 'gtdb|' || m.accession
   AND NOT COALESCE(s.metadata, '{}'::jsonb) ? 'gtdb_taxonomy';

SELECT count(*) AS gtdb_without_taxonomy
  FROM samples
 WHERE external_id LIKE 'gtdb|%' AND NOT COALESCE(metadata, '{}'::jsonb) ? 'gtdb_taxonomy';

COMMIT;
