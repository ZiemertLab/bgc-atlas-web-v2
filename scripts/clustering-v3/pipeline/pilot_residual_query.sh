#!/usr/bin/env bash
#SBATCH --job-name=v3-residq-pilot
#SBATCH --partition=compute
#SBATCH --nodes=1
#SBATCH --cpus-per-task=32
#SBATCH --mem=128G
#SBATCH --time=01:00:00
#SBATCH --output=/work/atlas-clustering-v2/logs/%x_%j.out
#SBATCH --error=/work/atlas-clustering-v2/logs/%x_%j.err
# Diagnostic: query 3000 BGCs against the residual model (two clusterings) and check the
# gcf_id -> clustering_id mapping that parse_query_residual_v3.py relies on.
set -euo pipefail
V=/work/atlas-clustering-v2
CB=${CB:-/opt/miniforge3}
QF="$TMPDIR/qf"
QO="$V/residcont-v3/pilot_qo"
rm -rf "$QO"; mkdir -p "$QF" "$QO/result"
ln -sf "$V/bigslice-output-residual-v3/result/data.db" "$QO/result/data.db"
source "$CB/etc/profile.d/conda.sh"

conda activate atlas-clustering
python "$V/scripts/v3/extract_shard_gbk_residcont_v3.py" --shard 0 --out-dir "$QF" --limit 3000
conda activate bigslice2
printf 'Y\n' | bigslice --query "$QF" --query_name residq_pilot --run_id 1 -t 32 "$QO"

conda activate atlas-clustering
DB=$(ls "$QO"/reports/*/data.db | head -1)
echo "=== reports db tables ==="; sqlite3 "$DB" ".tables"
python - <<PY
import sqlite3, polars as pl
src="$V/bigslice-output-residual-v3/result/data.db"
rep="$DB"
gmap=pl.DataFrame(sqlite3.connect(f"file:{src}?mode=ro",uri=True).execute("SELECT id gcf_id, clustering_id FROM gcf").fetchall(), schema=["gcf_id","clustering_id"], orient="row")
rows=sqlite3.connect(f"file:{rep}?mode=ro",uri=True).execute("SELECT bgc_id, gcf_id, membership_value, rank FROM gcf_membership").fetchall()
df=pl.DataFrame(rows, schema=["bgc_id","gcf_id","dist","rank"], orient="row").join(gmap,on="gcf_id",how="left")
print("total rows:", df.height, "| distinct query bgc:", df["bgc_id"].n_unique())
print("rows per clustering_id:"); print(df.group_by("clustering_id").agg(pl.len().alias("n"), pl.col("bgc_id").n_unique().alias("bgcs"), pl.col("rank").min().alias("rmin"), pl.col("rank").max().alias("rmax")))
c1=df.filter(pl.col("clustering_id")==1)
near=c1.sort(["bgc_id","dist"]).group_by("bgc_id").agg(pl.col("dist").first().alias("d"))
print(f"clustering 1 (0.4): {near.height} bgcs; assigned d<=0.4: {near.filter(pl.col('d')<=0.4).height} ({100*near.filter(pl.col('d')<=0.4).height/near.height:.1f}%)")
PY
