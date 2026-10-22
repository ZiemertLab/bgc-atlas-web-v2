-- Map for gcf_scalar_patch.py: eco_l1_any .. eco_l5_any, one row per LISTED family
-- (exactly the documents gcf_browse holds). Share fields, part 2.
--
-- For the Ecosystem share filter's "any member" threshold. Procedure: docs/runbooks/post-load-refresh.md
-- section 4, "Share fields".
--
-- eco_l<n>_any = the keys of gcf_distributions_mv.biome_distribution_l<n>, sorted.
-- That is the set the SQL fallback tests (jsonb_exists_any on the same jsonb),
-- and build_browse_corpus.py selects the identical expression, so a rebuild and
-- this patch write the same lists. Checked 2026-10-22 (read-only):
--   * a key exists iff >= 1 resolved member has that ecosystem -- at L3 the
--     1,072,250 (family, ecosystem) key pairs equal the member pairs of
--     gcf_member_ecosystem_mv exactly; 2,840 L3 keys show 0.0 (1-dp rounding of
--     a real member), and they are kept;
--   * L1 carries the synthetic 'Host-assoc.: Plants' bucket, as eco_l1_ge* and
--     dom_ecosystem_l1 do (99,330 families have the key);
--   * every eco_l<n>_ge10 list is a subset of these keys;
--   * keys non-empty <=> resolved_pct_l<n> > 0, for every listed family.
--
-- Run with psql in UNALIGNED, TAB-SEPARATED, TUPLES-ONLY mode; the first output
-- line is the header gcf_scalar_patch.py requires:
--
--   psql -d bgc_atlas_v2 -X -At -F$'\t' -v ON_ERROR_STOP=1 \
--        -f scripts/populator/tools/gcf_share_fields_any_map.sql > share_any.tsv
--
-- Optional: -v lim=1000 (LIMIT, default ALL), -v only_gcf=<uuid>.
--
-- Encoding, per gcf_scalar_patch.py's MAP FORMAT: lists joined on chr(31) (the
-- --list separator); an EMPTY cell removes the field (a family with no resolved
-- member at that level), which every `terms` query treats as the corpus's [].
--
-- Read-only; no bgcs. A minimal map (6 columns) rather than an extension of
-- gcf_share_fields_map.sql, so this patch re-sends nothing that patch
-- already wrote.

\set QUIET on

\if :{?lim}
\else
  \set lim ALL
\endif
\if :{?only_gcf}
\else
  \set only_gcf ''
\endif

SET statement_timeout = '300s';

SELECT 'gcf_id', 'eco_l1_any', 'eco_l2_any', 'eco_l3_any', 'eco_l4_any', 'eco_l5_any';

SELECT g.id,
       COALESCE(array_to_string(ARRAY(SELECT k FROM jsonb_object_keys(COALESCE(d.biome_distribution_l1, '{}'::jsonb)) k ORDER BY k), chr(31)), ''),
       COALESCE(array_to_string(ARRAY(SELECT k FROM jsonb_object_keys(COALESCE(d.biome_distribution_l2, '{}'::jsonb)) k ORDER BY k), chr(31)), ''),
       COALESCE(array_to_string(ARRAY(SELECT k FROM jsonb_object_keys(COALESCE(d.biome_distribution_l3, '{}'::jsonb)) k ORDER BY k), chr(31)), ''),
       COALESCE(array_to_string(ARRAY(SELECT k FROM jsonb_object_keys(COALESCE(d.biome_distribution_l4, '{}'::jsonb)) k ORDER BY k), chr(31)), ''),
       COALESCE(array_to_string(ARRAY(SELECT k FROM jsonb_object_keys(COALESCE(d.biome_distribution_l5, '{}'::jsonb)) k ORDER BY k), chr(31)), '')
FROM gcfs g
LEFT JOIN gcf_distributions_mv d ON d.gcf_id = g.id
WHERE g.listed
  AND (:'only_gcf' = '' OR g.id = NULLIF(:'only_gcf', '')::uuid)
LIMIT :lim;
