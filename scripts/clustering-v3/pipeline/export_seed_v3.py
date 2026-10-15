"""Export the seed set: contig_edge False, or complete/near-complete.

complete/near-complete already is the bgc_length >= p50 set, so no length baseline is needed.
"""
from __future__ import annotations
import os
import polars as pl

WORK = "/work/atlas-clustering-v2"
FEAT = f"{WORK}/features/features.parquet"
DEDUP = f"{WORK}/dedup-v3"

os.makedirs(DEDUP, exist_ok=True)
seed = (pl.scan_parquet(FEAT)
        .filter((pl.col("contig_edge") == False)                                    # noqa: E712
                | pl.col("completeness_class").is_in(["complete", "near-complete"]))
        .select(["bgc_id", "contig_edge", "completeness_class", "bgc_length",
                 "primary_category", "source"])
        .collect())
seed.write_parquet(f"{DEDUP}/seed_meta.parquet", compression="zstd")
with open(f"{DEDUP}/seed_ids.txt", "w") as f:
    f.write("\n".join(seed["bgc_id"].to_list()))
    f.write("\n")

print(f"v3 seed: {seed.height:,} bgc_ids -> {DEDUP}/seed_ids.txt")
print("composition (contig_edge x completeness_class):")
print(seed.group_by(["contig_edge", "completeness_class"]).agg(pl.len().alias("n"))
      .sort("n", descending=True))
