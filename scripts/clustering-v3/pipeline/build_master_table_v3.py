"""Assemble master_atlas_v3.parquet: one row per BGC with its GCF at 0.4 and HAC levels.

Routes are disjoint: seed (its dedup cluster's rep), contained (containment target's cluster),
orphan_query (BiG-SLiCE query, distance <= 0.4), novel (none).
"""
from __future__ import annotations
import sqlite3
import polars as pl

WORK = "/work/atlas-clustering-v2"
DB = f"{WORK}/bigslice-output-v3/result/data.db"
OUT = f"{WORK}/master/master_atlas_v3.parquet"

con = sqlite3.connect(f"file:{DB}?mode=ro", uri=True)
gm = pl.read_database(
    "SELECT b.name, m.gcf_id FROM gcf_membership m JOIN bgc b ON b.id=m.bgc_id WHERE m.rank=0", con)
rep_gcf = (gm.with_columns(pl.col("name").str.replace(r"^genomes/", "")
                           .str.replace(r"\.region\d+$", "").alias("rep_bgc_id"))
           .select(["rep_bgc_id", pl.col("gcf_id").alias("gcf_04")]))

reps = pl.read_parquet(f"{WORK}/dedup-v3/95/representatives.parquet").select(["rep_bgc_id", "final_cluster_id"])
clu_gcf = reps.join(rep_gcf, on="rep_bgc_id", how="left").select(["final_cluster_id", "gcf_04"])

seed = (pl.read_parquet(f"{WORK}/dedup-v3/95/cluster_membership.parquet").select(["bgc_id", "final_cluster_id"])
        .join(clu_gcf, on="final_cluster_id", how="left")
        .with_columns(pl.lit("seed").alias("route")))
cont = (pl.read_parquet(f"{WORK}/containment-v3/containment_assignments.parquet")
        .filter(pl.col("is_assigned")).select(["bgc_id", "target_cluster_id"])
        .rename({"target_cluster_id": "final_cluster_id"})
        .join(clu_gcf, on="final_cluster_id", how="left")
        .with_columns(pl.lit("contained").alias("route")))
orphan = (pl.read_parquet(f"{WORK}/orphan-v3/orphan_assignments.parquet")
          .filter(pl.col("assigned")).select(["bgc_id", "gcf_id"]).rename({"gcf_id": "gcf_04"})
          .with_columns(pl.lit(None, dtype=pl.Int64).alias("final_cluster_id"),
                        pl.lit("orphan_query").alias("route")))

cols = ["bgc_id", "gcf_04", "final_cluster_id", "route"]
routes = pl.concat([seed.select(cols), cont.select(cols), orphan.select(cols)], how="vertical_relaxed")

feats = pl.read_parquet(f"{WORK}/features/features.parquet")
master = (feats.join(routes, on="bgc_id", how="left")
          .with_columns(pl.col("route").fill_null("novel")))

hac = (pl.read_parquet(f"{WORK}/hac-v3/gcf_to_levels_ward.parquet")
       .select(["gcf_id", "L100", "L300", "L1000"])
       .rename({"gcf_id": "gcf_04", "L100": "hac_L100", "L300": "hac_L300", "L1000": "hac_L1000"}))
master = master.join(hac, on="gcf_04", how="left")

master.write_parquet(OUT, compression="zstd")
print(f"master_atlas_v3.parquet: {master.height:,} rows x {len(master.columns)} cols -> {OUT}")
print("\nrows by placement route:")
print(master.group_by("route").agg(pl.len().alias("n")).sort("n", descending=True))
placed = master.filter(pl.col("route") != "novel").height
print(f"\nplaced: {placed:,} ({100*placed/master.height:.1f}%) | "
      f"novel: {master.height-placed:,} ({100*(master.height-placed)/master.height:.1f}%)")
print(f"BGCs with a GCF@0.4: {master.select(pl.col('gcf_04').is_not_null().sum()).item():,}")
print(f"distinct GCF@0.4 occupied: {master.select(pl.col('gcf_04').n_unique()).item():,}")
