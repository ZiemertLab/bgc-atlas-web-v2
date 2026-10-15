#!/usr/bin/env bash
# Download GTDB release metadata and extract the 3-column geo lookup
# (accession, ncbi_country, ncbi_lat_lon) consumed by backfill_gtdb_geo.py.
# Re-pin the release via REL/SUB; column positions are checked below.
#
# Usage: bash scripts/populator/tools/fetch_gtdb_release_metadata.sh
set -euo pipefail

REL=232
SUB=232.0
BASE="https://data.gtdb.ecogenomic.org/releases/release${REL}/${SUB}"
OUT=/data/bgc-atlas/data-v2/gtdb-release
mkdir -p "$OUT"
cd "$OUT"

echo "downloading bac120 + ar53 metadata for r${REL} ..."
curl -fsS -o "bac120_metadata_r${REL}.tsv.gz" "${BASE}/bac120_metadata_r${REL}.tsv.gz" &
curl -fsS -o "ar53_metadata_r${REL}.tsv.gz"   "${BASE}/ar53_metadata_r${REL}.tsv.gz" &
wait

hdr=$(zcat "bac120_metadata_r${REL}.tsv.gz" | head -1)
[ "$(echo "$hdr" | cut -f1)"  = "accession"     ] || { echo "col1 != accession" >&2; exit 1; }
[ "$(echo "$hdr" | cut -f56)" = "ncbi_country"  ] || { echo "col56 != ncbi_country" >&2; exit 1; }
[ "$(echo "$hdr" | cut -f63)" = "ncbi_lat_lon"  ] || { echo "col63 != ncbi_lat_lon" >&2; exit 1; }

echo "extracting geo_r${REL}.tsv (accession, ncbi_country, ncbi_lat_lon) ..."
{ zcat "bac120_metadata_r${REL}.tsv.gz"; zcat "ar53_metadata_r${REL}.tsv.gz" | tail -n +2; } \
  | awk -F'\t' 'NR==1{next}{print $1"\t"$56"\t"$63}' > "geo_r${REL}.tsv"

wc -l "geo_r${REL}.tsv"
echo "done -> ${OUT}/geo_r${REL}.tsv"
