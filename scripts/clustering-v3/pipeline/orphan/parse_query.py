"""Parse a BiG-SLiCE query reports db into nearest-GCF assignments.

Usage: parse_query.py (--db DB | --qout DIR) --threshold T --out FILE [--shard N]
Query mode stores the nearest source GCF (rank 0); a BGC is assigned only if distance <= threshold.
"""
from __future__ import annotations
import argparse
import glob
import sqlite3
import polars as pl


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", help="path to reports/<id>/data.db (or use --qout)")
    ap.add_argument("--qout", help="per-shard output folder; finds reports/*/data.db")
    ap.add_argument("--threshold", type=float, required=True)
    ap.add_argument("--shard", type=int, default=-1)
    ap.add_argument("--out", required=True)
    args = ap.parse_args()

    db = args.db or sorted(glob.glob(f"{args.qout}/reports/*/data.db"))[0]
    q = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
    rows = q.execute(
        "SELECT b.name, m.gcf_id, m.membership_value FROM gcf_membership m "
        "JOIN bgc b ON b.id=m.bgc_id WHERE m.rank=0").fetchall()
    df = pl.DataFrame(rows, schema=["name", "gcf_id", "distance"], orient="row")
    df = df.with_columns(
        pl.col("name").str.replace(r"^.*/", "").str.replace(r"\.region\d+$", "").alias("bgc_id"),
        (pl.col("distance") <= args.threshold).alias("assigned"),
        pl.lit(args.shard, dtype=pl.Int32).alias("shard"),
        pl.lit(args.threshold).alias("threshold"),
    ).select(["bgc_id", "gcf_id", "distance", "assigned", "threshold", "shard"])
    df.write_parquet(args.out, compression="zstd")
    na = int(df["assigned"].sum())
    print(f"shard {args.shard}: {na:,}/{df.height:,} self-assigned "
          f"({100*na/df.height:.1f}%) @dist<={args.threshold} -> {args.out}")


if __name__ == "__main__":
    main()
