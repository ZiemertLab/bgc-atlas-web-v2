"""Index all_regions_gbk.tar in parallel into input/tar_index.parquet (bgc_id, offset_data, size).

Usage: index_tar.py [--workers N]
Assumes plain ustar members with names under 100 chars (no GNU long-name records). Each worker
starts at the first header in its byte range that passes the checksum, so data blocks cannot
pose as headers, and owns the members whose header starts inside its range.
"""
from __future__ import annotations
import argparse
import os
import multiprocessing as mp

import pyarrow as pa
import pyarrow.compute as pc
import pyarrow.parquet as pq

V = "/work/atlas-clustering-v2"
TAR = f"{V}/input/all_regions_gbk.tar"
OUT = f"{V}/input/tar_index.parquet"
BLOCK = 512


def parse_header(b: bytes):
    """Return (name, typeflag, size) if b is a valid ustar header, else None."""
    if len(b) < BLOCK or b[257:262] != b"ustar":
        return None
    try:
        stored = int(b[148:156].split(b"\x00")[0].strip() or b"-1", 8)
    except ValueError:
        return None
    calc = sum(b[:148]) + 256 + sum(b[156:BLOCK])  # chksum field counted as 8 spaces
    if calc != stored:
        return None
    name = b[:100].split(b"\x00", 1)[0]
    try:
        size = int(b[124:136].split(b"\x00")[0].strip() or b"0", 8)
    except ValueError:
        return None
    return name, b[156:157], size


def worker(rng: tuple[int, int]):
    start, end = rng
    res = []
    with open(TAR, "rb") as f:
        pos = (start + BLOCK - 1) // BLOCK * BLOCK
        while pos < end:
            f.seek(pos)
            b = f.read(BLOCK)
            if len(b) < BLOCK:
                return res
            if parse_header(b) is not None:
                break
            pos += BLOCK
        else:
            return res
        while pos < end:
            f.seek(pos)
            b = f.read(BLOCK)
            h = parse_header(b)
            if h is None:
                break
            name, tf, size = h
            data_off = pos + BLOCK
            if tf in (b"0", b"\x00") and name.endswith(b".gbk"):
                res.append((os.path.basename(name.decode("ascii", "replace"))[:-4],
                            data_off, size))
            pos = data_off + ((size + BLOCK - 1) // BLOCK) * BLOCK
    return res


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--workers", type=int, default=32)
    args = ap.parse_args()

    fsize = os.path.getsize(TAR)
    n = args.workers
    step = ((fsize // n) + BLOCK - 1) // BLOCK * BLOCK
    ranges = [(i * step, fsize if i == n - 1 else (i + 1) * step) for i in range(n)]
    print(f"tar={fsize:,} B, {n} workers, step={step:,} B", flush=True)

    with mp.Pool(n) as pool:
        parts = pool.map(worker, ranges)
    rows = [r for p in parts for r in p]

    tbl = pa.table({
        "bgc_id":      pa.array([r[0] for r in rows], pa.string()),
        "offset_data": pa.array([r[1] for r in rows], pa.int64()),
        "size":        pa.array([r[2] for r in rows], pa.int64()),
    })
    nrows = tbl.num_rows
    nuniq = pc.count_distinct(tbl["bgc_id"]).as_py()
    print(f"indexed {nrows:,} members, {nuniq:,} unique bgc_id "
          f"(dups: {nrows - nuniq:,})", flush=True)

    off = tbl["offset_data"].to_pylist()
    szs = tbl["size"].to_pylist()
    ids = tbl["bgc_id"].to_pylist()
    bad = 0
    sample_idx = list(range(0, nrows, max(1, nrows // 50)))[:50]
    with open(TAR, "rb") as f:
        for i in sample_idx:
            f.seek(off[i])
            head = f.read(6)
            if not head.startswith(b"LOCUS"):
                bad += 1
                print(f"  BAD sample {ids[i]} @ {off[i]}: {head!r}")
    print(f"sample check: {bad} bad of ~50", flush=True)
    if bad == 0 and nrows == nuniq:
        pq.write_table(tbl, OUT, compression="zstd")
        print(f"wrote {OUT}", flush=True)
    else:
        print("VALIDATION FAILED — not writing index", flush=True)
        raise SystemExit(1)


if __name__ == "__main__":
    main()
