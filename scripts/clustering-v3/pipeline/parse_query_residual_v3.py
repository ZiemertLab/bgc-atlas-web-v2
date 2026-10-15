"""Parse a BiG-SLiCE query reports db against the residual model.

Usage: parse_query_residual_v3.py --qout DIR --threshold T --out FILE [--clustering-id 1] [--shard N]
The reports db has no gcf table and the residual db holds two clusterings, so gcf_id is mapped
to clustering_id through the source db.
"""
from __future__ import annotations
import argparse
import glob
import sqlite3
import polars as pl

SRC_DB = "/work/atlas-clustering-v2/bigslice-output-residual-v3/result/data.db"


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--qout", required=True)
    ap.add_argument("--threshold", type=float, required=True)
    ap.add_argument("--clustering-id", type=int, default=1)
    ap.add_argument("--shard", type=int, default=-1)
    ap.add_argument("--out", required=True)
    args = ap.parse_args()

    s = sqlite3.connect(f"file:{SRC_DB}?mode=ro", uri=True)
    gmap = pl.DataFrame(s.execute("SELECT id AS gcf_id, clustering_id FROM gcf").fetchall(),
                        schema=["gcf_id", "clustering_id"], orient="row")
    s.close()

    db = sorted(glob.glob(f"{args.qout}/reports/*/data.db"))[0]
    q = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
    rows = q.execute("SELECT b.name, m.gcf_id, m.membership_value, m.rank "
                     "FROM gcf_membership m JOIN bgc b ON b.id=m.bgc_id").fetchall()
    q.close()
    df = (pl.DataFrame(rows, schema=["name", "gcf_id", "distance", "rank"], orient="row")
          .join(gmap, on="gcf_id", how="left")
          .filter(pl.col("clustering_id") == args.clustering_id)
          .with_columns(pl.col("name").str.replace(r"^.*/", "").str.replace(r"\.region\d+$", "").alias("bgc_id")))
    nearest = (df.sort(["bgc_id", "distance"]).group_by("bgc_id", maintain_order=True)
               .agg(pl.col("gcf_id").first().alias("residual_gcf_04"),
                    pl.col("distance").first().alias("best_distance")))
    out = (nearest.with_columns((pl.col("best_distance") <= args.threshold).alias("assigned"),
                                pl.lit(args.shard, dtype=pl.Int32).alias("shard"),
                                pl.lit(args.threshold).alias("threshold"))
           .select(["bgc_id", "residual_gcf_04", "best_distance", "assigned", "threshold", "shard"]))
    out.write_parquet(args.out, compression="zstd")
    na = int(out["assigned"].sum())
    print(f"shard {args.shard}: {na:,}/{out.height:,} assigned @dist<={args.threshold} -> {args.out}", flush=True)


if __name__ == "__main__":
    main()
