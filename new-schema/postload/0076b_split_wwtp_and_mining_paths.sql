-- Split two over-broad GOLD categories into specific GOLD paths:
-- 1. Engineered:WWTP -> the Engineered:Wastewater leaf for the sample's material.
-- 2. The Acid Mine Drainage bucket, which SPIRE's crosswalk filled from a generic
--    'anthropogenic:mine' code (fixed at source in adapters/spire_metadata.py).
-- Reversible: each write records gold_ecosystem_metadata->>'previous_path'.

BEGIN;

CREATE TEMP TABLE _split(id uuid PRIMARY KEY, newp text, why text) ON COMMIT DROP;

INSERT INTO _split(id, newp, why)
SELECT s.id,
       CASE lower(trim(s.environment_material))
           WHEN 'activated sludge'   THEN 'Engineered:Wastewater:Activated Sludge'
           WHEN 'sewage'             THEN 'Engineered:Wastewater:Sewage'
           WHEN 'sludge'             THEN 'Engineered:Wastewater:Sludge'
           WHEN 'raw primary sludge' THEN 'Engineered:Wastewater:Sludge'
           WHEN 'biosolids'          THEN 'Engineered:Wastewater:Sludge'
           ELSE 'Engineered:Wastewater'      -- waste water, surface water
       END,
       'wwtp_material_split'
FROM samples s
WHERE s.gold_ecosystem_path = 'Engineered:WWTP'
  -- Samples whose feature is "WWTP" carry no usable material and stay.
  AND lower(coalesce(s.environment_feature, '')) <> 'wwtp';

-- Ordered most-specific-first; ON CONFLICT DO NOTHING keeps the first claim.
INSERT INTO _split(id, newp, why)
SELECT s.id,
       CASE
           WHEN lower(s.environment_feature) = 'acid mine drainage'
                AND lower(s.environment_material) = 'sediment'
               THEN 'Engineered:Wastewater:Industrial wastewater:Acid mine drainage:Sediment'
           WHEN lower(s.environment_feature) = 'acid mine drainage'
                AND lower(s.environment_material) = 'groundwater'
               THEN 'Environmental:Aquatic:Freshwater:Groundwater:Acid Mine Drainage'
           WHEN lower(s.environment_material) LIKE 'acid mine%'
                OR lower(s.environment_biome) = 'acid mine drainage'
               THEN 'Engineered:Wastewater:Industrial wastewater:Acid mine drainage'
           -- Not AMD from here on.
           WHEN lower(s.environment_biome) LIKE 'tailling pond%'
               THEN 'Engineered:Built environment:Tailings pond'
           WHEN lower(s.environment_biome) = 'produced water'
               THEN 'Engineered:Wastewater:Industrial wastewater:Mine water:Produced water'
           WHEN lower(s.environment_biome) = 'oilsands'
               THEN 'Engineered:Built environment:Mine:Oil sands'
           WHEN lower(s.environment_biome) = 'coal bed'
               THEN 'Environmental:Terrestrial:Deep subsurface:Coal mine'
           WHEN lower(s.environment_feature) = 'deep subsurface'
               THEN 'Environmental:Terrestrial:Deep subsurface'
           ELSE 'Environmental:Terrestrial:Geologic:Mine'
       END,
       'amd_bucket_split'
FROM samples s
WHERE s.gold_ecosystem_path = 'Environmental:Aquatic:Freshwater:Groundwater:Acid Mine Drainage'
ON CONFLICT (id) DO NOTHING;

UPDATE samples AS s SET
    gold_ecosystem_path = x.newp,
    gold_ecosystem_metadata = coalesce(s.gold_ecosystem_metadata, '{}'::jsonb)
        || jsonb_build_object('previous_path', s.gold_ecosystem_path,
                              'reclassified_at', now(),
                              'reclassify_reason', x.why),
    updated_at = now()
FROM _split x
WHERE s.id = x.id
  AND s.gold_ecosystem_path IS DISTINCT FROM x.newp;

COMMIT;
