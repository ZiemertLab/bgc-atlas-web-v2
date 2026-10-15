"""Diagnostic: count confident new families in each residual clustering.

Confident = >=5 member BGCs, >=2 sources, >=5 samples, no MIBiG member.
"""
from __future__ import annotations
import sqlite3
import polars as pl

V = "/work/atlas-clustering-v2"
DB = f"{V}/bigslice-output-residual-v3/result/data.db"
RESMEMB = f"{V}/residual-v3/95/cluster_membership.parquet"
REPS = f"{V}/residual-v3/95/representatives.parquet"
MASTER = f"{V}/master/master_atlas_v3.parquet"

con = sqlite3.connect(f"file:{DB}?mode=ro", uri=True)
clu = pl.read_database("SELECT id, threshold FROM clustering", con)
ds = pl.read_database("SELECT id, name FROM dataset", con)
mibig_id = ds.filter(pl.col("name") == "MIBiG")["id"].to_list()
mibig_id = mibig_id[0] if mibig_id else -1
gm = pl.read_database(
    "SELECT b.name, b.dataset_id, g.clustering_id AS cl, m.gcf_id "
    "FROM gcf_membership m JOIN bgc b ON b.id=m.bgc_id JOIN gcf g ON g.id=m.gcf_id WHERE m.rank=0", con)
con.close()
gm = gm.with_columns(pl.col("name").str.replace(r"^genomes/", "").str.replace(r"\.region\d+$", "").alias("member"),
                     (pl.col("dataset_id") == mibig_id).alias("is_mibig"))

memb = pl.read_parquet(RESMEMB).select(["bgc_id", "final_cluster_id"])
reps = pl.read_parquet(REPS).select([pl.col("rep_bgc_id").alias("member"), "final_cluster_id"])
master = pl.read_parquet(MASTER).select(["bgc_id", "source", "sample_id", "primary_category"])

for cid, thr in clu.sort("threshold").iter_rows():
    g = gm.filter(pl.col("cl") == cid)
    exp = (g.filter(~pl.col("is_mibig")).join(reps, on="member", how="left")
           .select(["gcf_id", "final_cluster_id"]).join(memb, on="final_cluster_id", how="left")
           .join(master, on="bgc_id", how="left"))
    perg = exp.group_by("gcf_id").agg(
        pl.len().alias("n_bgc"),
        pl.col("source").n_unique().alias("n_src"),
        pl.col("sample_id").n_unique().alias("n_samp"),
        pl.col("primary_category").mode().first().alias("cat"))
    mib = g.group_by("gcf_id").agg(pl.col("is_mibig").any().alias("has_mibig"))
    perg = perg.join(mib, on="gcf_id", how="left").with_columns(
        ((pl.col("n_bgc") >= 5) & (pl.col("n_src") >= 2) & (pl.col("n_samp") >= 5) & ~pl.col("has_mibig")).alias("confident"))

    nf = perg.height
    conf = perg.filter(pl.col("confident"))
    print(f"\n===== residual clustering @ {thr} (id {cid}) =====")
    print(f"families: {nf:,} | singletons: {perg.filter(pl.col('n_bgc')==1).height:,} "
          f"({100*perg.filter(pl.col('n_bgc')==1).height/nf:.1f}%) | "
          f"MIBiG-anchored: {perg.filter(pl.col('has_mibig')).height:,}")
    print(f"CONFIDENT families (>=5 BGC, >=2 src, >=5 samp, no anchor): {conf.height:,}")
    print(f"BGCs in confident families: {conf['n_bgc'].sum():,} "
          f"({100*conf['n_bgc'].sum()/max(perg['n_bgc'].sum(),1):.1f}% of clustered residual BGCs)")
    print("confident families by dominant category:")
    print(conf.group_by("cat").agg(pl.len().alias("n_fams"), pl.col("n_bgc").sum().alias("n_bgc")).sort("n_bgc", descending=True))
    print("top 5 confident families:")
    print(conf.sort("n_bgc", descending=True).head(5).select(["gcf_id", "n_bgc", "n_src", "n_samp", "cat"]))
