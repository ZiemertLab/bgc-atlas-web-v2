"""Export BGCs still unclustered after residual containment, in 60 stable hash shards."""
from __future__ import annotations
import os
import polars as pl

WORK = "/work/atlas-clustering-v2"
MASTER = f"{WORK}/master/master_atlas_v3.parquet"
OUT = f"{WORK}/residcont-v3/orphan"
N_SHARDS = 60

os.makedirs(OUT, exist_ok=True)
df = (pl.scan_parquet(MASTER)
      .filter(pl.col("gcf_04").is_null() & pl.col("residual_gcf_04").is_null())
      .select(["bgc_id", "completeness_class", "source"]).collect())
df = df.with_columns((pl.col("bgc_id").hash(seed=1) % N_SHARDS).cast(pl.Int32).alias("shard"))
df.write_parquet(f"{OUT}/orphan_meta.parquet", compression="zstd")
print(f"orphans: {df.height:,} across {N_SHARDS} shards (~{df.height // N_SHARDS:,}/shard)")
print(df.group_by("completeness_class").agg(pl.len().alias("n")).sort("n", descending=True))
