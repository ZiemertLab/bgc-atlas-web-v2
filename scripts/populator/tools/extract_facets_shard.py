#!/usr/bin/env python3
"""Phase 1 of the facet backfill: DB-free facet extraction.

Runs on a compute node with no DB or repo: needs only `antismash_facets.py`
alongside this file and `ijson`. Writes gzipped NDJSON shards, each record
stamped with its run `file_path` for the Phase 2 join. A shard with a `.done`
marker is skipped on resume.

Usage:
  python3 extract_facets_shard.py --runlist node.txt --out-dir /data/bgc-atlas/.../shards \
      --workers 64 --node node1
"""
from __future__ import annotations

import argparse
import gzip
import json
import os
import sys
import time
from concurrent.futures import ProcessPoolExecutor, as_completed
from typing import List

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
try:
    # Co-located copy on compute nodes.
    from antismash_facets import stream_facets_from_tar  # noqa: E402
except ImportError:
    sys.path.insert(0, os.path.abspath(
        os.path.join(os.path.dirname(__file__), "..", "..", "..")))
    from scripts.populator.adapters.antismash_facets import (  # noqa: E402
        stream_facets_from_tar,
    )


def chunk_runs(runs: List[str], nchunks: int) -> List[List[str]]:
    """Round-robin split so big runs are spread evenly across chunks."""
    nchunks = max(1, min(nchunks, len(runs)))
    out: List[List[str]] = [[] for _ in range(nchunks)]
    for i, r in enumerate(runs):
        out[i % nchunks].append(r)
    return [c for c in out if c]


def _process_chunk(chunk_id: str, run_paths: List[str], out_dir: str):
    out = os.path.join(out_dir, f"shard_{chunk_id}.ndjson.gz")
    done = out + ".done"
    if os.path.exists(done):
        return chunk_id, 0, 0, 0, "skipped"
    tmp = out + ".tmp"
    n_runs = n_docs = errs = 0
    with gzip.open(tmp, "wt") as f:
        for path in run_paths:
            n_runs += 1
            try:
                for rec in stream_facets_from_tar(path):
                    rec["file_path"] = path
                    f.write(json.dumps(rec))
                    f.write("\n")
                    n_docs += 1
            except Exception as e:  # noqa: BLE001 - per-run isolation, keep going
                errs += 1
                sys.stderr.write(f"ERR {path}: {e}\n")
    os.replace(tmp, out)
    with open(done, "w") as d:
        d.write(f"{n_runs} {n_docs} {errs}\n")
    return chunk_id, n_runs, n_docs, errs, "ok"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--runlist", required=True)
    ap.add_argument("--out-dir", required=True)
    ap.add_argument("--workers", type=int, required=True)
    ap.add_argument("--node", default="node")
    ap.add_argument("--chunks-per-worker", type=int, default=4,
                    help="more chunks -> finer resume granularity")
    args = ap.parse_args()

    runs = [l.strip() for l in open(args.runlist) if l.strip()]
    os.makedirs(args.out_dir, exist_ok=True)
    chunks = chunk_runs(runs, args.workers * args.chunks_per_worker)
    tasks = [(f"{args.node}_{i:04d}", c, args.out_dir) for i, c in enumerate(chunks)]
    print(f"[{args.node}] {len(runs)} runs -> {len(tasks)} chunks, {args.workers} workers",
          flush=True)

    t0 = time.time()
    done_runs = done_docs = done_errs = 0
    with ProcessPoolExecutor(max_workers=args.workers) as ex:
        futs = [ex.submit(_process_chunk, *t) for t in tasks]
        for k, fut in enumerate(as_completed(futs), 1):
            cid, nr, nd, ne, status = fut.result()
            done_runs += nr
            done_docs += nd
            done_errs += ne
            if k % 10 == 0 or k == len(futs):
                el = time.time() - t0
                print(f"[{args.node}] {k}/{len(futs)} chunks | runs={done_runs} "
                      f"docs={done_docs} errs={done_errs} | {done_runs/el:.0f} runs/s",
                      flush=True)
    print(f"[{args.node}] COMPLETE runs={done_runs} docs={done_docs} errs={done_errs} "
          f"in {(time.time()-t0)/60:.1f} min", flush=True)


if __name__ == "__main__":
    main()
