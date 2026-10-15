"""Add multi-family columns to the master table.

gcf_04_all lists every GCF a BGC qualifies for (primary first). Contained BGCs take it from
containment_multifamily.parquet, whose best atlas GCF also replaces gcf_04 where the best hit
was MIBiG; seed and orphan-query BGCs get a one-element list (query mode keeps only the nearest).
"""
from __future__ import annotations
import polars as pl

V = "/work/atlas-clustering-v2"
MASTER = f"{V}/master/master_atlas_v3.parquet"
LEV = f"{V}/hac-v3/gcf_to_levels_ward.parquet"

m = pl.read_parquet(MASTER)
print(f"loaded master: {m.height:,} x {len(m.columns)}")

cmf = (pl.read_parquet(f"{V}/containment-v3/containment_multifamily.parquet")
       .select(["bgc_id", pl.col("gcf_04").alias("gcf_04_mf"), pl.col("gcf_04_all").alias("gcf_04_all_cmf")]))
m = m.join(cmf, on="bgc_id", how="left")

m = m.with_columns(pl.coalesce(["gcf_04_mf", "gcf_04"]).alias("gcf_04"))

m = m.with_columns(
    pl.when(pl.col("gcf_04").is_null()).then(None)
    .when(pl.col("gcf_04_all_cmf").is_not_null()).then(pl.col("gcf_04_all_cmf"))
    .otherwise(pl.concat_list(["gcf_04"]))
    .alias("gcf_04_all"))
m = m.with_columns(pl.col("gcf_04_all").list.len().fill_null(0).cast(pl.Int32).alias("n_gcf_04"))
m = m.with_columns((pl.col("n_gcf_04") > 1).alias("multi_family"))

lev = pl.read_parquet(LEV).select(["gcf_id", "L300"])
expl = (m.select(["bgc_id", "gcf_04_all"]).filter(pl.col("gcf_04_all").is_not_null())
        .explode("gcf_04_all").rename({"gcf_04_all": "gcf_id"})
        .join(lev, on="gcf_id", how="left")
        .group_by("bgc_id").agg(pl.col("L300").n_unique().alias("n_L300")))
m = m.join(expl, on="bgc_id", how="left").with_columns(
    pl.when(pl.col("n_gcf_04") > 1).then(pl.col("n_L300") == 1)
    .when(pl.col("n_gcf_04") == 1).then(pl.lit(True))
    .otherwise(None).alias("gcf_04_superfamily_consistent"))

# gcf_04 may have changed above, so the HAC levels are re-joined.
hac = (pl.read_parquet(LEV).select(["gcf_id", "L100", "L300", "L1000"])
       .rename({"gcf_id": "gcf_04", "L100": "hac_L100", "L300": "hac_L300", "L1000": "hac_L1000"}))
m = m.drop(["hac_L100", "hac_L300", "hac_L1000", "gcf_04_mf", "gcf_04_all_cmf", "n_L300"]).join(hac, on="gcf_04", how="left")

m.write_parquet(MASTER, compression="zstd")
print(f"wrote {MASTER}: {m.height:,} x {len(m.columns)}")

placed = m.filter(pl.col("route") != "novel").height
print(f"\nplaced: {placed:,} | with gcf_04: {m.select(pl.col('gcf_04').is_not_null().sum()).item():,}")
print("multi_family by route:")
print(m.group_by("route").agg(pl.len().alias("n"),
      pl.col("multi_family").sum().alias("n_multi"),
      pl.col("n_gcf_04").mean().round(3).alias("mean_n_gcf")).sort("n", descending=True))
mm = m.filter(pl.col("multi_family"))
print(f"\ntotal multi-family BGCs: {mm.height:,} ({100*mm.height/m.height:.1f}% of all)")
print("of multi-family, super-family consistent (sibling GCFs):")
print(mm.group_by("gcf_04_superfamily_consistent").agg(pl.len().alias("n")))
