#!/usr/bin/env bash
#SBATCH --job-name=v3-orphan-q04mf
#SBATCH --partition=compute
#SBATCH --nodes=1
#SBATCH --cpus-per-task=32
#SBATCH --mem=128G
#SBATCH --time=1-12:00:00
#SBATCH --array=0-59%20
#SBATCH --output=/work/atlas-clustering-v2/logs/%x_%A_%a.out
#SBATCH --error=/work/atlas-clustering-v2/logs/%x_%A_%a.err
# Same as run_orphan_query_v3.sh, but the parser keeps every GCF within 0.4, not only the nearest.
set -euo pipefail
V=/work/atlas-clustering-v2
CB=${CB:-/opt/miniforge3}
S=$SLURM_ARRAY_TASK_ID
OUT="$V/bigslice-output-v3"
QF="$TMPDIR/qf"
QO="$TMPDIR/qo"
AOUT="$V/orphan-v3/assignments_multi/s$S.parquet"
mkdir -p "$V/orphan-v3/assignments_multi" "$QF" "$QO/result"
ln -sf "$OUT/result/data.db" "$QO/result/data.db"
source "$CB/etc/profile.d/conda.sh"

echo "[$(date '+%F %T')] shard $S: extract gbk"
conda activate atlas-clustering
python "$V/scripts/v3/extract_shard_gbk_v3.py" --shard "$S" --out-dir "$QF"

echo "[$(date '+%F %T')] shard $S: query @0.4"
conda activate bigslice2
set +e; printf 'Y\n' | bigslice --query "$QF" --query_name "orphan04mf_s$S" --run_id 1 -t 32 "$QO"; qrc=$?; set -e
echo "[$(date '+%F %T')] shard $S: bigslice rc=$qrc"

echo "[$(date '+%F %T')] shard $S: parse (multi-family)"
conda activate atlas-clustering
python "$V/scripts/v3/parse_query_multi_v3.py" --qout "$QO" --threshold 0.4 --shard "$S" --out "$AOUT"

echo "[$(date '+%F %T')] shard $S: cleanup"
rm -rf "$QF" "$QO"
echo "[$(date '+%F %T')] shard $S: DONE"
