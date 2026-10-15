#!/usr/bin/env bash
#SBATCH --job-name=v3-orphan-rankpilot
#SBATCH --partition=compute
#SBATCH --nodes=1
#SBATCH --cpus-per-task=32
#SBATCH --mem=128G
#SBATCH --time=01:00:00
#SBATCH --output=/work/atlas-clustering-v2/logs/%x_%j.out
#SBATCH --error=/work/atlas-clustering-v2/logs/%x_%j.err
# Diagnostic: how many GCF ranks BiG-SLiCE query mode stores per query BGC (3000 orphans).
set -euo pipefail
V=/work/atlas-clustering-v2
CB=${CB:-/opt/miniforge3}
QF="$TMPDIR/qf"; QO="$TMPDIR/qo"
mkdir -p "$QF" "$QO/result"
ln -sf "$V/bigslice-output-v3/result/data.db" "$QO/result/data.db"
source "$CB/etc/profile.d/conda.sh"

conda activate atlas-clustering
python "$V/scripts/v3/extract_shard_gbk_v3.py" --shard 0 --out-dir "$QF" --limit 3000
conda activate bigslice2
printf 'Y\n' | bigslice --query "$QF" --query_name pilot_ranks --run_id 1 -t 32 "$QO"

DB=$(ls "$QO"/reports/*/data.db | head -1)
echo "=== max rank / total rows / distinct bgc ==="
sqlite3 "$DB" "SELECT MAX(rank) max_rank, COUNT(*) rows, COUNT(DISTINCT bgc_id) bgcs FROM gcf_membership;"
echo "=== rows per rank (how many ranks stored) ==="
sqlite3 "$DB" "SELECT rank, COUNT(*) FROM gcf_membership GROUP BY rank ORDER BY rank LIMIT 12;"
echo "=== sample: distances by rank for 6 bgcs ==="
sqlite3 "$DB" "SELECT bgc_id, rank, round(membership_value,3) FROM gcf_membership WHERE bgc_id IN (SELECT DISTINCT bgc_id FROM gcf_membership LIMIT 6) ORDER BY bgc_id, rank;"
echo "=== bgcs with >=2 GCFs within 0.4 ==="
sqlite3 "$DB" "SELECT COUNT(*) FROM (SELECT bgc_id FROM gcf_membership WHERE membership_value<=0.4 GROUP BY bgc_id HAVING COUNT(*)>=2);"
echo "=== distance distribution of rank-1 (2nd nearest), if any ==="
sqlite3 "$DB" "SELECT COUNT(*) n_rank1, round(MIN(membership_value),3) min_d, round(AVG(membership_value),3) avg_d FROM gcf_membership WHERE rank=1;"
