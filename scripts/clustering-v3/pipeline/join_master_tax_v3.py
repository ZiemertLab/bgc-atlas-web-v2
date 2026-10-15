"""Left-join the per-BGC GTDB taxonomy into the master table -> master_atlas_tax_v3.parquet.

Taxonomy is per BGC and independent of the clustering; it comes from scripts/taxonomy/
(taxonomy_assignments.parquet). Adds 15 tax_* columns. The downstream build accepts either
master file (bundle_config.py) and reads no tax_* column.
"""
import polars as pl

V = "/work/atlas-clustering-v2"
M = f"{V}/master/master_atlas_v3.parquet"
TAX = f"{V}/taxonomy/taxonomy_assignments.parquet"
DEST = f"{V}/master/master_atlas_tax_v3.parquet"

m = pl.read_parquet(M)
print(f"master: {m.height} rows, {m.width} cols")
assert "bgc_id" in m.columns

t = pl.read_parquet(TAX).select([
    "bgc_id",
    pl.col("taxid").alias("tax_taxid"),
    pl.col("rank").alias("tax_rank"),
    pl.col("name").alias("tax_taxon"),
    pl.col("support").alias("tax_support"),
    pl.col("n_orfs").alias("tax_n_orfs"),
    pl.col("classified").alias("tax_classified"),
    pl.col("domain").alias("tax_domain"),
    pl.col("phylum").alias("tax_phylum"),
    pl.col("class").alias("tax_class"),
    pl.col("order").alias("tax_order"),
    pl.col("family").alias("tax_family"),
    pl.col("genus").alias("tax_genus"),
    pl.col("species").alias("tax_species"),
    pl.col("lineage_ranked").alias("tax_lineage"),
])
print(f"taxonomy: {t.height} rows")

coll = (set(t.columns) & set(m.columns)) - {"bgc_id"}
assert not coll, f"unexpected column collisions: {coll}"

out = m.join(t, on="bgc_id", how="left")
assert out.height == m.height, f"row count changed {m.height} -> {out.height}"

matched = out.filter(pl.col("tax_taxid").is_not_null()).height
classified = out.filter(pl.col("tax_classified") == True).height
print(f"master rows: {out.height}")
print(f"  with a taxonomy row: {matched} ({100*matched/out.height:.2f}%)")
print(f"  classified (taxid!=0): {classified} ({100*classified/out.height:.2f}%)")
print(f"  no taxonomy (no nucleotide region): {out.height - matched}")
print("phylum distribution (top 15):")
print(out.filter(pl.col("tax_classified") == True)
        .group_by("tax_phylum").len().sort("len", descending=True).head(15))

out.write_parquet(DEST, compression="zstd")
print(f"wrote {DEST}  ({out.height} rows, {out.width} cols)")
