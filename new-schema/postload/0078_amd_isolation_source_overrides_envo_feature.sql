-- Two AMD corrections to the GOLD reclassification, matching what iso_classify now emits.
-- 1. An isolation_source naming AMD outranks a generic ENVO "Deep subsurface" feature.
-- 2. AMD sediment was swallowed by the generic sediment rule (now reordered in
--    adapters/gtdb_ecosystem.py).

BEGIN;

UPDATE samples SET
    gold_ecosystem_path = 'Engineered:Wastewater:Industrial wastewater:Acid mine drainage',
    gold_ecosystem_metadata = gold_ecosystem_metadata
        || jsonb_build_object('previous_path', gold_ecosystem_path,
                              'reclassified_at', now(),
                              'reclassify_reason', 'amd_isolation_source_beats_envo_feature'),
    updated_at = now()
WHERE gold_ecosystem_path = 'Environmental:Terrestrial:Deep subsurface'
  AND lower(metadata->>'ncbi_isolation_source') LIKE 'acid mine drainage%'
  AND lower(coalesce(metadata->>'ncbi_isolation_source','')) NOT LIKE '%sediment%';

UPDATE samples SET
    gold_ecosystem_path = 'Engineered:Wastewater:Industrial wastewater:Acid mine drainage:Sediment',
    gold_ecosystem_metadata = coalesce(gold_ecosystem_metadata, '{}'::jsonb)
        || jsonb_build_object('previous_path', gold_ecosystem_path,
                              'reclassified_at', now(),
                              'reclassify_reason', 'amd_sediment_outranked_by_generic_sediment'),
    updated_at = now()
WHERE gold_ecosystem_path = 'Environmental:Aquatic:Sediment'
  AND lower(metadata->>'ncbi_isolation_source') LIKE '%acid mine drainage%sediment%';

COMMIT;
