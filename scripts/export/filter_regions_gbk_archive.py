#!/usr/bin/env python3
"""Rebuild the per-member region-GBK archive by COPYING compressed bytes: drop some regions, append others.

all_regions_gbk.tar.gz is one gzip member per region (repack_regions_gbk.py), described by its index
(<bgc_id>.gbk, gzip offset, gzip length, file size). So removing regions does not need the archive inflated:
copy every kept member's compressed bytes as they are, coalescing runs of adjacent kept members into large
sequential reads, then gzip each new region as its own member (exactly as repack_regions_gbk.py does), then
copy the old end-of-archive member. The new index and the output's sha256 are computed while writing.

The kept bytes are the old archive's own, already verified when it was built; the run is checked by
--verify-sample, which inflates a random sample of old and new members from the OUTPUT and checks each one's
tar header names its index row and its size.

Usage (stdlib only):
  filter_regions_gbk_archive.py --old all_regions_gbk.tar.gz --old-index index.tsv[.gz] --remove ids.txt
      --add new_regions_gbk.tar --out new.tar.gz --index new.index.tsv [--verify-sample 500]
  ids.txt: bgc ids (without .gbk), one per line.  new_regions_gbk.tar: an uncompressed tar of <bgc_id>.gbk.
"""
from __future__ import annotations

import argparse
import gzip
import hashlib
import os
import random
import sys
import tarfile
import time
import zlib

BLOCK = 512
COPY_CHUNK = 64 << 20


def gzip_member(raw: bytes) -> bytes:
    """Same settings as repack_regions_gbk.gzip_member: level 6, gzip wrapper."""
    c = zlib.compressobj(6, zlib.DEFLATED, 31)
    return c.compress(raw) + c.flush()


def read_index(path: str):
    op = gzip.open if path.endswith(".gz") else open
    rows = []
    with op(path, "rt") as f:
        for line in f:
            if line.startswith("#") or not line.strip():
                continue
            name, off, length, size = line.rstrip("\n").split("\t")
            rows.append((name, int(off), int(length), int(size)))
    rows.sort(key=lambda r: r[1])
    return rows


def new_members(tar_path: str):
    """Yield (name, raw tar bytes of header + padded data, size) for each member of an uncompressed tar."""
    with open(tar_path, "rb") as raw, tarfile.open(tar_path, "r:") as t:
        for m in t:
            if not m.isfile():
                continue
            if m.offset_data - m.offset != BLOCK:
                raise SystemExit(f"{m.name}: extended headers not supported here")
            padded = (m.size + BLOCK - 1) // BLOCK * BLOCK
            raw.seek(m.offset)
            yield m.name, raw.read(BLOCK + padded), m.size


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--old", required=True)
    ap.add_argument("--old-index", required=True)
    ap.add_argument("--remove", required=True)
    ap.add_argument("--add", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--index", required=True)
    ap.add_argument("--verify-sample", type=int, default=500)
    a = ap.parse_args()

    t0 = time.time()
    rows = read_index(a.old_index)
    old_size = os.path.getsize(a.old)
    last_end = max(off + ln for _, off, ln, _ in rows)
    remove = {l.strip() + ".gbk" for l in open(a.remove) if l.strip()}
    present = {r[0] for r in rows}
    removed_present = remove & present
    print(f"old: {len(rows):,} members, {old_size:,} bytes, eof member {old_size - last_end} bytes; "
          f"remove {len(remove):,} ids, {len(removed_present):,} of them in the archive", flush=True)

    sha = hashlib.sha256()
    out_index = []
    pos = 0
    with open(a.old, "rb") as src, open(a.out + ".tmp", "wb") as dst:
        def emit(buf: bytes):
            nonlocal pos
            dst.write(buf)
            sha.update(buf)
            pos += len(buf)

        def copy_range(start: int, end: int):
            src.seek(start)
            left = end - start
            while left:
                buf = src.read(min(COPY_CHUNK, left))
                if not buf:
                    raise SystemExit(f"short read at {start}")
                emit(buf)
                left -= len(buf)

        # Kept members, coalesced into contiguous runs. A pending run is written as one range when the next
        # kept member does not follow on from it; nothing else is written meanwhile, so a run lands at the
        # output position current when it started (run_out) and each member at run_out + its distance in.
        run_start = run_end = run_out = None
        kept = 0
        for name, off, ln, size in rows:
            if name in remove:
                continue
            if run_end is not None and off != run_end:
                copy_range(run_start, run_end)
                run_start = None
            if run_start is None:
                run_start, run_out = off, pos
            out_index.append((name, run_out + (off - run_start), ln, size))
            run_end = off + ln
            kept += 1
        if run_start is not None:
            copy_range(run_start, run_end)
        print(f"copied {kept:,} kept members ({pos:,} bytes) in {time.time() - t0:.0f}s", flush=True)

        added = 0
        kept_names = present - remove            # a removed id may come back with new content (a re-run)
        added_names = set()
        for name, raw, size in new_members(a.add):
            if name in kept_names:
                raise SystemExit(f"{name} is already in the old archive")
            if name in added_names:
                raise SystemExit(f"{name} is added twice")
            added_names.add(name)
            gz = gzip_member(raw)
            out_index.append((name, pos, len(gz), size))
            emit(gz)
            added += 1
        copy_range(last_end, old_size)          # end-of-archive member, unchanged
    os.replace(a.out + ".tmp", a.out)
    print(f"added {added:,} members; total {kept + added:,}; {pos:,} bytes; {time.time() - t0:.0f}s", flush=True)
    return finish(a, out_index, sha.hexdigest(), pos)


def finish(a, out_index, digest, size) -> int:
    with open(a.index, "w") as f:
        for name, off, ln, sz in out_index:
            f.write(f"{name}\t{off}\t{ln}\t{sz}\n")
    with open(a.out + ".sha256", "w") as f:
        f.write(f"{digest}  {os.path.basename(a.out)}\n")
    # verify: members tile the file without gaps, and a random sample inflates to the right tar member
    expect = 0
    for name, off, ln, _ in out_index:
        if off != expect:
            raise SystemExit(f"index gap/overlap at {name}: offset {off}, expected {expect}")
        expect = off + ln
    rng = random.Random(20261009)
    sample = rng.sample(out_index, min(a.verify_sample, len(out_index)))
    sample += out_index[-min(20, len(out_index)):]
    with open(a.out, "rb") as f:
        for name, off, ln, sz in sample:
            f.seek(off)
            raw = zlib.decompress(f.read(ln), 31)
            m = tarfile.TarInfo.frombuf(raw[:BLOCK], tarfile.ENCODING, "surrogateescape")
            if m.name != name or m.size != sz:
                raise SystemExit(f"verify FAILED at {name}: header says {m.name} size {m.size}")
    print(f"verified: index tiles {expect:,} bytes before the eof member; {len(sample)} sampled members inflate "
          f"to their own tar headers. sha256 {digest} size {size}", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
