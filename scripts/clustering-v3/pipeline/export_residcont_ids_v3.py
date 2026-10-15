"""Export unclustered BGCs (queries) and residual reps (targets) for residual containment.

BGCs without a sequence are harmless here; seqkit skips them.
"""
from __future__ import annotations
import os
import polars as pl

WORK = "/work/atlas-clustering-v2"
MASTER = f"{WORK}/master/master_atlas_v3.parquet"
RREPS = f"{WORK}/residual-v3/95/representatives.parquet"
C = f"{WORK}/residcont-v3"

os.makedirs(C, exist_ok=True)
q = (pl.scan_parquet(MASTER)
     .filter(pl.col("gcf_04").is_null() & pl.col("residual_gcf_04").is_null())
     .select(["bgc_id", "completeness_class", "source", "primary_category"]).collect())
q.write_parquet(f"{C}/query_meta.parquet", compression="zstd")
with open(f"{C}/query_ids.txt", "w") as f:
    f.write("\n".join(q["bgc_id"].to_list()) + "\n")

reps = pl.read_parquet(RREPS).select("rep_bgc_id")
with open(f"{C}/rep_ids.txt", "w") as f:
    f.write("\n".join(reps["rep_bgc_id"].to_list()) + "\n")

print(f"query (unclustered): {q.height:,}  |  residual rep targets: {reps.height:,}")
print(q.group_by("completeness_class").agg(pl.len().alias("n")).sort("n", descending=True))
