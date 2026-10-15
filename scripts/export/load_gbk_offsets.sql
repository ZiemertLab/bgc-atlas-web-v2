-- Reload bgc_gbk_offsets from a repack_regions_gbk.py index.
--
--   psql "$OWNER_DATABASE_URL" -v build=<sha256 of the archive> \
--        -f scripts/export/load_gbk_offsets.sql < /path/all_regions_gbk.index.tsv
--
-- The index arrives on stdin because \copy does not expand psql variables.
-- One-transaction swap, so readers never see a mix of builds; the PK is built after the load.

\set ON_ERROR_STOP on
SET statement_timeout = 0;

BEGIN;

CREATE TEMP TABLE gbk_index (name text, gbk_offset bigint, gbk_length integer, file_size bigint);
\copy gbk_index FROM pstdin

CREATE TABLE bgc_gbk_offsets_new (LIKE bgc_gbk_offsets);
INSERT INTO bgc_gbk_offsets_new (bgc_id, gbk_offset, gbk_length, archive_build)
SELECT left(name, 36)::uuid, gbk_offset, gbk_length, :'build'
  FROM gbk_index
 WHERE name ~ '^[0-9a-f-]{36}\.gbk$';
ALTER TABLE bgc_gbk_offsets_new ADD PRIMARY KEY (bgc_id);

DROP TABLE bgc_gbk_offsets;
ALTER TABLE bgc_gbk_offsets_new RENAME TO bgc_gbk_offsets;
ALTER INDEX bgc_gbk_offsets_new_pkey RENAME TO bgc_gbk_offsets_pkey;
GRANT SELECT ON bgc_gbk_offsets TO bgc_app;

COMMIT;

SELECT count(*) AS rows, min(archive_build) AS build FROM bgc_gbk_offsets;
