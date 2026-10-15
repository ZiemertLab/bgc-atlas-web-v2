#!/usr/bin/env bash
#SBATCH --job-name=v3-bigslice-input
#SBATCH --partition=compute
#SBATCH --nodes=1
#SBATCH --cpus-per-task=4
#SBATCH --mem=32G
#SBATCH --time=06:00:00
#SBATCH --output=/work/atlas-clustering-v2/logs/%x_%j.out
#SBATCH --error=/work/atlas-clustering-v2/logs/%x_%j.err
set -euo pipefail
V=/work/atlas-clustering-v2
CB=${CB:-/opt/miniforge3}
source "$CB/etc/profile.d/conda.sh"; conda activate atlas-clustering
python "$V/scripts/v3/build_bigslice_input_v3.py"
echo "=== datasets.tsv ==="; cat "$V/bigslice-input-v3/datasets.tsv"
echo "=== total gbk ==="; find "$V/bigslice-input-v3" -name "*.gbk" | wc -l
