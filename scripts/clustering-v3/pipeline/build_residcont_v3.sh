#!/usr/bin/env bash
#SBATCH --job-name=v3-residcont-build
#SBATCH --partition=compute
#SBATCH --nodes=1
#SBATCH --cpus-per-task=32
#SBATCH --mem=64G
#SBATCH --time=08:00:00
#SBATCH --output=/work/atlas-clustering-v2/logs/%x_%j.out
#SBATCH --error=/work/atlas-clustering-v2/logs/%x_%j.err
# Prep for placing still-unclustered BGCs against the residual reps by containment.
set -euo pipefail
V=/work/atlas-clustering-v2
CB=${CB:-/opt/miniforge3}
SEQKIT="$CB/envs/seqkit/bin/seqkit"
MMSEQS="$CB/envs/mmseqs2/bin/mmseqs"
NUC="$V/input/regions_nuc.fasta"
C="$V/residcont-v3"
source "$CB/etc/profile.d/conda.sh"; conda activate atlas-clustering

echo "[$(date '+%F %T')] 1) export ids"
python "$V/scripts/v3/export_residcont_ids_v3.py"

echo "[$(date '+%F %T')] 2) seqkit grep queries"
"$SEQKIT" grep -j 32 -f "$C/query_ids.txt" "$NUC" -o "$C/queries.fasta"
echo "[$(date '+%F %T')] queries: $("$SEQKIT" stats -T "$C/queries.fasta" | tail -1)"

echo "[$(date '+%F %T')] 3) hash-dedup queries"
python "$V/scripts/dedup/hash_dedup.py" --in "$C/queries.fasta" \
  --out-fasta "$C/queries_unique.fasta" --out-membership "$C/queries_exact.parquet"

echo "[$(date '+%F %T')] 4) build residual-rep targets"
"$SEQKIT" grep -j 32 -f "$C/rep_ids.txt" "$NUC" -o "$C/targets.fasta"
echo "[$(date '+%F %T')] targets: $("$SEQKIT" stats -T "$C/targets.fasta" | tail -1)"
rm -f "$C"/targetsDB*
"$MMSEQS" createdb "$C/targets.fasta" "$C/targetsDB"
echo "[$(date '+%F %T')] done"
