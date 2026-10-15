"""Extract one orphan shard's GBKs into a BiG-SLiCE query folder.

Usage: extract_shard_gbk_v3.py --shard N --out-dir DIR [--limit N]
Files are named <uuid>.region001.gbk to satisfy BiG-SLiCE's name regex; the real region
number is read from the GBK content.
"""
from __future__ import annotations
import argparse
import os
import polars as pl

WORK = "/work/atlas-clustering-v2"
TAR = f"{WORK}/input/all_regions_gbk.tar"
IDX = f"{WORK}/input/tar_index.parquet"
META = f"{WORK}/orphan-v3/orphan_meta.parquet"


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--shard", type=int, required=True)
    ap.add_argument("--out-dir", required=True, help="query folder; gbk go here flat")
    ap.add_argument("--limit", type=int, default=0, help="mini-pilot: only N members")
    args = ap.parse_args()

    meta = pl.read_parquet(META).filter(pl.col("shard") == args.shard).select("bgc_id")
    if args.limit:
        meta = meta.head(args.limit)
    idx = pl.read_parquet(IDX)
    j = meta.join(idx, on="bgc_id", how="inner").select(["bgc_id", "offset_data", "size"])

    gdir = args.out_dir
    os.makedirs(gdir, exist_ok=True)
    w = 0
    with open(TAR, "rb") as f:
        for uuid, off, size in j.iter_rows():
            f.seek(off)
            data = f.read(size)
            with open(os.path.join(gdir, f"{uuid}.region001.gbk"), "wb") as o:
                o.write(data)
            w += 1
    print(f"shard {args.shard}: extracted {w:,} gbk -> {gdir} "
          f"(missing from tar_index: {meta.height - j.height})", flush=True)


if __name__ == "__main__":
    main()
