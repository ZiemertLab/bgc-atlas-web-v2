#!/usr/bin/env bash
#SBATCH --job-name=tax-split
#SBATCH --partition=compute
#SBATCH --nodes=1
#SBATCH --cpus-per-task=16
#SBATCH --mem=32G
#SBATCH --time=04:00:00
#SBATCH --output=/work/atlas-clustering-v2/logs/%x_%j.out
#SBATCH --error=/work/atlas-clustering-v2/logs/%x_%j.err
#
# Split regions_nuc.fasta (scripts/populator/tools/extract_sequences.py) into 16 shards,
# one per taxonomy array task.

set -euo pipefail
V=/work/atlas-clustering-v2
CB=${CB:-/opt/miniforge3}
source "$CB/etc/profile.d/conda.sh"; conda activate seqkit

OUT="$V/taxonomy/shards"; mkdir -p "$OUT"
rm -f "$OUT"/regions_nuc.part_*.fasta
seqkit split2 -p 16 -j 16 "$V/input/regions_nuc.fasta" -O "$OUT"
for f in "$OUT"/regions_nuc.part_*.fasta; do printf "%s\t%s\n" "$(basename "$f")" "$(grep -c '^>' "$f")"; done
