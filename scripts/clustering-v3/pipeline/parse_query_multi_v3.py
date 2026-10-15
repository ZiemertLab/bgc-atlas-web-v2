"""Parse a BiG-SLiCE query reports db, keeping every GCF within the threshold, nearest first.

Usage: parse_query_multi_v3.py --qout DIR --threshold T --out FILE [--shard N]
"""
from __future__ import annotations
import argparse
import glob
import sqlite3
import polars as pl


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--qout", required=True, help="per-shard output folder; finds reports/*/data.db")
    ap.add_argument("--threshold", type=float, required=True)
    ap.add_argument("--shard", type=int, default=-1)
    ap.add_argument("--out", required=True)
    args = ap.parse_args()

    db = sorted(glob.glob(f"{args.qout}/reports/*/data.db"))[0]
    q = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
    rows = q.execute(
        "SELECT b.name, m.gcf_id, m.membership_value, m.rank FROM gcf_membership m "
        "JOIN bgc b ON b.id=m.bgc_id").fetchall()
    df = (pl.DataFrame(rows, schema=["name", "gcf_id", "distance", "rank"], orient="row")
          .with_columns(pl.col("name").str.replace(r"^.*/", "").str.replace(r"\.region\d+$", "").alias("bgc_id")))

    near = (df.filter(pl.col("rank") == 0)
            .select(["bgc_id", pl.col("gcf_id").alias("gcf_04"), pl.col("distance").alias("best_distance")]))
    within = (df.filter(pl.col("distance") <= args.threshold).sort(["bgc_id", "distance"])
              .group_by("bgc_id", maintain_order=True).agg(pl.col("gcf_id").alias("gcf_04_all")))
    out = (near.join(within, on="bgc_id", how="left")
           .with_columns((pl.col("best_distance") <= args.threshold).alias("assigned"),
                         pl.col("gcf_04_all").list.len().fill_null(0).cast(pl.Int32).alias("n_gcf_04"),
                         pl.lit(args.shard, dtype=pl.Int32).alias("shard"),
                         pl.lit(args.threshold).alias("threshold"))
           .select(["bgc_id", "gcf_04", "gcf_04_all", "n_gcf_04", "best_distance", "assigned", "threshold", "shard"]))
    out.write_parquet(args.out, compression="zstd")
    na = int(out["assigned"].sum())
    mf = out.filter(pl.col("assigned") & (pl.col("n_gcf_04") > 1)).height
    print(f"shard {args.shard}: {na:,}/{out.height:,} assigned; multi-family {mf:,} -> {args.out}", flush=True)


if __name__ == "__main__":
    main()
