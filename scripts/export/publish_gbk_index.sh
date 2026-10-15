#!/usr/bin/env bash
#
# Publish the files that let anyone holding all_regions_gbk.tar.gz pull out
# single regions locally (scripts/export/extract_gbk.py):
#
#   all_regions_gbk.index.tsv.gz   the repacker's index, with a first line
#                                  "# archive sha256 <hex> size <bytes>"
#   bgc_id_redirects.tsv.gz        old_bgc_id -> current_bgc_id (bgc_redirect)
#   extract_gbk.py                 the extractor
#   <each>.sha256
#
#   DATABASE_URL=postgres://... scripts/export/publish_gbk_index.sh <repack index.tsv>
#
# cut_release.py runs this with DEST=<release staging dir>.
#
# Step 7 of an archive rebuild (after the offsets are loaded and bgc_browse is
# reindexed); a stale index makes the extractor refuse to run. Run from the repo root.

set -euo pipefail

INDEX=${1:?usage: DATABASE_URL=... $0 <repack index.tsv>}
: "${DATABASE_URL:?set DATABASE_URL (psql-compatible, no Prisma query parameters)}"
DEST=${DEST:-/data/bgc-atlas/data-v2/populator-out-sequences}
SITE=${SITE:-https://bgc-atlas.cs.uni-tuebingen.de}
ARCHIVE=$DEST/all_regions_gbk.tar.gz

size=$(stat -c%s "$ARCHIVE")
sha=$(cut -d' ' -f1 "$ARCHIVE.sha256")

# The last indexed region must end within the archive's final tar block.
end=$(tail -1 "$INDEX" | awk -F'\t' '{print $2 + $3}')
if (( end > size || size - end > 4096 )); then
  echo "index does not match $ARCHIVE: last region ends at $end, archive is $size bytes" >&2
  exit 1
fi
rows=$(wc -l < "$INDEX")
echo "index: $rows regions, matches $ARCHIVE ($size bytes, sha256 $sha)"

publish() {  # publish <name>, reading the content from stdin
  local tmp="$DEST/.$1.tmp"
  cat > "$tmp"
  echo "$(sha256sum "$tmp" | cut -d' ' -f1)  $1" > "$DEST/.$1.sha256.tmp"
  mv "$tmp" "$DEST/$1"
  mv "$DEST/.$1.sha256.tmp" "$DEST/$1.sha256"
  setfacl -m u:www-data:r "$DEST/$1" "$DEST/$1.sha256"
  echo "wrote $DEST/$1 ($(stat -c%s "$DEST/$1") bytes)"
}

{ echo "# archive sha256 $sha size $size"; cat "$INDEX"; } | nice -n 19 gzip -6 | publish all_regions_gbk.index.tsv.gz

psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -Atc \
  "\\copy (SELECT old_bgc_id, twin_bgc_id FROM bgc_redirect ORDER BY old_bgc_id) TO STDOUT" \
  | { printf 'old_bgc_id\tcurrent_bgc_id\n'; cat; } | gzip -9 | publish bgc_id_redirects.tsv.gz

publish extract_gbk.py < "$(dirname "$0")/extract_gbk.py"

# The repack only rewrites the archive's own .sha256; refresh its line in SHA256SUMS too.
names="all_regions_gbk.tar.gz all_regions_gbk.index.tsv.gz bgc_id_redirects.tsv.gz extract_gbk.py"
{
  grep -v -E "  ($(echo "$names" | sed 's/\./\\./g; s/ /|/g'))$" "$DEST/SHA256SUMS" 2>/dev/null || true
  for n in $names; do cat "$DEST/$n.sha256"; done
} > "$DEST/.SHA256SUMS.tmp"
mv "$DEST/.SHA256SUMS.tmp" "$DEST/SHA256SUMS"
setfacl -m u:www-data:r "$DEST/SHA256SUMS"
echo "updated $DEST/SHA256SUMS"

# Inside a release being cut (cut_release.py: DEST=releases/<id>.staging, CHECK_URLS=0) nothing is served
# from DEST yet; cut_release.py checks the URLs after it flips latest.
[[ ${CHECK_URLS:-1} == 1 ]] || exit 0
for f in all_regions_gbk.index.tsv.gz bgc_id_redirects.tsv.gz extract_gbk.py; do
  for g in "$f" "$f.sha256"; do
    code=$(curl -s -o /dev/null -I -w '%{http_code}' "$SITE/downloads/$g")
    echo "$code  $SITE/downloads/$g"
    [[ $code == 200 ]] || { echo "not served -- check the www-data ACL" >&2; exit 1; }
  done
done
