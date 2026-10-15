-- GTDB genome QC is CheckM2, not CheckM as 0121 labelled it (the metadata records
-- quality_tool = 'CheckM2'). Only the label changes.
--
-- Rollback:
--   UPDATE samples SET checkm_tool = 'CheckM'
--    WHERE checkm_source = 'GTDB R232 metadata' AND checkm_tool = 'CheckM2';
-- (that would also relabel the archaea, which were never 'CheckM').

BEGIN;

UPDATE samples
   SET checkm_tool = 'CheckM2'
 WHERE checkm_source = 'GTDB R232 metadata'
   AND checkm_tool = 'CheckM';

COMMIT;
