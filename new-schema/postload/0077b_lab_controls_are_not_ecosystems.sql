-- Laboratory controls (mock communities, blanks) that inherited their study's ecosystem.
-- A bare "positive control" is not matched: some are real plants used as controls.

BEGIN;

UPDATE samples SET
    gold_ecosystem_path = CASE
        WHEN lower(concat_ws(' ', name, environment_biome, environment_feature,
                             environment_material)) ~ 'extraction blank|blank control'
            THEN 'Engineered:Lab enrichment'
        ELSE 'Engineered:Modeled:Simulated communities (microbial mixture)'
    END,
    gold_ecosystem_metadata = coalesce(gold_ecosystem_metadata, '{}'::jsonb)
        || jsonb_build_object('previous_path', gold_ecosystem_path,
                              'reclassified_at', now(),
                              'reclassify_reason', 'lab_control_not_an_ecosystem'),
    updated_at = now()
WHERE gold_ecosystem_path IS NOT NULL
  AND gold_ecosystem_path NOT LIKE 'Engineered:Modeled%'
  AND gold_ecosystem_path NOT LIKE 'Engineered:Lab%'
  AND lower(concat_ws(' ', name, environment_biome, environment_feature,
                      environment_material))
      ~ 'mock community|microbial control|extraction blank|blank control|zymobiomics|simulated communit';

COMMIT;
