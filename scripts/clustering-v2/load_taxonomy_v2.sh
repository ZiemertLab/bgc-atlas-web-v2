#!/usr/bin/env bash
# taxonomy v2: stage the build files, then populate bgc_taxonomy. Writes only bgc_taxonomy,
# the tax_stage_* tables and appends to taxonomies. Idempotent (each step truncates first).
#
# Requires: new-schema/load-staging/0071_taxonomy_v2_schema.sql applied and the
# build_taxonomy_v2.py outputs.
#
#   DBURL=... ./load_taxonomy_v2.sh [load_dir]
set -euo pipefail

LOAD_DIR="${1:-/data/bgc-atlas/data-v2/clustering-v2/taxonomy/load-v2}"
: "${DBURL:?set DBURL to the bgc_atlas_v2 connection string}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# The DATABASE_URL pins statement_timeout=120000 and a URL-level `options=` beats
# PGOPTIONS, so lift it with an in-session SET ahead of each \copy.
PSQL=(psql "$DBURL" -v ON_ERROR_STOP=1 -q -c "SET statement_timeout = 0")

for f in taxonomies_new.tsv bgc_pred_tax.tsv gtdb_asm_tax.tsv; do
  [[ -s "$LOAD_DIR/$f" ]] || { echo "missing or empty: $LOAD_DIR/$f" >&2; exit 1; }
done

echo "[1/4] truncate staging"
"${PSQL[@]}" -c "TRUNCATE tax_stage_lineages, tax_stage_pred, tax_stage_gtdb;"

# Column order must match build_taxonomy_v2.py.
echo "[2/4] tax_stage_lineages  <- taxonomies_new.tsv"
"${PSQL[@]}" -c "\copy tax_stage_lineages FROM '$LOAD_DIR/taxonomies_new.tsv' WITH (FORMAT text)"

# An absent support is written as an empty field.
echo "[3/4] tax_stage_pred (16.4M)  <- bgc_pred_tax.tsv"
"${PSQL[@]}" -c "\copy tax_stage_pred FROM '$LOAD_DIR/bgc_pred_tax.tsv' WITH (FORMAT text, NULL '')"

echo "[4/4] tax_stage_gtdb  <- gtdb_asm_tax.tsv"
"${PSQL[@]}" -c "\copy tax_stage_gtdb FROM '$LOAD_DIR/gtdb_asm_tax.tsv' WITH (FORMAT text)"

"${PSQL[@]}" -At -c "SELECT 'tax_stage_lineages',count(*) FROM tax_stage_lineages
  UNION ALL SELECT 'tax_stage_pred',count(*) FROM tax_stage_pred
  UNION ALL SELECT 'tax_stage_gtdb',count(*) FROM tax_stage_gtdb;"

echo "populating bgc_taxonomy ..."
psql "$DBURL" -v ON_ERROR_STOP=1 -f "$HERE/load_taxonomy_v2.sql"

echo "done. Next: verify_taxonomy_v2.sql, then drop the tax_stage_* tables (new-schema/README.md)."
