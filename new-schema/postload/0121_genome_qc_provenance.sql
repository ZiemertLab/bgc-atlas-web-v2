-- Migration 0121: record where each genome's CheckM values came from (they were computed
-- by different groups with different tools), and relabel GTDB genome_quality by the same
-- MIMAG rule as every other source (all GTDB genomes were loaded as 'high').
-- The published values themselves are filled by scripts/populator/tools/backfill_genome_qc.sql.

ALTER TABLE samples ADD COLUMN IF NOT EXISTS checkm_tool text;
ALTER TABLE samples ADD COLUMN IF NOT EXISTS checkm_source text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'samples_checkm_tool_check' AND conrelid = 'samples'::regclass) THEN
    ALTER TABLE samples ADD CONSTRAINT samples_checkm_tool_check
      CHECK (checkm_tool IS NULL OR checkm_tool IN ('CheckM', 'CheckM2'));
  END IF;
END $$;

COMMENT ON COLUMN samples.checkm_tool IS
  'Tool behind checkm_completeness/contamination: CheckM (v1) or CheckM2; NULL when '
  'the source does not say. Migration 0121.';
COMMENT ON COLUMN samples.checkm_source IS
  'Where checkm_completeness/contamination were read from. Migration 0121.';

UPDATE samples s SET checkm_tool = 'CheckM', checkm_source = 'GTDB R232 metadata'
  FROM data_sources ds
 WHERE ds.id = s.data_source_ids[1] AND ds.name = 'GTDB'
   AND s.checkm_completeness IS NOT NULL AND s.checkm_source IS NULL;

UPDATE samples s SET checkm_tool = 'CheckM', checkm_source = 'GEM genome metadata (JGI/IMG)'
  FROM data_sources ds
 WHERE ds.id = s.data_source_ids[1] AND ds.name = 'GEM'
   AND s.checkm_completeness IS NOT NULL AND s.checkm_source IS NULL;

UPDATE samples s SET checkm_source = 'SMAG genome QC (Zenodo)'
  FROM data_sources ds
 WHERE ds.id = s.data_source_ids[1] AND ds.name = 'SMAG'
   AND s.checkm_completeness IS NOT NULL AND s.checkm_source IS NULL;

UPDATE samples s
   SET genome_quality = CASE
         WHEN s.checkm_completeness >= 90 AND s.checkm_contamination <= 5 THEN 'high'
         WHEN s.checkm_completeness >= 50 AND s.checkm_contamination < 10 THEN 'medium'
         ELSE 'low' END
  FROM data_sources ds
 WHERE ds.id = s.data_source_ids[1] AND ds.name = 'GTDB'
   AND s.checkm_completeness IS NOT NULL AND s.checkm_contamination IS NOT NULL;

-- Rollback: the provenance columns can be dropped; GTDB's previous genome_quality
-- was 'high' on every row that had CheckM values:
--   UPDATE samples s SET genome_quality = 'high' FROM data_sources ds
--    WHERE ds.id = s.data_source_ids[1] AND ds.name = 'GTDB' AND s.checkm_completeness IS NOT NULL;
--   ALTER TABLE samples DROP COLUMN checkm_tool, DROP COLUMN checkm_source;
