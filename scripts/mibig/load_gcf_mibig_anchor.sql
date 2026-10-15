-- Load gcf_mibig_anchor from build_gcf_mibig_anchor.py's CSV, which is keyed by family NAME:
--
--   psql -d bgc_atlas_v2 -v ON_ERROR_STOP=1 -f scripts/mibig/load_gcf_mibig_anchor.sql < gcf_mibig_anchor.csv
--
-- Replaces the whole table in one transaction. Rows naming a family that is not in gcfs are skipped: those are
-- MIBiG-only families (every member a MIBiG reference, so no atlas family). Fails if NO row resolves: the CSV
-- was then built for another clustering or with another name tag.
\set ON_ERROR_STOP on
BEGIN;
CREATE TEMP TABLE anchor_in (
  gcf_name text, mibig_accession text, compounds text[], chem_classes text[], producer text,
  mibig_version integer, mibig_status text, membership_distance real
);
\copy anchor_in FROM pstdin WITH (FORMAT csv, HEADER true)

DO $$
DECLARE resolved bigint; unresolved bigint;
BEGIN
  SELECT count(*) FILTER (WHERE g.id IS NOT NULL), count(*) FILTER (WHERE g.id IS NULL)
    INTO resolved, unresolved
    FROM anchor_in a LEFT JOIN gcfs g ON g.name = a.gcf_name;
  IF resolved = 0 THEN
    RAISE EXCEPTION 'no anchor row names a family in gcfs (CSV built for another clustering or name tag?)';
  END IF;
  RAISE NOTICE '% rows resolve to a family; % skipped (MIBiG-only families)', resolved, unresolved;
END $$;

TRUNCATE gcf_mibig_anchor;
INSERT INTO gcf_mibig_anchor (gcf_id, mibig_accession, compounds, chem_classes, producer, mibig_version,
                              mibig_status, membership_distance)
SELECT g.id, a.mibig_accession, a.compounds, a.chem_classes, nullif(a.producer, ''), a.mibig_version,
       a.mibig_status, a.membership_distance
FROM anchor_in a JOIN gcfs g ON g.name = a.gcf_name;
COMMIT;
ANALYZE gcf_mibig_anchor;
SELECT count(*) AS rows, count(DISTINCT gcf_id) AS families, count(DISTINCT mibig_accession) AS references
FROM gcf_mibig_anchor;
