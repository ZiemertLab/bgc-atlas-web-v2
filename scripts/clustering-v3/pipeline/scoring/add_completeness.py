"""Add primary_category, completeness_class and hybrid_structure to features.parquet, in place.

Length baselines per category come from GTDB non-edge single-protocluster BGCs. Uses only
contig_edge, bgc_length, categories and cand_kinds (antiSMASH 8 lacks contig_length).
"""
from __future__ import annotations
import polars as pl

WORK = "/work/atlas-clustering-v2"
FEAT = f"{WORK}/features/features.parquet"
FRAG_FACTOR = 0.30  # len_frag = FRAG_FACTOR * len_p50


def main() -> None:
    df = pl.read_parquet(FEAT)
    # drop any prior run's derived cols so this is idempotent
    df = df.drop([c for c in ("primary_category", "completeness_class", "hybrid_structure")
                  if c in df.columns])

    # primary category = first protocluster category (encounter order); else 'other'
    df = df.with_columns(
        pl.when(pl.col("categories").list.len() > 0)
        .then(pl.col("categories").list.first())
        .otherwise(pl.lit("other"))
        .alias("primary_category"))

    # baselines from the GTDB non-edge single-protocluster reference subset
    ref = df.filter((pl.col("source") == "GTDB") & (~pl.col("contig_edge").fill_null(True))
                    & (pl.col("n_protoclusters") == 1) & pl.col("bgc_length").is_not_null())
    base = (ref.group_by("primary_category").agg(
        pl.col("bgc_length").quantile(0.10, "linear").round().alias("len_p10"),
        pl.col("bgc_length").quantile(0.50, "linear").round().alias("len_p50"),
        pl.len().alias("n_ref")).sort("n_ref", descending=True))
    g10 = ref["bgc_length"].quantile(0.10, "linear")
    g50 = ref["bgc_length"].quantile(0.50, "linear")
    print(f"GTDB reference subset: {ref.height:,} BGCs | global p10={g10:.0f} p50={g50:.0f}")
    with pl.Config(tbl_rows=40):
        print(base)

    # attach per-category baselines; categories with no GTDB ref fall back to global
    df = df.join(base.select(["primary_category", "len_p10", "len_p50"]),
                 on="primary_category", how="left").with_columns([
        pl.col("len_p10").fill_null(round(g10)),
        pl.col("len_p50").fill_null(round(g50)),
    ]).with_columns((FRAG_FACTOR * pl.col("len_p50")).round().alias("len_frag"))

    ce, bl = pl.col("contig_edge"), pl.col("bgc_length")
    df = df.with_columns(
        pl.when(bl.is_null()).then(pl.lit("fragment"))
        .when((~ce) & (bl >= pl.col("len_p50"))).then(pl.lit("complete"))
        .when(ce & (bl >= pl.col("len_p50"))).then(pl.lit("near-complete"))
        .when(bl >= pl.col("len_p10")).then(pl.lit("core-complete"))
        .when(bl >= pl.col("len_frag")).then(pl.lit("partial"))
        .otherwise(pl.lit("fragment")).alias("completeness_class"))

    df = df.with_columns(
        pl.when(pl.col("cand_kinds").list.contains("chemical_hybrid")).then(pl.lit("chemical_hybrid"))
        .when(pl.col("cand_kinds").list.contains("interleaved")).then(pl.lit("interleaved"))
        .when(pl.col("cand_kinds").list.contains("neighbouring")).then(pl.lit("neighbouring"))
        .otherwise(pl.lit("single")).alias("hybrid_structure"))

    df = df.drop(["len_p10", "len_p50", "len_frag"])
    df.write_parquet(FEAT, compression="zstd")

    order = ["complete", "near-complete", "core-complete", "partial", "fragment"]
    dist = df.group_by("completeness_class").agg(pl.len().alias("n"))
    dist = dist.with_columns((100 * pl.col("n") / df.height).round(2).alias("pct")).sort(
        pl.col("completeness_class").cast(pl.Enum(order)))
    print("\ncompleteness_class:")
    print(dist)
    print("\nhybrid_structure:")
    print(df.group_by("hybrid_structure").agg(pl.len().alias("n")).sort("n", descending=True))
    cc = df.filter(pl.col("completeness_class").is_in(["complete", "near-complete"])).height
    print(f"\ncomplete+near-complete (dedup95 input): {cc:,}  ({100*cc/df.height:.1f}%)")


if __name__ == "__main__":
    main()
