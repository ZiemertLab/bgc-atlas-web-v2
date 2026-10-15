#!/usr/bin/env python3
"""Pre-build the BiG-SLiCE GCF-centroid cache (result/cache/gcf_models_<clustering_id>.pkl).

BiG-SLiCE's own fallback rebuilds the matrix into a uint8 array (truncating float centroids,
or taking hours) and never caches it. `Membership.assign` trusts the pickle blindly, so the
columns must be the hmm ids in assign()'s own order (compared positionally) and the index one
gcf id per row. Reads the model db in one sequential scan: random seeks on CephFS take hours.

Usage (inside the bigslice image, so the pickle is written by the pandas that reads it):

  docker run --rm --user "$(id -u):$(id -g)" -v /data/bgc-atlas:/data/bgc-atlas \\
    bigslice:2.0.2 python3 /data/bgc-atlas/.../bigslice-query/bin/build_gcf_model_cache.py \\
      --workspace /data/bgc-atlas/.../bigslice-query/seed --run-id 1 [--expect-gcfs 371651]
"""
from __future__ import annotations

import argparse
import json
import os
import random
import sqlite3
import sys
import time

import numpy as np
import pandas as pd

from bigslice.modules.utils import store_pickle

BATCH = 500_000
N_SAMPLE = 1000


def log(t0: float, msg: str) -> None:
    print(f"[{time.time() - t0:7.1f}s] {msg}", flush=True)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--workspace", required=True,
                    help="query workspace; reads <ws>/result/data.db, writes <ws>/result/cache/")
    ap.add_argument("--run-id", type=int, default=1)
    ap.add_argument("--expect-gcfs", type=int,
                    help="assert the clustering has exactly this many centroids")
    ap.add_argument("--expect-hmms", type=int, default=8371)
    ap.add_argument("--seed", type=int, default=20260819, help="reservoir-sampling seed")
    args = ap.parse_args()

    t0 = time.time()
    db_path = os.path.join(args.workspace, "result", "data.db")
    cache_dir = os.path.join(args.workspace, "result", "cache")
    os.makedirs(cache_dir, exist_ok=True)

    con = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)

    clustering_ids = [r[0] for r in con.execute(
        "SELECT id FROM clustering WHERE run_id=?", (args.run_id,))]
    if len(clustering_ids) != 1:
        print(f"FAIL: run {args.run_id} has {len(clustering_ids)} clusterings, expected 1")
        return 1
    clustering_id = clustering_ids[0]

    # Column order: character-for-character the select in Membership.assign. No ORDER BY.
    hmm_ids = [r[0] for r in con.execute(
        "SELECT hmm.id FROM hmm,run WHERE hmm.db_id=run.hmm_db_id AND run.id=?",
        (args.run_id,))]
    # Row order: assign()'s own fallback select.
    gcf_ids = [r[0] for r in con.execute(
        "SELECT gcf.id FROM gcf,clustering"
        " WHERE clustering.run_id=? AND gcf.clustering_id=clustering.id",
        (args.run_id,))]

    n_gcf, n_hmm = len(gcf_ids), len(hmm_ids)
    log(t0, f"clustering {clustering_id}: {n_gcf:,} centroids x {n_hmm:,} features"
            f" = {n_gcf * n_hmm * 8 / 2**30:.1f} GiB")

    if args.expect_hmms and n_hmm != args.expect_hmms:
        print(f"FAIL: {n_hmm} hmm features, expected {args.expect_hmms}")
        return 1
    if args.expect_gcfs and n_gcf != args.expect_gcfs:
        print(f"FAIL: {n_gcf} centroids, expected {args.expect_gcfs}")
        return 1
    if len(set(gcf_ids)) != n_gcf or len(set(hmm_ids)) != n_hmm:
        print("FAIL: duplicate id in the index or the columns")
        return 1

    # -1 marks another clustering's id: the residual db holds two clusterings in one
    # gcf_models table, so size the maps to the table's max id, not this clustering's.
    max_gcf = con.execute("SELECT max(id) FROM gcf").fetchone()[0]
    max_hmm = con.execute("SELECT max(id) FROM hmm").fetchone()[0]
    row_map = np.full(max_gcf + 1, -1, dtype=np.int64)
    row_map[np.asarray(gcf_ids, dtype=np.int64)] = np.arange(n_gcf)
    col_map = np.full(max_hmm + 1, -1, dtype=np.int64)
    col_map[np.asarray(hmm_ids, dtype=np.int64)] = np.arange(n_hmm)

    mat = np.zeros((n_gcf, n_hmm), dtype=np.float64)

    # Filter by the row_map mask, not in SQL: a join would mean a seek storm on CephFS.
    cur = con.execute("SELECT gcf_id, hmm_id, value FROM gcf_models")
    seen = kept = pool = 0
    rng = random.Random(args.seed)
    sample: list[tuple[int, int, float]] = []
    while True:
        batch = cur.fetchmany(BATCH)
        if not batch:
            break
        arr = np.asarray(batch, dtype=np.float64)
        r = row_map[arr[:, 0].astype(np.int64)]
        c = col_map[arr[:, 1].astype(np.int64)]
        m = r >= 0
        mat[r[m], c[m]] = arr[:, 2][m]

        for row in batch:
            seen += 1
            if row_map[row[0]] < 0:
                continue
            pool += 1
            if len(sample) < N_SAMPLE:
                sample.append(row)
            else:
                j = rng.randrange(pool)
                if j < N_SAMPLE:
                    sample[j] = row
        kept += int(m.sum())
        if seen % (20 * BATCH) == 0:
            log(t0, f"  {seen:,} rows read, {kept:,} kept")
    con.close()
    log(t0, f"filled from {seen:,} gcf_models rows ({kept:,} in clustering {clustering_id})")

    # Every stored cell is > 0, so fewer nonzero cells than `kept` means collisions.
    nonzero = int(np.count_nonzero(mat))
    log(t0, f"nonzero cells: {nonzero:,}")
    if nonzero != kept:
        print(f"FAIL: {nonzero:,} nonzero cells but {kept:,} rows written")
        return 1

    bad = 0
    for gcf_id, hmm_id, value in sample:
        r, c = row_map[int(gcf_id)], col_map[int(hmm_id)]
        if mat[r, c] != value:
            bad += 1
    if bad:
        print(f"FAIL: {bad}/{len(sample)} sampled cells do not match the database")
        return 1
    log(t0, f"sampled {len(sample)} cells: all match")

    df = pd.DataFrame(mat, index=gcf_ids, columns=hmm_ids)
    if list(df.columns) != hmm_ids or list(df.index) != gcf_ids:
        print("FAIL: DataFrame reordered the index or the columns")
        return 1
    if df.shape != (n_gcf, n_hmm):
        print(f"FAIL: shape {df.shape}, expected {(n_gcf, n_hmm)}")
        return 1

    # Write and rename, so a killed run never leaves a half-written pickle.
    final = os.path.join(cache_dir, f"gcf_models_{clustering_id}.pkl")
    tmp = final + ".tmp"
    log(t0, f"writing {final}")
    store_pickle(df, tmp)
    os.replace(tmp, final)
    size = os.path.getsize(final)
    log(t0, f"wrote {size / 2**30:.1f} GiB")

    print(json.dumps({
        "workspace": args.workspace, "run_id": args.run_id,
        "clustering_id": clustering_id, "n_gcf": n_gcf, "n_hmm": n_hmm,
        "gcf_models_rows_read": seen, "cells_written": kept,
        "path": final, "bytes": size,
    }, indent=2))
    print("\nCACHE OK")
    return 0


if __name__ == "__main__":
    sys.exit(main())
