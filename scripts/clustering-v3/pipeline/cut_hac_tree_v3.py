"""Cut the HAC linkages at fixed K into nested levels, per GCF and per rep BGC."""
from __future__ import annotations
import sqlite3
import numpy as np
import polars as pl
from scipy.cluster.hierarchy import fcluster

WORK = "/work/atlas-clustering-v2"
HAC = f"{WORK}/hac-v3"
DB = f"{WORK}/bigslice-output-v3/result/data.db"
KS = [2, 4, 8, 16, 50, 100, 300, 1000]

gcf_ids = np.load(f"{HAC}/gcf_ids.npy")
con = sqlite3.connect(f"file:{DB}?mode=ro", uri=True)
mem = pl.read_database(
    "SELECT m.gcf_id, b.name AS bgc_name FROM gcf_membership m "
    "JOIN bgc b ON b.id=m.bgc_id WHERE m.rank=0", con
).with_columns(pl.col("bgc_name").str.replace(r"^genomes/", "")
               .str.replace(r"\.region\d+$", "").alias("bgc_id"))

for method in ("ward", "average"):
    Z = np.load(f"{HAC}/linkage_{method}.npy")
    cols = {"gcf_id": gcf_ids}
    for K in KS:
        cols[f"L{K}"] = fcluster(Z, t=K, criterion="maxclust").astype(np.int32)
    g = pl.DataFrame(cols)
    g.write_parquet(f"{HAC}/gcf_to_levels_{method}.parquet", compression="zstd")
    b = mem.join(g, on="gcf_id")
    b.write_parquet(f"{HAC}/bgc_to_levels_{method}.parquet", compression="zstd")
    print(f"{method}: {g.height:,} GCFs, {b.height:,} BGCs across levels {KS}")
