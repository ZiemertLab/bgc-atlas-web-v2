#!/usr/bin/env bash
# Extract the two BiG-SLiCE data.db tables the bgc_gcf build needs.
#
# One table per query, no join against `bgc` in SQLite: random seeks into the 33 GB file
# on CephFS take hours, two sequential scans take minutes. DuckDB joins them afterwards.
set -euo pipefail
# Bundle and build dirs as in bundle_config.py.
V3=${CLUSTERING_SRC:-/data/bgc-atlas/data-v2/clustering-v3}
OUT=${CLUSTERING_BUILD:-/data/bgc-atlas/data-v2/clustering-v3-build}/in
mkdir -p "$OUT"

dump() {  # dump <db> <sql> <outfile>
  local db=$1 sql=$2 out=$3
  echo "-> $out"
  sqlite3 -readonly -noheader -separator $'\t' "file:${db}?mode=ro" "$sql" > "$out"
  echo "   $(wc -l < "$out") rows"
}

MAIN=$V3/bigslice-output-v3/result/data.db
RES=$V3/bigslice-output-residual-v3/result/data.db

# Main atlas (single clustering, @0.4).
dump "$MAIN" "SELECT id, name FROM bgc;" "$OUT/main_bgc.tsv"
dump "$MAIN" "SELECT bgc_id, gcf_id, membership_value FROM gcf_membership WHERE rank=0;" \
     "$OUT/main_membership.tsv"

# Residual: clustering_id 1 = @0.4; 2 = @0.7 is unused.
dump "$RES" "SELECT id, name FROM bgc;" "$OUT/residual_bgc.tsv"
dump "$RES" "SELECT m.bgc_id, m.gcf_id, m.membership_value FROM gcf_membership m
             JOIN gcf g ON g.id = m.gcf_id WHERE m.rank=0 AND g.clustering_id=1;" \
     "$OUT/residual_membership.tsv"
# This joins only the small, contiguous `gcf` table.

echo DONE
