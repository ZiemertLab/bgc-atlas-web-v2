import polars as pl
V="/work/atlas-clustering-v2"
df=pl.read_parquet(f"{V}/residcont-v3/orphan/assignments/s*.parquet")
df.write_parquet(f"{V}/residcont-v3/orphan/residq_assignments.parquet", compression="zstd")
n=df.height; na=int(df["assigned"].sum())
col="residual_gcf_04"
asg=df.filter(pl.col("assigned"))
print(f"remaining fragments queried: {n:,}")
print(f"assigned to a residual GCF @0.4: {na:,} ({100*na/n:.1f}%)")
print(f"still unassigned: {n-na:,} ({100*(n-na)/n:.1f}%)")
print(f"distinct residual GCFs receiving a fragment: {asg[col].n_unique():,}")
