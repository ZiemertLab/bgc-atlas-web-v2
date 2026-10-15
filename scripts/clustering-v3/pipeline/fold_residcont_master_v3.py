"""Fold residual-containment hits into the master (residual_gcf_04, residual_confident_04, residual_route)."""
from __future__ import annotations
import polars as pl

V = "/work/atlas-clustering-v2"
MASTER = f"{V}/master/master_atlas_v3.parquet"
RC = f"{V}/residcont-v3/residcont_assignments.parquet"

m = pl.read_parquet(MASTER)
before = len(m.columns)

conf_map = (m.filter(pl.col("residual_gcf_04").is_not_null())
            .select(["residual_gcf_04", "residual_confident_04"]).unique(subset=["residual_gcf_04"]))

rc = (pl.read_parquet(RC).filter(pl.col("is_assigned"))
      .select(["bgc_id", pl.col("residual_gcf_04").alias("rc_gcf")]))

m = m.join(rc, on="bgc_id", how="left")
m = m.with_columns(
    pl.when(pl.col("residual_gcf_04").is_not_null()).then(pl.lit("residual_seed"))
    .when(pl.col("rc_gcf").is_not_null()).then(pl.lit("residual_contained"))
    .otherwise(None).alias("residual_route"))
m = m.with_columns(pl.coalesce(["residual_gcf_04", "rc_gcf"]).alias("residual_gcf_04")).drop("rc_gcf")
m = (m.drop("residual_confident_04")
     .join(conf_map, on="residual_gcf_04", how="left"))

m.write_parquet(MASTER, compression="zstd")
print(f"master: {m.height:,} x {before} -> {len(m.columns)} cols")

tot = m.height
main = m.filter(pl.col("gcf_04").is_not_null()).height
rres = m.filter(pl.col("gcf_04").is_null() & pl.col("residual_gcf_04").is_not_null()).height
none = m.filter(pl.col("gcf_04").is_null() & pl.col("residual_gcf_04").is_null()).height
print(f"\n=== coverage after fragment re-placement ===")
print(f"main-atlas GCF:        {main:,} ({100*main/tot:.1f}%)")
print(f"residual GCF only:     {rres:,} ({100*rres/tot:.1f}%)")
print(f"still unclustered:     {none:,} ({100*none/tot:.1f}%)")
print(f"TOTAL CLUSTERED:       {tot-none:,} ({100*(tot-none)/tot:.1f}%)")
print("\nresidual_route breakdown:")
print(m.group_by("residual_route").agg(pl.len().alias("n")).sort("n", descending=True))
print(f"\nBGCs in a CONFIDENT residual family: "
      f"{m.select((pl.col('residual_confident_04')==True).sum()).item():,}")
