#!/usr/bin/env bash
#SBATCH --job-name=v3-subset-hashdedup
#SBATCH --partition=compute
#SBATCH --nodes=1
#SBATCH --cpus-per-task=32
#SBATCH --mem=64G
#SBATCH --time=08:00:00
#SBATCH --output=/work/atlas-clustering-v2/logs/%x_%j.out
#SBATCH --error=/work/atlas-clustering-v2/logs/%x_%j.err
set -euo pipefail
V=/work/atlas-clustering-v2
CB=${CB:-/opt/miniforge3}
SEQKIT="$CB/envs/seqkit/bin/seqkit"
D="$V/dedup-v3"
source "$CB/etc/profile.d/conda.sh"; conda activate atlas-clustering

echo "[$(date '+%F %T')] 1) export v3 seed ids"
python "$V/scripts/v3/export_seed_v3.py"

echo "[$(date '+%F %T')] 2) seqkit grep -> seed_regions.fasta"
"$SEQKIT" grep -j 32 -f "$D/seed_ids.txt" "$V/input/regions_nuc.fasta" -o "$D/seed_regions.fasta"
echo "[$(date '+%F %T')] seed: $("$SEQKIT" stats -T "$D/seed_regions.fasta" | tail -1)"

echo "[$(date '+%F %T')] 3) sha256 exact-dedup"
python "$V/scripts/dedup/hash_dedup.py" --in "$D/seed_regions.fasta" \
  --out-fasta "$D/exact_unique.fasta" --out-membership "$D/exact_membership.parquet"
echo "[$(date '+%F %T')] done"
