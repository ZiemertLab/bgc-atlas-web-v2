#!/usr/bin/env bash
#SBATCH --job-name=v3-fold-residual
#SBATCH --partition=compute
#SBATCH --nodes=1
#SBATCH --cpus-per-task=16
#SBATCH --mem=256G
#SBATCH --time=04:00:00
#SBATCH --output=/work/atlas-clustering-v2/logs/%x_%j.out
#SBATCH --error=/work/atlas-clustering-v2/logs/%x_%j.err
set -euo pipefail
V=/work/atlas-clustering-v2
CB=${CB:-/opt/miniforge3}
source "$CB/etc/profile.d/conda.sh"; conda activate atlas-clustering
python "$V/scripts/v3/fold_residual_master_v3.py"
