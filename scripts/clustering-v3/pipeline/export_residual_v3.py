"""Export unplaced core-complete and partial BGCs for residual clustering.

Fragments are excluded: their domain-presence features are too sparse to cluster.
"""
from __future__ import annotations
import os
import polars as pl

WORK = "/work/atlas-clustering-v2"
MASTER = f"{WORK}/master/master_atlas_v3.parquet"
RES = f"{WORK}/residual-v3"

os.makedirs(RES, exist_ok=True)
res = (pl.scan_parquet(MASTER)
       .filter((pl.col("route") == "novel")
               & pl.col("completeness_class").is_in(["core-complete", "partial"]))
       .select(["bgc_id", "contig_edge", "completeness_class", "bgc_length",
                "primary_category", "source"])
       .collect())
res.write_parquet(f"{RES}/residual_meta.parquet", compression="zstd")
with open(f"{RES}/residual_ids.txt", "w") as f:
    f.write("\n".join(res["bgc_id"].to_list()))
    f.write("\n")

print(f"residual candidates: {res.height:,} -> {RES}/residual_ids.txt")
print("by completeness_class:")
print(res.group_by("completeness_class").agg(pl.len().alias("n")).sort("n", descending=True))
print("by primary_category:")
print(res.group_by("primary_category").agg(pl.len().alias("n")).sort("n", descending=True))
