"""Concatenate feature shards and left-join input/bgc_uuid_source.parquet into features.parquet.

The scan writes source="pooled" as a placeholder; the real source comes from this join.
"""
from __future__ import annotations
import time
import polars as pl

WORK = "/work/atlas-clustering-v2"
SHARDS = f"{WORK}/features/shards/pooled/shard_*.parquet"
SRC = f"{WORK}/input/bgc_uuid_source.parquet"
OUT = f"{WORK}/features/features.parquet"

META_COLS = ["bgc_id", "source", "assembly_source", "sample_id", "sample_accession",
             "genome_accession", "contig", "environment_biome", "gtdb_lineage"]


def main() -> None:
    t0 = time.monotonic()
    feats = pl.read_parquet(SHARDS).drop("source")
    n_feat = feats.height
    n_uuid = feats["bgc_id"].n_unique()
    print(f"[+{time.monotonic()-t0:.1f}s] shards: {n_feat:,} rows | unique bgc_id {n_uuid:,} "
          f"| dup bgc_ids {n_feat-n_uuid:,}", flush=True)

    src = pl.read_parquet(SRC, columns=META_COLS).rename({"contig": "db_contig"})
    print(f"[+{time.monotonic()-t0:.1f}s] source table: {src.height:,} rows", flush=True)

    fid = feats.select("bgc_id").unique()
    sid = src.select("bgc_id")
    only_tar = fid.join(sid, on="bgc_id", how="anti").height
    only_db = sid.join(fid, on="bgc_id", how="anti").height
    print(f"bgc_ids only in tar (unmatched features): {only_tar:,}")
    print(f"bgc_ids only in DB table (absent from tar): {only_db:,}")

    df = feats.join(src, on="bgc_id", how="left")
    matched = df.select(pl.col("source").is_not_null().sum()).item()
    print(f"join: {matched:,}/{n_feat:,} feature rows got provenance "
          f"({n_feat-matched:,} null source)")

    both = df.select((pl.col("record_id").is_not_null() & pl.col("db_contig").is_not_null()).sum()).item()
    match_c = df.select(((pl.col("record_id") == pl.col("db_contig"))).sum()).item()
    print(f"record_id == db_contig: {match_c:,}/{both:,} ({both-match_c:,} mismatch)")

    df = df.drop("db_contig")
    df.write_parquet(OUT, compression="zstd")
    print(f"[+{time.monotonic()-t0:.1f}s] wrote {OUT}: {df.height:,} rows x {len(df.columns)} cols",
          flush=True)

    print("\nper-source counts:")
    with pl.Config(tbl_rows=40, fmt_str_lengths=40):
        print(df.group_by("source").agg(
            pl.len().alias("n"),
            pl.col("contig_edge").mean().round(3).alias("frac_edge"),
            pl.col("bgc_length").median().alias("med_len"),
        ).sort("n", descending=True))


if __name__ == "__main__":
    main()
