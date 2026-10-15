#!/usr/bin/env python3
"""Concatenate the shard _lca.tsv files into taxonomy_assignments.parquet.

_lca.tsv columns (contig mode, --tax-lineage 1 + --lca-ranks): bgc_id, taxid, rank, name,
n_orfs, n_assigned, n_agree, support, lineage_names, lineage_ranked. taxid 0 = unclassified.
"""
import glob, os, sys
import polars as pl

V = "/work/atlas-clustering-v2"
OUT = f"{V}/taxonomy/out"
DEST = f"{V}/taxonomy/taxonomy_assignments.parquet"

files = sorted(glob.glob(f"{OUT}/shard_*_lca.tsv"))
if not files:
    sys.exit("no shard _lca.tsv files found")
print(f"{len(files)} shard files")

COLS = ["bgc_id", "taxid", "rank", "name", "n_orfs", "n_assigned",
        "n_agree", "support", "lineage_names", "lineage_ranked"]

frames = []
total = 0
for f in files:
    df = pl.read_csv(f, separator="\t", has_header=False, new_columns=COLS,
                     infer_schema_length=0, truncate_ragged_lines=True)
    total += df.height
    frames.append(df)
    print(f"  {os.path.basename(f)}: {df.height}")

df = pl.concat(frames)
print(f"concatenated rows: {df.height}")

df = df.with_columns([
    pl.col("taxid").cast(pl.Int64, strict=False),
    pl.col("n_orfs").cast(pl.Int64, strict=False),
    pl.col("n_assigned").cast(pl.Int64, strict=False),
    pl.col("n_agree").cast(pl.Int64, strict=False),
    pl.col("support").cast(pl.Float64, strict=False),
])
df = df.with_columns([
    pl.when(pl.col(c).str.len_chars() == 0).then(None).otherwise(pl.col(c)).alias(c)
    for c in ("name", "lineage_names", "lineage_ranked")
])

prefixes = {"domain": "d_", "phylum": "p_", "class": "c_", "order": "o_",
            "family": "f_", "genus": "g_", "species": "s_"}
def rank_expr(pref):
    return (pl.col("lineage_ranked").str.extract(rf"{pref}([^;]+)", 1))

df = df.with_columns([rank_expr(p).alias(c) for c, p in prefixes.items()])
df = df.with_columns(pl.col("taxid").fill_null(0))
df = df.with_columns(classified=pl.col("taxid") != 0)

n_class = df.filter(pl.col("classified")).height
print(f"classified: {n_class}/{df.height} = {100*n_class/df.height:.2f}%")
print("rank distribution (assigned):")
print(df.filter(pl.col("classified")).group_by("rank").len().sort("len", descending=True))
dups = df.height - df["bgc_id"].n_unique()
print(f"duplicate bgc_id rows: {dups}")

df.write_parquet(DEST, compression="zstd")
print(f"wrote {DEST}  ({df.height} rows, {df.width} cols)")
print(df.columns)
