#!/usr/bin/env bash
#SBATCH --job-name=v3-residcont-search
#SBATCH --partition=compute
#SBATCH --nodes=1
#SBATCH --cpus-per-task=96
#SBATCH --mem=490G
#SBATCH --time=1-00:00:00
#SBATCH --output=/work/atlas-clustering-v2/logs/%x_%j.out
#SBATCH --error=/work/atlas-clustering-v2/logs/%x_%j.err
# Same containment parameters as run_easy_search_v3.sh, including --max-seq-len.
set -euo pipefail
V=/work/atlas-clustering-v2
CB=${CB:-/opt/miniforge3}
MMSEQS="$CB/envs/mmseqs2/bin/mmseqs"
C="$V/residcont-v3"
TMP="$C/es_tmp"
rm -rf "$TMP"; mkdir -p "$TMP"

echo "[$(date '+%F %T')] easy-search $(grep -c '^>' "$C/queries_unique.fasta") queries vs residual reps"
/usr/bin/time -v "$MMSEQS" easy-search \
  "$C/queries_unique.fasta" "$C/targets.fasta" "$C/easy_search.m8" "$TMP" \
  --search-type 3 --cov-mode 2 -c 0.8 --min-seq-id 0.9 --max-seqs 5 \
  --format-output "query,target,pident,qcov,tcov,bits" --max-seq-len 1000000 \
  --split-memory-limit 400G --threads 96
echo "[$(date '+%F %T')] done -> $C/easy_search.m8 ($(wc -l < "$C/easy_search.m8") hits)"
