"""Parse every .gbk member of a tar into <out-dir>/shards/<source>/shard_NNNNN.parquet.

Usage: scan_tar.py --tar TAR --source NAME --out-dir FEATURES_DIR [--limit N]
Workers receive only (uuid, offset, size) and read the tar themselves, so GBK bytes never pass
through IPC and nothing is extracted to disk.
"""
from __future__ import annotations

import argparse
import multiprocessing as mp
import os
import sys
import tarfile
import time
from pathlib import Path

import pyarrow as pa
import pyarrow.parquet as pq

sys.path.insert(0, str(Path(__file__).resolve().parent))
from parse_gbk import parse_gbk_bytes

SHARD_SCHEMA = pa.schema([
    ("bgc_id",                   pa.string()),
    ("source",                   pa.string()),
    ("record_id",                pa.string()),
    ("region",                   pa.int32()),
    ("size_bytes",               pa.int64()),
    ("bgc_length",               pa.int64()),
    ("contig_length",            pa.int64()),
    ("orig_start",               pa.int64()),
    ("orig_end",                 pa.int64()),
    ("contig_edge",              pa.bool_()),
    ("products",                 pa.list_(pa.string())),
    ("categories",               pa.list_(pa.string())),
    ("cand_kinds",               pa.list_(pa.string())),
    ("n_protoclusters",          pa.int32()),
    ("proto_core_span_bp",       pa.int64()),
    ("cds_count",                pa.int32()),
    ("n_biosynthetic",           pa.int32()),
    ("n_biosynthetic_add",       pa.int32()),
    ("n_regulatory",             pa.int32()),
    ("n_transport",              pa.int32()),
    ("n_resistance",             pa.int32()),
    ("n_other",                  pa.int32()),
    ("hypothetical_count",       pa.int32()),
    ("n_pfam_domain",            pa.int32()),
    ("n_asdomain",               pa.int32()),
    ("n_asmodule",               pa.int32()),
    ("asdomain_types_ordered",   pa.list_(pa.string())),
    ("sec_met_domains",          pa.list_(pa.string())),
    ("core_gene_types",          pa.list_(pa.string())),
    ("ordered_asdomain_string",  pa.string()),
    ("warnings",                 pa.list_(pa.string())),
])
_NAMES = [f.name for f in SHARD_SCHEMA]

_TAR: str | None = None
_SOURCE: str | None = None


def _init(tar_path: str, source: str) -> None:
    global _TAR, _SOURCE
    _TAR, _SOURCE = tar_path, source


def _process(arg: tuple[int, list[tuple[str, int, int]], str]) -> tuple[int, int]:
    shard_idx, entries, shards_dir = arg
    rows = []
    with open(_TAR, "rb") as f:
        for uuid, off, size in entries:
            f.seek(off)
            d = parse_gbk_bytes(f.read(size))
            d["bgc_id"] = uuid
            d["source"] = _SOURCE
            d["size_bytes"] = size
            rows.append(d)
    cols = {n: [r.get(n) for r in rows] for n in _NAMES}
    table = pa.table(cols, schema=SHARD_SCHEMA)
    pq.write_table(table, Path(shards_dir) / f"shard_{shard_idx:05d}.parquet",
                   compression="zstd")
    return shard_idx, len(rows)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--tar", required=True)
    ap.add_argument("--source", required=True)
    ap.add_argument("--out-dir", required=True, help="features/ dir; shards go to <out-dir>/shards/<source>/")
    ap.add_argument("--shard-size", type=int, default=10_000)
    ap.add_argument("--workers", type=int,
                    default=int(os.environ.get("SLURM_CPUS_PER_TASK", os.cpu_count() or 8)))
    ap.add_argument("--max-tasks-per-child", type=int, default=4,
                    help="recycle each worker after this many shards to release RAM (0=never)")
    ap.add_argument("--limit", type=int, default=0, help="smoke test: index at most N members (0=all)")
    args = ap.parse_args()

    t0 = time.monotonic()
    shards_dir = Path(args.out_dir) / "shards" / args.source
    # Stale shards from an earlier run would otherwise be concatenated too.
    if shards_dir.exists():
        for f in shards_dir.glob("shard_*.parquet"):
            f.unlink()
    shards_dir.mkdir(parents=True, exist_ok=True)

    index: list[tuple[str, int, int]] = []
    with tarfile.open(args.tar, "r:") as tar:
        for m in tar:
            if not m.isfile() or not m.name.endswith(".gbk"):
                continue
            index.append((os.path.basename(m.name)[:-4], m.offset_data, m.size))
            if args.limit and len(index) >= args.limit:
                break
    n = len(index)
    print(f"[+{time.monotonic()-t0:.1f}s] indexed {n:,} members from {args.source}", flush=True)
    if n == 0:
        print("no members — nothing to do", flush=True)
        return

    B = args.shard_size
    n_shards = (n + B - 1) // B
    tasks = [(i, index[i * B:(i + 1) * B], str(shards_dir)) for i in range(n_shards)]
    print(f"[+{time.monotonic()-t0:.1f}s] {n_shards} shards × {B:,}, workers={args.workers}", flush=True)

    done = rows_total = 0
    # maxtasksperchild recycles workers so per-worker memory cannot creep across shards.
    mtpc = args.max_tasks_per_child or None
    with mp.Pool(processes=args.workers, initializer=_init,
                 initargs=(args.tar, args.source), maxtasksperchild=mtpc) as pool:
        for _idx, nr in pool.imap_unordered(_process, tasks):
            done += 1
            rows_total += nr
            if done % 20 == 0 or done == n_shards:
                dt = time.monotonic() - t0
                rate = rows_total / dt if dt > 0 else 0
                print(f"[+{dt:.1f}s] {done}/{n_shards} shards "
                      f"({rows_total:,}/{n:,} rows, {rate:.0f} rows/s)", flush=True)

    print(f"[+{time.monotonic()-t0:.1f}s] DONE {args.source}: {rows_total:,} rows -> {shards_dir}", flush=True)


if __name__ == "__main__":
    main()
