"""Pick residual dedup reps (exact sha256, then linclust 95%): untruncated, then longest, then bgc_id."""
from __future__ import annotations
import polars as pl

WORK = "/work/atlas-clustering-v2"
D = f"{WORK}/residual-v3"
T = 95

exact = pl.read_parquet(f"{D}/exact_membership.parquet")
meta = pl.read_parquet(f"{D}/residual_meta.parquet")
tsv = pl.read_csv(f"{D}/{T}/linclust_cluster.tsv", separator="\t",
                  has_header=False, new_columns=["linclust_rep", "exact_rep_id"])
lc = tsv.select(["exact_rep_id", "linclust_rep"]).unique(subset=["exact_rep_id"])

memb = (exact.select(["bgc_id", "seq_sha256", "exact_rep_id"])
        .join(lc, on="exact_rep_id", how="left")
        .with_columns(pl.col("linclust_rep").fill_null(pl.col("exact_rep_id")).alias("final_cluster_id"))
        .drop("linclust_rep")
        .join(meta, on="bgc_id", how="left"))

memb = (memb.with_columns((pl.col("contig_edge") == False).cast(pl.Int8).alias("_untrunc"))  # noqa: E712
        .sort(["final_cluster_id", "_untrunc", "bgc_length", "bgc_id"],
              descending=[False, True, True, False])
        .with_columns(pl.first("bgc_id").over("final_cluster_id").alias("rep_bgc_id"))
        .with_columns((pl.col("bgc_id") == pl.col("rep_bgc_id")).alias("is_rep"))
        .drop("_untrunc"))

sizes = memb.group_by("final_cluster_id").agg(
    pl.len().alias("n_members"), pl.col("exact_rep_id").n_unique().alias("n_exact_unique"))

memb.select(["bgc_id", "seq_sha256", "exact_rep_id", "final_cluster_id", "is_rep",
             "contig_edge", "completeness_class", "bgc_length", "primary_category", "source"]) \
    .write_parquet(f"{D}/{T}/cluster_membership.parquet", compression="zstd")

reps = (memb.filter(pl.col("is_rep")).join(sizes, on="final_cluster_id")
        .select(["rep_bgc_id", "final_cluster_id", "n_members", "n_exact_unique",
                 "contig_edge", "completeness_class", "bgc_length", "primary_category", "source"]))
reps.write_parquet(f"{D}/{T}/representatives.parquet", compression="zstd")

n_seed, n_clu = memb.height, reps.height
print(f"residual BGCs: {n_seed:,} -> representatives: {n_clu:,} ({100*(1-n_clu/n_seed):.1f}% dedup)")
print(f"exact-unique in: {memb['exact_rep_id'].n_unique():,}")
print("reps by primary_category:")
print(reps.group_by("primary_category").agg(pl.len().alias("n")).sort("n", descending=True))
