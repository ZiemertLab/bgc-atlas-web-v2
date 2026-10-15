"""Per-(bgc_id, gcf_04) containment identity for clustering-v3. Runs on the HPC cluster.

containment_assignments.parquet is best-hit only, so the secondary memberships in
gcf_04_all need their identities reduced from containment-v3/easy_search.m8 (not exported).
Join semantics match scripts/v3/containment_multifamily_v3.py. Emits all (bgc, gcf) pairs,
primary included.

  distance = 1 - identity/100      (the v2 containment rule)

Usage (on the HPC cluster):
  python3 scripts/v3/reduce_multifamily_identity_v3.py
  ATLAS_RUN=<run dir> OUT=<parquet> python3 ...   # another clustering run
"""
from __future__ import annotations

import os
import sqlite3
import time

import polars as pl

V = os.environ.get("ATLAS_RUN", "/work/atlas-clustering-v2")
C = f"{V}/containment-v3"
DB = f"{V}/bigslice-output-v3/result/data.db"
OUT = os.environ.get("OUT", f"{C}/containment_identity_v3.parquet")


def main() -> None:
    t0 = time.time()

    # rank 0 is the assignment
    con = sqlite3.connect(f"file:{DB}?mode=ro", uri=True)
    rows = con.execute(
        "SELECT b.name, m.gcf_id FROM gcf_membership m JOIN bgc b ON b.id=m.bgc_id "
        "WHERE m.rank=0"
    ).fetchall()
    con.close()
    tg = (pl.DataFrame(rows, schema=["name", "gcf"], orient="row")
          .with_columns(pl.col("name").str.replace(r"^genomes/", "")
                        .str.replace(r"\.region\d+$", "").alias("target"))
          .select(["target", "gcf"]))
    print(f"[{time.time()-t0:6.1f}s] target->gcf rows: {tg.height:,}", flush=True)

    # MIBiG-only targets have no atlas GCF and drop out.
    h = (pl.read_csv(f"{C}/easy_search.m8", separator="\t", has_header=False,
                     new_columns=["query", "target", "pident", "qcov", "tcov", "bits"])
         .join(tg, on="target", how="left").drop_nulls("gcf"))
    print(f"[{time.time()-t0:6.1f}s] m8 hits with an atlas GCF: {h.height:,}", flush=True)

    gg = h.group_by(["query", "gcf"]).agg(pl.col("pident").max().alias("identity"))
    del h
    print(f"[{time.time()-t0:6.1f}s] distinct (query, gcf): {gg.height:,}", flush=True)

    # Expand each exact-unique query over its exact-duplicate member BGCs.
    qx = (pl.read_parquet(f"{C}/queries_exact.parquet")
          .select(["bgc_id", "exact_rep_id"]).rename({"exact_rep_id": "query"}))
    per_bgc = (qx.join(gg, on="query", how="inner")
               .select(["bgc_id", pl.col("gcf").alias("gcf_04"), "identity"]))
    del gg, qx

    per_bgc.write_parquet(OUT, compression="zstd")
    print(f"[{time.time()-t0:6.1f}s] wrote {OUT}", flush=True)

    n = per_bgc.height
    nb = per_bgc["bgc_id"].n_unique()
    print(f"\nrows (bgc,gcf pairs): {n:,}")
    print(f"distinct bgc_id:      {nb:,}   (first v3 build: 6,559,793 contained BGCs with a GCF)")
    print(f"distinct gcf_04:      {per_bgc['gcf_04'].n_unique():,}")
    print(f"identity min/max:     {per_bgc['identity'].min():.2f} / "
          f"{per_bgc['identity'].max():.2f}   (expect min >= 90)")
    print("\npairs per BGC:")
    print(per_bgc.group_by("bgc_id").agg(pl.len().alias("n"))
          .group_by("n").agg(pl.len().alias("bgcs")).sort("n").head(12))


if __name__ == "__main__":
    main()
