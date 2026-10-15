#!/usr/bin/env bash
#SBATCH --job-name=v2-tar-index
#SBATCH --partition=compute
#SBATCH --nodes=1
#SBATCH --cpus-per-task=32
#SBATCH --mem=16G
#SBATCH --time=02:00:00
#SBATCH --output=/work/atlas-clustering-v2/logs/%x_%j.out
#SBATCH --error=/work/atlas-clustering-v2/logs/%x_%j.err
# Read-only; safe to run alongside other jobs reading the tar.

set -euo pipefail
V=/work/atlas-clustering-v2
CB=${CB:-/opt/miniforge3}
source "$CB/etc/profile.d/conda.sh"; conda activate atlas-clustering
/usr/bin/time -v python "$V/scripts/features/index_tar.py" --workers 32
