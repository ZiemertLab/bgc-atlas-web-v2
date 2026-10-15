#!/usr/bin/env bash
#SBATCH --job-name=v3-bigslice
#SBATCH --partition=compute
#SBATCH --nodes=1
#SBATCH --cpus-per-task=96
#SBATCH --mem=1900G
#SBATCH --time=5-00:00:00
#SBATCH --output=/work/atlas-clustering-v2/logs/%x_%j.out
#SBATCH --error=/work/atlas-clustering-v2/logs/%x_%j.err
# printf 'Y\n', not `yes Y`: yes dies of SIGPIPE, which fails the job under pipefail.
set -euo pipefail
V=/work/atlas-clustering-v2
CB=${CB:-/opt/miniforge3}
source "$CB/etc/profile.d/conda.sh"; conda activate bigslice2
IN="$V/bigslice-input-v3"
OUT="$V/bigslice-output-v3"
CHUNKS="--hmmscan_chunk_size 500 --subpfam_chunk_size 500 --extraction_chunk_size 500"
echo "[$(date '+%F %T')] v3 BiG-SLICE extract+cluster @0.4"
printf 'Y\n' | bigslice -i "$IN" "$OUT" --threshold 0.4 -t 96 $CHUNKS
echo "[$(date '+%F %T')] done -> $OUT/result/data.db"
