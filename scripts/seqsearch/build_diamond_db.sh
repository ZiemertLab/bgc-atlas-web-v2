#!/bin/bash
# Build the DIAMOND protein database behind sequence search.
#
#   build_diamond_db.sh <regions_prot.faa> <out-prefix> [exclude_ids.txt]
#
# <regions_prot.faa> comes from scripts/populator/tools/extract_sequences.py; headers
# are ">{bgcs.id}_{locus_tag}", so characters 2..37 are the region uuid. An optional file of
# BGC ids (one per line) is filtered out first. Writes <out-prefix>.dmnd beside any
# live database; point DIAMOND_PROTEIN_DB at it (without .dmnd) to switch.
# Env: DIAMOND (default: diamond on PATH), THREADS (default 64).
set -euo pipefail
IN=${1:?usage: build_diamond_db.sh <regions_prot.faa> <out-prefix> [exclude_ids.txt]}
OUT=${2:?usage: build_diamond_db.sh <regions_prot.faa> <out-prefix> [exclude_ids.txt]}
EXCLUDE=${3:-}
DIAMOND=${DIAMOND:-diamond}
THREADS=${THREADS:-64}

if [ -n "$EXCLUDE" ]; then
  FILTERED="$OUT.filtered.faa"
  LC_ALL=C awk -v report="$FILTERED.counts" '
    NR == FNR { rm[$1] = 1; next }
    /^>/ { keep = !(substr($0, 2, 36) in rm); if (keep) kept++; else dropped++ }
    keep { print }
    END { printf("kept_headers %d\ndropped_headers %d\n", kept, dropped) > report }
  ' "$EXCLUDE" "$IN" > "$FILTERED.tmp" && mv "$FILTERED.tmp" "$FILTERED"
  cat "$FILTERED.counts"
  IN=$FILTERED
fi

"$DIAMOND" --version
"$DIAMOND" makedb --in "$IN" --db "$OUT" -p "$THREADS"
"$DIAMOND" dbinfo --db "$OUT.dmnd"
echo "built $OUT.dmnd; its Sequences count should equal the FASTA's header count"
