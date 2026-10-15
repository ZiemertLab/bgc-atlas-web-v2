#!/usr/bin/env bash
#SBATCH --job-name=v3-mf-identity
#SBATCH --partition=compute
#SBATCH --nodes=1
#SBATCH --cpus-per-task=16
#SBATCH --mem=64G
#SBATCH --time=04:00:00
#SBATCH --output=/work/atlas-clustering-v2/logs/%x_%j.out
#SBATCH --error=/work/atlas-clustering-v2/logs/%x_%j.err
#
# Reduce easy_search.m8 to per-(bgc_id, gcf_04) identities for gcf_04_all's secondary memberships.
set -euo pipefail
V=/work/atlas-clustering-v2
PY=${PY:-python3}

mkdir -p "$V/logs"
exec "$PY" -u "$V/scripts/v3/reduce_multifamily_identity_v3.py"
