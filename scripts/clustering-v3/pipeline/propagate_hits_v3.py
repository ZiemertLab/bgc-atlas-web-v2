"""Turn containment easy-search hits into containment_assignments.parquet.

Best hit per unique query, expanded over exact duplicates; unmatched BGCs stay unassigned
and go on to orphan query.
"""
from __future__ import annotations
import polars as pl

WORK = "/work/atlas-clustering-v2"
C = f"{WORK}/containment-v3"
M8 = f"{C}/easy_search.m8"
REPS = f"{WORK}/dedup-v3/95/representatives.parquet"
OUT = f"{C}/containment_assignments.parquet"


def main() -> None:
    hits = pl.read_csv(M8, separator="\t", has_header=False,
                       new_columns=["query", "target", "pident", "qcov", "tcov", "bits"])
    best = hits.sort(["query", "bits"], descending=[False, True]).unique(subset=["query"], keep="first")
    reps = pl.read_parquet(REPS).select(["rep_bgc_id", "final_cluster_id"]).rename(
        {"rep_bgc_id": "target", "final_cluster_id": "target_cluster_id"})
    best = (best.with_columns(pl.col("target").str.contains(r"^BGC\d{7}$").alias("is_mibig"))
            .join(reps, on="target", how="left")
            .with_columns(pl.when(pl.col("is_mibig")).then(pl.lit("mibig"))
                          .otherwise(pl.lit("atlas_rep")).alias("target_source"))
            .rename({"query": "exact_rep_id", "target": "target_bgc_id",
                     "pident": "identity", "qcov": "query_cov", "bits": "bitscore"}))

    qx = pl.read_parquet(f"{C}/queries_exact.parquet").select(["bgc_id", "exact_rep_id"])
    per_bgc = qx.join(best.select(["exact_rep_id", "target_bgc_id", "target_source",
                                   "target_cluster_id", "identity", "query_cov", "bitscore"]),
                      on="exact_rep_id", how="left")
    meta = pl.read_parquet(f"{C}/query_meta.parquet").select(["bgc_id", "completeness_class", "source"])
    assign = (meta.join(per_bgc.drop("exact_rep_id"), on="bgc_id", how="left")
              .with_columns(pl.col("target_bgc_id").is_not_null().alias("is_assigned")))
    assign.write_parquet(OUT, compression="zstd")

    n = assign.height
    na = int(assign["is_assigned"].sum())
    print(f"total queries: {n:,} | assigned: {na:,} ({100*na/n:.1f}%) | "
          f"unassigned (orphan): {n-na:,} ({100*(n-na)/n:.1f}%)")
    print("\nby completeness class:")
    print(assign.group_by("completeness_class").agg(
        pl.len().alias("n"), pl.col("is_assigned").mean().round(3).alias("frac_assigned")))
    print("\nassigned by target_source:")
    print(assign.filter(pl.col("is_assigned")).group_by("target_source").agg(pl.len().alias("n")))


if __name__ == "__main__":
    main()
