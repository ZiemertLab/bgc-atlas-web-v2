#!/usr/bin/env python3
"""Drop records of removed BGCs from a published region FASTA, append new ones -- in parallel.

The published FASTAs key every record to bgcs.id: regions_nuc.fasta `>{bgc_id}`, regions_prot.faa
`>{bgc_id}_{locus_tag}`, so header characters 2..37 are the region uuid. Splits the file at record
boundaries into --workers byte ranges, filters them concurrently into part files, then concatenates the parts
in order and appends --append, computing the output's sha256 on the way. Records stay in the same order.

Usage (stdlib only):
  filter_fasta_parallel.py --in regions_nuc.fasta --out regions_nuc.20261009.fasta --remove ids.txt
      [--append new_regions_nuc.fasta] [--workers 48]
Writes <out>, <out>.sha256 and <out>.counts (kept/dropped headers, dropped regions, appended headers).
"""
from __future__ import annotations

import argparse
import hashlib
import os
import sys
import time
from multiprocessing import Pool

CHUNK = 64 << 20


def boundaries(path: str, n: int) -> list[int]:
    size = os.path.getsize(path)
    cuts = [0]
    with open(path, "rb") as f:
        for i in range(1, n):
            f.seek(size * i // n)
            f.readline()                                  # finish the current line
            while True:
                pos = f.tell()
                line = f.readline()
                if not line or line.startswith(b">"):
                    cuts.append(pos if line else size)
                    break
    cuts.append(size)
    return sorted(set(cuts))


def work(args):
    path, start, end, remove_path, part = args
    remove = {l.strip().encode() for l in open(remove_path) if l.strip()}
    kept = dropped = 0
    dropped_ids = set()
    keep = True
    with open(path, "rb") as f, open(part, "wb", buffering=CHUNK) as out:
        f.seek(start)
        pos = start
        for line in f:
            if pos >= end:
                break
            pos += len(line)
            if line.startswith(b">"):
                rid = line[1:37]
                keep = rid not in remove
                if keep:
                    kept += 1
                else:
                    dropped += 1
                    dropped_ids.add(rid)
            if keep:
                out.write(line)
    return kept, dropped, dropped_ids


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--in", dest="src", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--remove", required=True)
    ap.add_argument("--append")
    ap.add_argument("--workers", type=int, default=48)
    a = ap.parse_args()

    t0 = time.time()
    cuts = boundaries(a.src, a.workers)
    parts = [f"{a.out}.part{i:04d}" for i in range(len(cuts) - 1)]
    jobs = [(a.src, cuts[i], cuts[i + 1], a.remove, parts[i]) for i in range(len(cuts) - 1)]
    with Pool(len(jobs)) as p:
        res = p.map(work, jobs)
    kept = sum(r[0] for r in res)
    dropped = sum(r[1] for r in res)
    dropped_regions = len(set().union(*(r[2] for r in res)))
    print(f"filtered {len(jobs)} ranges in {time.time() - t0:.0f}s: kept {kept:,} dropped {dropped:,} "
          f"headers ({dropped_regions:,} regions)", flush=True)

    sha = hashlib.sha256()
    appended = 0
    with open(a.out + ".tmp", "wb") as out:
        for part in parts + ([a.append] if a.append else []):
            with open(part, "rb") as f:
                while True:
                    buf = f.read(CHUNK)
                    if not buf:
                        break
                    if part == a.append:
                        appended += buf.count(b"\n>") + (1 if buf.startswith(b">") else 0)
                    sha.update(buf)
                    out.write(buf)
    os.replace(a.out + ".tmp", a.out)
    for part in parts:
        os.remove(part)
    with open(a.out + ".sha256", "w") as f:
        f.write(f"{sha.hexdigest()}  {os.path.basename(a.out)}\n")
    with open(a.out + ".counts", "w") as f:
        f.write(f"kept_headers {kept}\ndropped_headers {dropped}\ndropped_regions {dropped_regions}\n"
                f"appended_headers_approx {appended}\n")
    print(f"done in {time.time() - t0:.0f}s: {os.path.getsize(a.out):,} bytes, sha256 {sha.hexdigest()}", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
