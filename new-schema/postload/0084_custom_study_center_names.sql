-- 0084_custom_study_center_names.sql
-- backfill_custom_studies.py put the Crossref publisher into center_name for four studies;
-- replace it with the sequencing centre. Sources: ENA for PRJEB67368 (kept verbatim, as
-- other ENA values are), Crossref / Europe PMC author affiliations for the three DOIs.
-- Guarded on the publisher string, so a hand-corrected row is left alone.
--
-- study_bgc_summary holds a denormalised copy read by /studies. Bust the Redis
-- studies:list:v4* keys afterwards.

BEGIN;

UPDATE studies SET center_name = v.center, updated_at = now()
  FROM (VALUES
    ('PRJEB67368',                  'ETH ZURICH;MAX PLANCK INSTITUTE FOR MARINE MICROBIOLOGY'),
    ('10.1093/gigascience/giaf135', 'Ziemert Lab, University of Tübingen'),
    ('10.1038/s41597-026-06612-w',  'Portland State University'),
    ('10.1038/s41597-025-06166-3',  'Marine Biological Laboratory')
  ) AS v(accession, center)
 WHERE studies.accession = v.accession
   AND studies.center_name IN ('Oxford University Press (OUP)',
                               'Springer Science and Business Media LLC');

UPDATE study_bgc_summary sbs
   SET center_name = s.center_name
  FROM studies s
 WHERE s.id = sbs.study_id
   AND s.accession IN ('PRJEB67368', '10.1093/gigascience/giaf135',
                       '10.1038/s41597-026-06612-w', '10.1038/s41597-025-06166-3');

COMMIT;
