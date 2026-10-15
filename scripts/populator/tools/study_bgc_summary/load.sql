-- Load the DuckDB-built CSVs into study_bgc_summary, study_gcf and gcf_study_count.
-- Run after reviewing build.py's SANITY output.
--
-- \copy doesn't expand psql variables, so run psql from the build --workdir:
--
--   cd <workdir>
--   psql "$DATABASE_URL" -f /path/to/load.sql
--
-- CSV column order matches the table definitions.

\set ON_ERROR_STOP on

BEGIN;

TRUNCATE study_bgc_summary;
TRUNCATE gcf_study_count;
TRUNCATE study_gcf;

\copy gcf_study_count   FROM 'gcf_study_count.csv'   WITH (FORMAT csv, HEADER true)
\copy study_bgc_summary FROM 'study_bgc_summary.csv' WITH (FORMAT csv, HEADER true)
\copy study_gcf         FROM 'study_gcf.csv'         WITH (FORMAT csv, HEADER true)

COMMIT;

ANALYZE gcf_study_count;
ANALYZE study_bgc_summary;
ANALYZE study_gcf;

SELECT 'gcf_study_count'   AS tbl, count(*) AS rows,
       count(*) FILTER (WHERE study_count = 1) AS exclusive_gcfs
FROM gcf_study_count
UNION ALL
SELECT 'study_bgc_summary', count(*),
       count(*) FILTER (WHERE exclusive_gcfs > 0)
FROM study_bgc_summary
UNION ALL
SELECT 'study_gcf', count(*), count(*) FILTER (WHERE is_exclusive)
FROM study_gcf;
