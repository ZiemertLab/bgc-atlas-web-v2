"""Per contained BGC, list every atlas GCF it is contained in, best bitscore first.

Every easy-search hit already passed the coverage/identity cut, so each distinct GCF counts.
"""
from __future__ import annotations
import sqlite3
import polars as pl

V = "/work/atlas-clustering-v2"
C = f"{V}/containment-v3"
DB = f"{V}/bigslice-output-v3/result/data.db"

con = sqlite3.connect(f"file:{DB}?mode=ro", uri=True)
rows = con.execute("SELECT b.name, m.gcf_id FROM gcf_membership m JOIN bgc b ON b.id=m.bgc_id WHERE m.rank=0").fetchall()
con.close()
tg = (pl.DataFrame(rows, schema=["name", "gcf"], orient="row")
      .with_columns(pl.col("name").str.replace(r"^genomes/", "").str.replace(r"\.region\d+$", "").alias("target"))
      .select(["target", "gcf"]))

h = (pl.read_csv(f"{C}/easy_search.m8", separator="\t", has_header=False,
                 new_columns=["query", "target", "pident", "qcov", "tcov", "bits"])
     .join(tg, on="target", how="left").drop_nulls("gcf"))   # every target is in the seed run; a miss would have no GCF

gg = (h.group_by(["query", "gcf"]).agg(pl.col("bits").max().alias("gbits"))
      .sort(["query", "gbits"], descending=[False, True])
      .group_by("query", maintain_order=True).agg(pl.col("gcf").alias("gcf_04_all")))

qx = pl.read_parquet(f"{C}/queries_exact.parquet").select(["bgc_id", "exact_rep_id"]).rename({"exact_rep_id": "query"})
per_bgc = (qx.join(gg, on="query", how="inner")
           .with_columns(pl.col("gcf_04_all").list.first().alias("gcf_04"),
                         pl.col("gcf_04_all").list.len().cast(pl.Int32).alias("n_gcf_04"))
           .select(["bgc_id", "gcf_04", "gcf_04_all", "n_gcf_04"]))
per_bgc.write_parquet(f"{C}/containment_multifamily.parquet", compression="zstd")

n = per_bgc.height
mf = per_bgc.filter(pl.col("n_gcf_04") > 1).height
print(f"contained BGCs with an atlas GCF: {n:,}")
print(f"multi-family (n_gcf_04>1): {mf:,} ({100*mf/n:.1f}%)")
print("n_gcf_04 distribution:")
print(per_bgc.group_by("n_gcf_04").agg(pl.len().alias("n")).sort("n_gcf_04").head(12))
