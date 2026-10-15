#!/usr/bin/env bash
#SBATCH --job-name=v3-residq
#SBATCH --partition=compute
#SBATCH --nodes=1
#SBATCH --cpus-per-task=32
#SBATCH --mem=128G
#SBATCH --time=1-00:00:00
#SBATCH --array=0-59%20
#SBATCH --output=/work/atlas-clustering-v2/logs/%x_%A_%a.out
#SBATCH --error=/work/atlas-clustering-v2/logs/%x_%A_%a.err
# The residual db holds two clusterings; the parser keeps clustering 1 (0.4).
set -euo pipefail
V=/work/atlas-clustering-v2
CB=${CB:-/opt/miniforge3}
S=$SLURM_ARRAY_TASK_ID
OUT="$V/bigslice-output-residual-v3"
QF="$TMPDIR/qf"; QO="$TMPDIR/qo"
AOUT="$V/residcont-v3/orphan/assignments/s$S.parquet"
mkdir -p "$V/residcont-v3/orphan/assignments" "$QF" "$QO/result"
ln -sf "$OUT/result/data.db" "$QO/result/data.db"
source "$CB/etc/profile.d/conda.sh"

echo "[$(date '+%F %T')] shard $S: extract gbk"
conda activate atlas-clustering
python "$V/scripts/v3/extract_shard_gbk_residcont_v3.py" --shard "$S" --out-dir "$QF"

echo "[$(date '+%F %T')] shard $S: query @0.4 vs residual models"
conda activate bigslice2
set +e; printf 'Y\n' | bigslice --query "$QF" --query_name "residq_s$S" --run_id 1 -t 32 "$QO"; qrc=$?; set -e
echo "[$(date '+%F %T')] shard $S: bigslice rc=$qrc"

echo "[$(date '+%F %T')] shard $S: parse (clustering 1 = 0.4)"
conda activate atlas-clustering
python "$V/scripts/v3/parse_query_residual_v3.py" --qout "$QO" --threshold 0.4 --clustering-id 1 --shard "$S" --out "$AOUT"

echo "[$(date '+%F %T')] shard $S: cleanup"
rm -rf "$QF" "$QO"
echo "[$(date '+%F %T')] shard $S: DONE"
