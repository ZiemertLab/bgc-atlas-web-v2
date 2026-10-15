#!/usr/bin/env bash
#SBATCH --job-name=tax-parse
#SBATCH --partition=compute
#SBATCH --nodes=1
#SBATCH --cpus-per-task=8
#SBATCH --mem=96G
#SBATCH --time=02:00:00
#SBATCH --output=/work/atlas-clustering-v2/logs/%x_%j.out
#SBATCH --error=/work/atlas-clustering-v2/logs/%x_%j.err

set -euo pipefail
V=/work/atlas-clustering-v2
CB=${CB:-/opt/miniforge3}
source "$CB/etc/profile.d/conda.sh"; conda activate atlas-clustering
python "$V/scripts/taxonomy/parse_taxonomy.py"
