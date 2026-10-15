#!/usr/bin/env python3
"""Verify a built centroid cache through bigslice's own `load_pickle`, in a fresh process.

Checks the column order against `Membership.assign`'s hmm select (compared positionally, so a
permutation gives plausible wrong distances), the index, and a sample of cells against
`gcf_models` (by scanning, not seeking, on CephFS).

Usage:
  docker run --rm --user "$(id -u):$(id -g)" -v /data/bgc-atlas:/data/bgc-atlas \\
    bigslice:2.0.2 python3 -u .../verify_gcf_model_cache.py --workspace .../seed --run-id 1
"""
from __future__ import annotations

import argparse
import os
import sqlite3
import sys
import time

import numpy as np

from bigslice.modules.utils import load_pickle

CHECK_ROWS = 200_000


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--workspace", required=True)
    ap.add_argument("--run-id", type=int, default=1)
    args = ap.parse_args()

    t0 = time.time()
    db_path = os.path.join(args.workspace, "result", "data.db")
    con = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)

    clustering_id = con.execute(
        "SELECT id FROM clustering WHERE run_id=?", (args.run_id,)).fetchone()[0]
    pkl = os.path.join(args.workspace, "result", "cache",
                       f"gcf_models_{clustering_id}.pkl")

    df = load_pickle(pkl)
    if df is None:
        print(f"FAIL: {pkl} does not exist")
        return 1
    print(f"[{time.time()-t0:6.1f}s] loaded {pkl}: {df.shape[0]:,} x {df.shape[1]:,}"
          f" dtype={df.values.dtype}", flush=True)

    hmm_ids = [r[0] for r in con.execute(
        "SELECT hmm.id FROM hmm,run WHERE hmm.db_id=run.hmm_db_id AND run.id=?",
        (args.run_id,))]
    gcf_ids = [r[0] for r in con.execute(
        "SELECT gcf.id FROM gcf,clustering"
        " WHERE clustering.run_id=? AND gcf.clustering_id=clustering.id",
        (args.run_id,))]

    ok = True
    if list(df.columns) != hmm_ids:
        print(f"FAIL: column order differs from assign()'s hmm select"
              f" ({len(df.columns)} vs {len(hmm_ids)} ids)")
        ok = False
    if sorted(df.index.astype(int)) != sorted(gcf_ids):
        print("FAIL: index is not the clustering's gcf id set")
        ok = False
    if df.shape != (len(gcf_ids), len(hmm_ids)):
        print(f"FAIL: shape {df.shape}, expected {(len(gcf_ids), len(hmm_ids))}")
        ok = False
    if not ok:
        return 1
    print(f"[{time.time()-t0:6.1f}s] index and column order match the model db", flush=True)

    # `assign()` uses .values positionally.
    values = df.values
    row_of = {g: i for i, g in enumerate(df.index.astype(int))}
    col_of = {h: i for i, h in enumerate(df.columns)}

    checked = bad = 0
    cur = con.execute("SELECT gcf_id, hmm_id, value FROM gcf_models")
    while checked < CHECK_ROWS:
        batch = cur.fetchmany(50_000)
        if not batch:
            break
        for gcf_id, hmm_id, value in batch:
            r = row_of.get(gcf_id)
            if r is None:          # the other clustering in this db
                continue
            if values[r, col_of[hmm_id]] != value:
                bad += 1
            checked += 1
    con.close()

    if bad:
        print(f"FAIL: {bad:,}/{checked:,} cells differ from gcf_models")
        return 1
    print(f"[{time.time()-t0:6.1f}s] {checked:,} cells re-checked against gcf_models: all match")

    nonzero = int(np.count_nonzero(values))
    print(f"[{time.time()-t0:6.1f}s] nonzero cells: {nonzero:,}")
    print("\nCACHE VERIFIED")
    return 0


if __name__ == "__main__":
    sys.exit(main())
