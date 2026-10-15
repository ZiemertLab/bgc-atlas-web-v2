"""Collapse byte-identical sequences in a FASTA before linclust (sha256 of the upper-cased sequence).

Usage: hash_dedup.py --in FASTA --out-fasta FASTA --out-membership PARQUET
The same BGC found in many genomes gets distinct ids but identical sequence; this removes that redundancy.
"""
from __future__ import annotations
import argparse
import hashlib
import time
import polars as pl


def read_fasta(path):
    hid, parts = None, []
    with open(path) as f:
        for line in f:
            if line.startswith(">"):
                if hid is not None:
                    yield hid, "".join(parts)
                hid = line[1:].strip().split()[0]
                parts = []
            else:
                parts.append(line.strip())
    if hid is not None:
        yield hid, "".join(parts)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--in", dest="inp", required=True)
    ap.add_argument("--out-fasta", required=True)
    ap.add_argument("--out-membership", required=True)
    args = ap.parse_args()

    t0 = time.monotonic()
    seen: set[str] = set()
    ids: list[str] = []
    hashes: list[str] = []
    n = 0
    with open(args.out_fasta, "w") as out:
        for hid, seq in read_fasta(args.inp):
            n += 1
            h = hashlib.sha256(seq.upper().encode()).hexdigest()
            ids.append(hid)
            hashes.append(h)
            if h not in seen:
                seen.add(h)
                out.write(f">{hid}\n{seq}\n")
            if n % 500_000 == 0:
                print(f"[+{time.monotonic()-t0:.1f}s] {n:,} in, {len(seen):,} unique", flush=True)

    df = pl.DataFrame({"bgc_id": ids, "seq_sha256": hashes})
    df = df.with_columns(
        pl.first("bgc_id").over("seq_sha256").alias("exact_rep_id"),
        pl.len().over("seq_sha256").alias("exact_cluster_size"),
    ).with_columns((pl.col("bgc_id") == pl.col("exact_rep_id")).alias("is_exact_rep"))
    df.write_parquet(args.out_membership, compression="zstd")

    n_uniq = len(seen)
    print(f"[+{time.monotonic()-t0:.1f}s] DONE: {n:,} seqs -> {n_uniq:,} exact-unique "
          f"({n-n_uniq:,} byte-identical removed, {100*(n-n_uniq)/n:.1f}%)")


if __name__ == "__main__":
    main()
