"""Add residual_gcf_04 and residual_confident_04 to the master from the residual clustering.

Only clustering id 1 (0.4) is used. Confident = >=5 BGCs, >=2 sources, >=5 samples, no MIBiG member.
"""
from __future__ import annotations
import sqlite3
import polars as pl

V = "/work/atlas-clustering-v2"
DB = f"{V}/bigslice-output-residual-v3/result/data.db"
MASTER = f"{V}/master/master_atlas_v3.parquet"
RMEMB = f"{V}/residual-v3/95/cluster_membership.parquet"
RREPS = f"{V}/residual-v3/95/representatives.parquet"

con = sqlite3.connect(f"file:{DB}?mode=ro", uri=True)
ds = pl.read_database("SELECT id, name FROM dataset", con)
mib = ds.filter(pl.col("name") == "MIBiG")["id"].to_list()
mib = mib[0] if mib else -1
gm = pl.read_database(
    "SELECT b.name, b.dataset_id, m.gcf_id FROM gcf_membership m "
    "JOIN bgc b ON b.id=m.bgc_id JOIN gcf g ON g.id=m.gcf_id "
    "WHERE m.rank=0 AND g.clustering_id=1", con)
con.close()
gm = gm.with_columns(
    pl.col("name").str.replace(r"^genomes/", "").str.replace(r"\.region\d+$", "").alias("nm"),
    (pl.col("dataset_id") == mib).alias("is_mibig"))
rep_gcf = gm.filter(~pl.col("is_mibig")).select([pl.col("nm").alias("rep_bgc_id"),
                                                 pl.col("gcf_id").alias("residual_gcf_04")])
mibig_in_gcf = gm.filter(pl.col("is_mibig")).select([pl.col("gcf_id").alias("residual_gcf_04")]).unique()

reps = pl.read_parquet(RREPS).select(["rep_bgc_id", "final_cluster_id"])
fc2gcf = reps.join(rep_gcf, on="rep_bgc_id", how="left").select(["final_cluster_id", "residual_gcf_04"])
memb = (pl.read_parquet(RMEMB).select(["bgc_id", "final_cluster_id"])
        .join(fc2gcf, on="final_cluster_id", how="left")
        .select(["bgc_id", "residual_gcf_04"]))
print(f"residual member BGCs with a GCF: {memb.filter(pl.col('residual_gcf_04').is_not_null()).height:,}")

mm = pl.read_parquet(MASTER, columns=["bgc_id", "source", "sample_id"])
gstats = (memb.join(mm, on="bgc_id", how="left")
          .group_by("residual_gcf_04").agg(
              pl.len().alias("n_bgc"),
              pl.col("source").n_unique().alias("n_src"),
              pl.col("sample_id").n_unique().alias("n_samp"))
          .join(mibig_in_gcf.with_columns(pl.lit(True).alias("has_mibig")), on="residual_gcf_04", how="left")
          .with_columns(pl.col("has_mibig").fill_null(False))
          .with_columns(((pl.col("n_bgc") >= 5) & (pl.col("n_src") >= 2)
                         & (pl.col("n_samp") >= 5) & ~pl.col("has_mibig")).alias("residual_confident_04")))
conf = gstats.filter(pl.col("residual_confident_04"))
print(f"residual GCFs: {gstats.height:,} | confident: {conf.height:,} | "
      f"BGCs in confident: {conf['n_bgc'].sum():,}")

memb2 = memb.join(gstats.select(["residual_gcf_04", "residual_confident_04"]), on="residual_gcf_04", how="left")

m = pl.read_parquet(MASTER)
before = len(m.columns)
m = (m.drop([c for c in ["residual_gcf_04", "residual_confident_04"] if c in m.columns])
     .join(memb2, on="bgc_id", how="left"))
m.write_parquet(MASTER, compression="zstd")
print(f"\nmaster: {m.height:,} x {before} -> {len(m.columns)} cols -> {MASTER}")
print(f"BGCs with residual_gcf_04: {m.select(pl.col('residual_gcf_04').is_not_null().sum()).item():,}")
print(f"BGCs in a CONFIDENT residual family: {m.select((pl.col('residual_confident_04')==True).sum()).item():,}")
print("\nresidual coverage by route (sanity: should be route=novel only):")
print(m.filter(pl.col("residual_gcf_04").is_not_null()).group_by("route").agg(pl.len().alias("n")))
