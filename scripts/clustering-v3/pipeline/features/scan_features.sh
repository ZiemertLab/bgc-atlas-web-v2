#!/usr/bin/env bash
#SBATCH --job-name=v2-scan
#SBATCH --partition=compute
#SBATCH --nodes=1
#SBATCH --cpus-per-task=96
#SBATCH --mem=1900G
#SBATCH --time=12:00:00
#SBATCH --output=/work/atlas-clustering-v2/logs/%x_%j.out
#SBATCH --error=/work/atlas-clustering-v2/logs/%x_%j.err
# Decompresses input/all_regions_gbk.tar.gz once, then scans every member into features/shards/pooled/.
# source is the constant "pooled" because flat <uuid>.gbk names do not record it; concat_features.py adds it.
# Usage: sbatch scan_features.sh   (smoke test: sbatch --export=ALL,LIMIT=200000 scan_features.sh)

set -euo pipefail
V=/work/atlas-clustering-v2
GZ="$V/input/all_regions_gbk.tar.gz"
TAR="$V/input/all_regions_gbk.tar"

CB=${CB:-/opt/miniforge3}
source "$CB/etc/profile.d/conda.sh"
conda activate atlas-clustering

# Write to .partial then mv, so a killed run never leaves a truncated tar that the -s check trusts.
# gzip inflate is single-threaded even with pigz; extra cores only help the scan.
if [ ! -s "$TAR" ]; then
  echo "[$(date '+%F %T')] decompress $GZ -> $TAR"
  pigz -dc "$GZ" > "$TAR.partial"
  mv "$TAR.partial" "$TAR"
  echo "[$(date '+%F %T')] decompressed -> $(du -h "$TAR" | cut -f1)"
else
  echo "[$(date '+%F %T')] $TAR present ($(du -h "$TAR" | cut -f1)) — skip decompress"
fi

echo "[$(date '+%F %T')] scanning -> $V/features/shards/pooled/"
/usr/bin/time -v python "$V/scripts/features/scan_tar.py" \
  --tar "$TAR" --source pooled --out-dir "$V/features" \
  ${LIMIT:+--limit "$LIMIT"}
echo "[$(date '+%F %T')] scan done"
