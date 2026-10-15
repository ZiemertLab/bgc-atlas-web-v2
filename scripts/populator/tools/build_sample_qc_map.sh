#!/usr/bin/env bash
# Map for patching the five genome-QC fields of sample_browse with gcf_scalar_patch.py, read from the
# database AFTER a QC load (load_uniform_checkm2.sql, backfill_genome_qc.sql).
#
# Covers every document the index holds -- the same selection as build_browse_corpus.py's "samples"
# corpus (sample_summary rows with an external_id) -- because gcf_scalar_patch.py refuses the alias swap
# when a scrolled document is missing from the map. An empty cell removes the field, which is what a
# sample without QC should look like.
#
# Usage: build_sample_qc_map.sh <out.tsv>        (DATABASE_URL in the environment)
#   then: gcf_scalar_patch.py <out.tsv> <os-url> <src index> <dst index> \
#           --id-field sample_id --alias sample_browse
set -euo pipefail
out=${1:?usage: build_sample_qc_map.sh <out.tsv>}
PGOPTIONS='-c statement_timeout=0' psql "${DATABASE_URL:?}" -v ON_ERROR_STOP=1 -At -F$'\t' \
  -c "SELECT 'sample_id','checkm_completeness','checkm_contamination','genome_quality','checkm_tool','checkm_source'" \
  -c "SELECT sb.id::text,
             COALESCE(s.checkm_completeness::text, ''), COALESCE(s.checkm_contamination::text, ''),
             COALESCE(s.genome_quality, ''), COALESCE(s.checkm_tool, ''), COALESCE(s.checkm_source, '')
        FROM sample_summary sb JOIN samples s ON s.id = sb.id
       WHERE sb.external_id IS NOT NULL
       ORDER BY sb.id" > "$out"
echo "$(($(wc -l < "$out") - 1)) samples -> $out"
