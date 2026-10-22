-- Map for gcf_scalar_patch.py: the share fields of gcf_distributions_mv, one row
-- per LISTED family (exactly the documents gcf_browse holds). Only for patching an
-- existing gcf_browse index; build_browse_corpus.py writes the same fields into a new
-- one. The procedure (patch flags, verification, alias swap, rollback) is in
-- docs/runbooks/post-load-refresh.md section 4, "Share fields".
--
-- Run it with psql in UNALIGNED, TAB-SEPARATED, TUPLES-ONLY mode. The first
-- output line is the header gcf_scalar_patch.py requires:
--
--   psql -d bgc_atlas_v2 -X -At -F$'\t' -v ON_ERROR_STOP=1 \
--        -f scripts/populator/tools/gcf_share_fields_map.sql > share.tsv
--
-- Optional variables, for a sample rather than the whole map:
--   -v lim=1000                         LIMIT (default ALL)
--   -v only_gcf=<uuid>                  one family (default: every listed one)
--
-- Encoding, per gcf_scalar_patch.py's MAP FORMAT:
--   * an EMPTY cell removes the field from the document. NULL numerics/keywords
--     and EMPTY arrays become ''. An empty threshold array and an absent field
--     answer every `term` query identically; the corpus writes [] instead.
--   * arrays are joined on chr(31) (the --list separator).
--   * jsonb is written as its JSON text (the --json columns); '{}' stays '{}'.
--
-- Why the older columns are re-sent too (max_pct_l*, dom_ecosystem_l1/_l3,
-- biome_distribution_l*): the share columns came with a view that counts each member
-- once, and an index built before it holds the values the old view computed. A
-- column patched from a newer view than its neighbours is how the browse index
-- and the SQL fallback come to disagree about one family.
--
-- Read-only; seq-scans gcfs (800k rows) and gcf_distributions_mv once, hash join.
-- No bgcs.

-- QUIET: otherwise `SET` is printed as line 1 and the header check fails.
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

SELECT 'gcf_id', 'product_type_member_share',
       'product_types_ge10', 'product_types_ge50', 'product_types_ge90',
       'eco_l1_ge10', 'eco_l1_ge50', 'eco_l1_ge90',
       'eco_l2_ge10', 'eco_l2_ge50', 'eco_l2_ge90',
       'eco_l3_ge10', 'eco_l3_ge50', 'eco_l3_ge90',
       'eco_l4_ge10', 'eco_l4_ge50', 'eco_l4_ge90',
       'eco_l5_ge10', 'eco_l5_ge50', 'eco_l5_ge90',
       'resolved_pct_l1', 'resolved_pct_l2', 'resolved_pct_l3', 'resolved_pct_l4', 'resolved_pct_l5',
       'dom_ecosystem_l1', 'dom_ecosystem_l2', 'dom_ecosystem_l3', 'dom_ecosystem_l4', 'dom_ecosystem_l5',
       'max_pct_l1', 'max_pct_l2', 'max_pct_l3', 'max_pct_l4', 'max_pct_l5',
       'biome_distribution_l1', 'biome_distribution_l2', 'biome_distribution_l3',
       'biome_distribution_l4', 'biome_distribution_l5';

SELECT g.id,
       COALESCE(d.product_type_member_share, '{}'::jsonb)::text,
       COALESCE(array_to_string(d.product_types_ge10, chr(31)), ''),
       COALESCE(array_to_string(d.product_types_ge50, chr(31)), ''),
       COALESCE(array_to_string(d.product_types_ge90, chr(31)), ''),
       COALESCE(array_to_string(d.eco_l1_ge10, chr(31)), ''),
       COALESCE(array_to_string(d.eco_l1_ge50, chr(31)), ''),
       COALESCE(array_to_string(d.eco_l1_ge90, chr(31)), ''),
       COALESCE(array_to_string(d.eco_l2_ge10, chr(31)), ''),
       COALESCE(array_to_string(d.eco_l2_ge50, chr(31)), ''),
       COALESCE(array_to_string(d.eco_l2_ge90, chr(31)), ''),
       COALESCE(array_to_string(d.eco_l3_ge10, chr(31)), ''),
       COALESCE(array_to_string(d.eco_l3_ge50, chr(31)), ''),
       COALESCE(array_to_string(d.eco_l3_ge90, chr(31)), ''),
       COALESCE(array_to_string(d.eco_l4_ge10, chr(31)), ''),
       COALESCE(array_to_string(d.eco_l4_ge50, chr(31)), ''),
       COALESCE(array_to_string(d.eco_l4_ge90, chr(31)), ''),
       COALESCE(array_to_string(d.eco_l5_ge10, chr(31)), ''),
       COALESCE(array_to_string(d.eco_l5_ge50, chr(31)), ''),
       COALESCE(array_to_string(d.eco_l5_ge90, chr(31)), ''),
       COALESCE(d.resolved_pct_l1::text, ''), COALESCE(d.resolved_pct_l2::text, ''),
       COALESCE(d.resolved_pct_l3::text, ''), COALESCE(d.resolved_pct_l4::text, ''),
       COALESCE(d.resolved_pct_l5::text, ''),
       COALESCE(d.dom_ecosystem_l1, ''), COALESCE(d.dom_ecosystem_l2, ''),
       COALESCE(d.dom_ecosystem_l3, ''), COALESCE(d.dom_ecosystem_l4, ''),
       COALESCE(d.dom_ecosystem_l5, ''),
       COALESCE(d.max_pct_l1::text, ''), COALESCE(d.max_pct_l2::text, ''),
       COALESCE(d.max_pct_l3::text, ''), COALESCE(d.max_pct_l4::text, ''),
       COALESCE(d.max_pct_l5::text, ''),
       COALESCE(d.biome_distribution_l1, '{}'::jsonb)::text,
       COALESCE(d.biome_distribution_l2, '{}'::jsonb)::text,
       COALESCE(d.biome_distribution_l3, '{}'::jsonb)::text,
       COALESCE(d.biome_distribution_l4, '{}'::jsonb)::text,
       COALESCE(d.biome_distribution_l5, '{}'::jsonb)::text
FROM gcfs g
LEFT JOIN gcf_distributions_mv d ON d.gcf_id = g.id
WHERE g.listed
  AND (:'only_gcf' = '' OR g.id = NULLIF(:'only_gcf', '')::uuid)
LIMIT :lim;
