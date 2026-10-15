"""Map residual-containment hits to residual GCFs (clustering id 1) per BGC."""
from __future__ import annotations
import sqlite3
import polars as pl

WORK = "/work/atlas-clustering-v2"
C = f"{WORK}/residcont-v3"
DB = f"{WORK}/bigslice-output-residual-v3/result/data.db"
OUT = f"{C}/residcont_assignments.parquet"

con = sqlite3.connect(f"file:{DB}?mode=ro", uri=True)
rows = con.execute(
    "SELECT b.name, m.gcf_id FROM gcf_membership m JOIN bgc b ON b.id=m.bgc_id "
    "JOIN gcf g ON g.id=m.gcf_id WHERE m.rank=0 AND g.clustering_id=1").fetchall()
con.close()
rep_gcf = (pl.DataFrame(rows, schema=["name", "residual_gcf_04"], orient="row")
           .with_columns(pl.col("name").str.replace(r"^genomes/", "").str.replace(r"\.region\d+$", "").alias("target"))
           .select(["target", "residual_gcf_04"]))

hits = pl.read_csv(f"{C}/easy_search.m8", separator="\t", has_header=False,
                   new_columns=["query", "target", "pident", "qcov", "tcov", "bits"])
best = hits.sort(["query", "bits"], descending=[False, True]).unique(subset=["query"], keep="first")
best = (best.join(rep_gcf, on="target", how="left")
        .rename({"query": "exact_rep_id", "target": "target_rep", "pident": "identity", "bits": "bitscore"}))

qx = pl.read_parquet(f"{C}/queries_exact.parquet").select(["bgc_id", "exact_rep_id"])
per_bgc = qx.join(best.select(["exact_rep_id", "target_rep", "residual_gcf_04", "identity", "qcov", "bitscore"]),
                  on="exact_rep_id", how="left")
meta = pl.read_parquet(f"{C}/query_meta.parquet").select(["bgc_id", "completeness_class", "source"])
assign = (meta.join(per_bgc.drop("exact_rep_id"), on="bgc_id", how="left")
          .with_columns(pl.col("residual_gcf_04").is_not_null().alias("is_assigned")))
assign.write_parquet(OUT, compression="zstd")

n = assign.height
na = int(assign["is_assigned"].sum())
print(f"queries: {n:,} | assigned to a residual GCF: {na:,} ({100*na/n:.1f}%) | "
      f"still unassigned: {n-na:,} ({100*(n-na)/n:.1f}%)")
print("by completeness class:")
print(assign.group_by("completeness_class").agg(
    pl.len().alias("n"), pl.col("is_assigned").mean().round(3).alias("frac_assigned")))
print(f"distinct residual GCFs receiving a fragment: "
      f"{assign.filter(pl.col('is_assigned'))['residual_gcf_04'].n_unique():,}")
