#!/usr/bin/env bash
#SBATCH --job-name=v3-orphan-q04
#SBATCH --partition=compute
#SBATCH --nodes=1
#SBATCH --cpus-per-task=32
#SBATCH --mem=128G
#SBATCH --time=1-12:00:00
#SBATCH --array=0-59%20
#SBATCH --output=/work/atlas-clustering-v2/logs/%x_%A_%a.out
#SBATCH --error=/work/atlas-clustering-v2/logs/%x_%A_%a.err
# One array task per shard. Query files and reports go to node-local $TMPDIR so the per-file
# churn stays off the shared filesystem's metadata server. run_id 1 = the 0.4 clustering.
set -euo pipefail
V=/work/atlas-clustering-v2
CB=${CB:-/opt/miniforge3}
S=$SLURM_ARRAY_TASK_ID
OUT="$V/bigslice-output-v3"
QF="$TMPDIR/qf"
QO="$TMPDIR/qo"
AOUT="$V/orphan-v3/assignments/s$S.parquet"
mkdir -p "$V/orphan-v3/assignments" "$QF" "$QO/result"
ln -sf "$OUT/result/data.db" "$QO/result/data.db"
source "$CB/etc/profile.d/conda.sh"

echo "[$(date '+%F %T')] shard $S: extract gbk"
conda activate atlas-clustering
python "$V/scripts/v3/extract_shard_gbk_v3.py" --shard "$S" --out-dir "$QF"

echo "[$(date '+%F %T')] shard $S: query @0.4"
conda activate bigslice2
set +e; printf 'Y\n' | bigslice --query "$QF" --query_name "orphan04_s$S" --run_id 1 -t 32 "$QO"; qrc=$?; set -e
echo "[$(date '+%F %T')] shard $S: bigslice rc=$qrc"

echo "[$(date '+%F %T')] shard $S: parse"
conda activate atlas-clustering
python "$V/scripts/orphan/parse_query.py" --qout "$QO" --threshold 0.4 --shard "$S" --out "$AOUT"

echo "[$(date '+%F %T')] shard $S: cleanup"
rm -rf "$QF" "$QO"
echo "[$(date '+%F %T')] shard $S: DONE"
