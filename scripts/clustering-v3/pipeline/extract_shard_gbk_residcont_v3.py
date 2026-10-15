"""Extract one residual orphan shard's GBKs into a BiG-SLiCE query folder.

Usage: extract_shard_gbk_residcont_v3.py --shard N --out-dir DIR [--limit N]
"""
from __future__ import annotations
import argparse
import os
import polars as pl

WORK = "/work/atlas-clustering-v2"
TAR = f"{WORK}/input/all_regions_gbk.tar"
IDX = f"{WORK}/input/tar_index.parquet"
META = f"{WORK}/residcont-v3/orphan/orphan_meta.parquet"


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--shard", type=int, required=True)
    ap.add_argument("--out-dir", required=True)
    ap.add_argument("--limit", type=int, default=0)
    args = ap.parse_args()

    meta = pl.read_parquet(META).filter(pl.col("shard") == args.shard).select("bgc_id")
    if args.limit:
        meta = meta.head(args.limit)
    idx = pl.read_parquet(IDX)
    j = meta.join(idx, on="bgc_id", how="inner").select(["bgc_id", "offset_data", "size"])

    os.makedirs(args.out_dir, exist_ok=True)
    w = 0
    with open(TAR, "rb") as f:
        for uuid, off, size in j.iter_rows():
            f.seek(off)
            data = f.read(size)
            with open(os.path.join(args.out_dir, f"{uuid}.region001.gbk"), "wb") as o:
                o.write(data)
            w += 1
    print(f"shard {args.shard}: extracted {w:,} gbk -> {args.out_dir} "
          f"(missing: {meta.height - j.height})", flush=True)


if __name__ == "__main__":
    main()
