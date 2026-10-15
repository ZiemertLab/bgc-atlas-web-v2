"""Export containment queries (BGCs outside the seed clustering) and target rep ids."""
from __future__ import annotations
import os
import polars as pl

WORK = "/work/atlas-clustering-v2"
FEAT = f"{WORK}/features/features.parquet"
MEMB = f"{WORK}/dedup-v3/95/cluster_membership.parquet"
REPS = f"{WORK}/dedup-v3/95/representatives.parquet"
CONT = f"{WORK}/containment-v3"

os.makedirs(CONT, exist_ok=True)

feat = pl.scan_parquet(FEAT).select(["bgc_id", "completeness_class", "source", "primary_category"])
memb = pl.scan_parquet(MEMB).select(["bgc_id"])
q = feat.join(memb, on="bgc_id", how="anti").collect()
q.write_parquet(f"{CONT}/query_meta.parquet", compression="zstd")
with open(f"{CONT}/query_ids.txt", "w") as f:
    f.write("\n".join(q["bgc_id"].to_list()))
    f.write("\n")

reps = pl.read_parquet(REPS).select("rep_bgc_id")
with open(f"{CONT}/rep_ids.txt", "w") as f:
    f.write("\n".join(reps["rep_bgc_id"].to_list()))
    f.write("\n")

print(f"queries (non-seed): {q.height:,}  |  target reps: {reps.height:,}")
print(q.group_by("completeness_class").agg(pl.len().alias("n")).sort("n", descending=True))
