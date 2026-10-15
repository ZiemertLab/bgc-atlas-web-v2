"""Export containment-unassigned BGCs for BiG-SLiCE query mode, in 60 stable hash shards."""
from __future__ import annotations
import os
import polars as pl

WORK = "/work/atlas-clustering-v2"
CONT = f"{WORK}/containment-v3/containment_assignments.parquet"
OUT = f"{WORK}/orphan-v3"
N_SHARDS = 60

os.makedirs(OUT, exist_ok=True)
df = (pl.scan_parquet(CONT).filter(~pl.col("is_assigned"))
      .select(["bgc_id", "completeness_class", "source"]).collect())
df = df.with_columns((pl.col("bgc_id").hash(seed=1) % N_SHARDS).cast(pl.Int32).alias("shard"))
df.write_parquet(f"{OUT}/orphan_meta.parquet", compression="zstd")

print(f"orphans: {df.height:,} across {N_SHARDS} shards (~{df.height // N_SHARDS:,}/shard)")
print(df.group_by("completeness_class").agg(pl.len().alias("n")).sort("n", descending=True))
sizes = df.group_by("shard").agg(pl.len().alias("n"))["n"]
print("shard sizes (min/max):", sizes.min(), sizes.max())
