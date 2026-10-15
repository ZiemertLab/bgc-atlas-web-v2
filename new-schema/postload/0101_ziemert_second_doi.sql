-- 0101_ziemert_second_doi.sql
-- custom_ziemert_lab's two samples were published separately (GigaScience 2025 and
-- mSystems 2021); add the second DOI to the study. The pairing comes from
-- adapters/customs_metadata.py `_ZIEMERT_PAPER`.
--
-- `metadata->>'doi'` is already a comma-joined list elsewhere; the study API splits on
-- [,;]. The GigaScience DOI stays first and stays the `accession`.
-- Guarded on the single-DOI value, so it is re-runnable.

BEGIN;

UPDATE studies
   SET metadata = metadata || jsonb_build_object(
         'doi', '10.1093/gigascience/giaf135,10.1128/msystems.01018-21'),
       updated_at = now()
 WHERE accession = '10.1093/gigascience/giaf135'
   AND metadata->>'doi' = '10.1093/gigascience/giaf135';

COMMIT;
