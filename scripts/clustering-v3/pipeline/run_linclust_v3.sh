#!/usr/bin/env bash
#SBATCH --job-name=v3-linclust
#SBATCH --partition=compute
#SBATCH --nodes=1
#SBATCH --cpus-per-task=64
#SBATCH --mem=490G
#SBATCH --time=12:00:00
#SBATCH --output=/work/atlas-clustering-v2/logs/%x_%j.out
#SBATCH --error=/work/atlas-clustering-v2/logs/%x_%j.err
# Usage: sbatch run_linclust_v3.sh [MIN_SEQ_ID_PERCENT]   (default 95)
set -euo pipefail
T="${1:-95}"
V=/work/atlas-clustering-v2
CB=${CB:-/opt/miniforge3}
MMSEQS="$CB/envs/mmseqs2/bin/mmseqs"
IN="$V/dedup-v3/exact_unique.fasta"
OUT="$V/dedup-v3/$T"
TMP="$OUT/tmp"
mkdir -p "$OUT"; rm -rf "$TMP"
MINID="$(python3 -c "print($T/100)")"
echo "[$(date '+%F %T')] linclust @${T}% on $IN"
/usr/bin/time -v "$MMSEQS" easy-linclust "$IN" "$OUT/linclust" "$TMP" \
  --min-seq-id "$MINID" -c 0.8 --cov-mode 0 --threads 64 --split-memory-limit 400G
echo "[$(date '+%F %T')] done -> $OUT/linclust_cluster.tsv"
wc -l "$OUT/linclust_cluster.tsv"; grep -c '^>' "$OUT/linclust_rep_seq.fasta" || true
