"""Concatenate per-shard orphan-query assignments.

Usage: concat_orphan_v3.py --out FILE [--indir DIR] [--label TEXT]
"""
from __future__ import annotations
import argparse
import polars as pl

WORK = "/work/atlas-clustering-v2"
ORPH = f"{WORK}/orphan-v3"


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--indir", default="assignments")
    ap.add_argument("--out", required=True)
    ap.add_argument("--label", default="v3 orphan-query @0.4")
    args = ap.parse_args()

    df = pl.read_parquet(f"{ORPH}/{args.indir}/s*.parquet")
    df.write_parquet(args.out, compression="zstd")
    meta = pl.read_parquet(f"{ORPH}/orphan_meta.parquet").select(
        ["bgc_id", "completeness_class", "source"])
    m = df.join(meta, on="bgc_id", how="left")

    n, na = df.height, int(df["assigned"].sum())
    print(f"\n=== {args.label} === orphans queried: {n:,} | self-assigned: {na:,} "
          f"({100*na/n:.1f}%) | still novel: {n-na:,} ({100*(n-na)/n:.1f}%) -> {args.out}")
    print("by completeness class:")
    print(m.group_by("completeness_class").agg(
        pl.len().alias("n"), pl.col("assigned").mean().round(3).alias("frac_assigned")))


if __name__ == "__main__":
    main()
