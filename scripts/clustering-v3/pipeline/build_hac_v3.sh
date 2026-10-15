#!/usr/bin/env bash
#SBATCH --job-name=v3-hac-tree
#SBATCH --partition=compute
#SBATCH --nodes=1
#SBATCH --cpus-per-task=96
#SBATCH --mem=1900G
#SBATCH --time=4-00:00:00
#SBATCH --output=/work/atlas-clustering-v2/logs/%x_%j.out
#SBATCH --error=/work/atlas-clustering-v2/logs/%x_%j.err
# Needs a ~2 TB node: the condensed distance array for ~370k GCFs is ~550 GB and linkage
# copies it. Depends only on the seed BiG-SLiCE run, so it can run alongside containment.
set -euo pipefail
V=/work/atlas-clustering-v2
CB=${CB:-/opt/miniforge3}
source "$CB/etc/profile.d/conda.sh"; conda activate atlas-clustering
export OMP_NUM_THREADS=96 OPENBLAS_NUM_THREADS=96 MKL_NUM_THREADS=96

echo "[$(date '+%F %T')] 1) extract v3 centroids"
python "$V/scripts/v3/build_hac_centroids_v3.py"

echo "[$(date '+%F %T')] 2) build HAC tree (ward + average)"
/usr/bin/time -v python "$V/scripts/v3/build_hac_tree_v3.py"
echo "[$(date '+%F %T')] done -> hac-v3/linkage_{ward,average}.npy"
