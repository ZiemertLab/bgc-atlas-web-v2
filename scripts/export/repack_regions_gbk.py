#!/usr/bin/env python3
"""Repack a region-GBK tar stream as one gzip member per file, plus an offset index.

The result is still an ordinary .tar.gz, but any region can be read with one seek:
inflate the ``length`` bytes at ``offset``. Tar bytes are copied untouched, so
``pigz -dc OUT | sha256sum`` must equal the input digest this prints.

Reads the UNCOMPRESSED tar on stdin:

    pigz -dc all_regions_gbk.tar.gz \\
      | python3 repack_regions_gbk.py --out new.tar.gz --index new.index.tsv

index.tsv: member name <TAB> gzip offset <TAB> gzip length <TAB> file size.
Extended headers share the gzip member of the file they describe; the end-of-archive
blocks are the final member and are not indexed.

After a rebuild, run publish_gbk_index.sh <index.tsv> once the new archive is in place.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import sys
import time
import zlib
from collections import deque
from concurrent.futures import ProcessPoolExecutor
from typing import BinaryIO, Iterator, List, Optional, Tuple

BLOCK = 512
ZERO = b"\0" * BLOCK
EXTENDED = (b"L", b"K", b"x", b"g")


def octal(field: bytes) -> int:
    if field and field[0] & 0x80:  # GNU base-256
        return int.from_bytes(field[1:], "big")
    digits = field.split(b"\0", 1)[0].strip()
    return int(digits, 8) if digits else 0


def header_name(hdr: bytes) -> str:
    name = hdr[0:100].split(b"\0", 1)[0]
    if hdr[257:262] == b"ustar":
        prefix = hdr[345:500].split(b"\0", 1)[0]
        if prefix:
            name = prefix + b"/" + name
    return name.decode("utf-8", "surrogateescape")


def pax_path(body: bytes) -> Optional[str]:
    for record in body.split(b"\n"):
        _, _, kv = record.partition(b" ")
        if kv.startswith(b"path="):
            return kv[5:].decode("utf-8", "surrogateescape")
    return None


class Reader:
    def __init__(self, stream: BinaryIO):
        self.stream = stream
        self.sha = hashlib.sha256()
        self.bytes = 0

    def read(self, n: int) -> bytes:
        chunks: List[bytes] = []
        left = n
        while left:
            chunk = self.stream.read(left)
            if not chunk:
                raise EOFError(f"tar stream ended {left} bytes short")
            chunks.append(chunk)
            left -= len(chunk)
        data = b"".join(chunks)
        self.sha.update(data)
        self.bytes += n
        return data

    def rest(self) -> bytes:
        data = self.stream.read()
        self.sha.update(data)
        self.bytes += len(data)
        return data


Member = Tuple[Optional[str], int, bytes]  # (name or None for the trailer, size, raw tar bytes)


def members(reader: Reader) -> Iterator[Member]:
    pending = b""
    longname: Optional[str] = None
    while True:
        hdr = reader.read(BLOCK)
        if hdr == ZERO:
            # End of archive: the second zero block and any record padding.
            yield None, 0, hdr + reader.rest()
            return
        size = octal(hdr[124:136])
        body = reader.read((size + BLOCK - 1) // BLOCK * BLOCK)
        kind = hdr[156:157]
        if kind in EXTENDED:
            pending += hdr + body
            if kind == b"L":
                longname = body[:size].split(b"\0", 1)[0].decode("utf-8", "surrogateescape")
            elif kind == b"x":
                longname = pax_path(body[:size]) or longname
            continue
        yield (longname or header_name(hdr)), size, pending + hdr + body
        pending = b""
        longname = None


def gzip_member(raw: bytes) -> bytes:
    # wbits 31 = gzip wrapper, mtime 0: the same input always gives the same bytes.
    c = zlib.compressobj(6, zlib.DEFLATED, 31)
    return c.compress(raw) + c.flush()


def compress_batch(batch: List[Member]) -> List[Tuple[Optional[str], int, bytes]]:
    return [(name, size, gzip_member(raw)) for name, size, raw in batch]


def batches(it: Iterator[Member], batch_bytes: int) -> Iterator[List[Member]]:
    batch: List[Member] = []
    held = 0
    for m in it:
        batch.append(m)
        held += len(m[2])
        if held >= batch_bytes:
            yield batch
            batch, held = [], 0
    if batch:
        yield batch


def repack(stream: BinaryIO, out: BinaryIO, index, workers: int,
           batch_bytes: int = 64 << 20, window: int = 0, log=sys.stderr) -> dict:
    reader = Reader(stream)
    window = window or workers * 2
    offset = 0
    count = 0
    t0 = time.time()
    last_log = t0

    def write(results):
        nonlocal offset, count
        for name, size, gz in results:
            out.write(gz)
            if name is not None:
                index.write(f"{name}\t{offset}\t{len(gz)}\t{size}\n")
                count += 1
            offset += len(gz)

    with ProcessPoolExecutor(max_workers=workers) as pool:
        inflight: deque = deque()
        for batch in batches(members(reader), batch_bytes):
            inflight.append(pool.submit(compress_batch, batch))
            while len(inflight) >= window:
                write(inflight.popleft().result())
            if time.time() - last_log > 60:
                last_log = time.time()
                el = last_log - t0
                print(f"  {count:,} members  in {reader.bytes / 1e9:.1f} GB  out {offset / 1e9:.1f} GB  "
                      f"{reader.bytes / 1e6 / el:.0f} MB/s  {el:.0f}s", file=log, flush=True)
        while inflight:
            write(inflight.popleft().result())

    return {
        "members": count,
        "input_bytes": reader.bytes,
        "input_sha256": reader.sha.hexdigest(),
        "output_bytes": offset,
        "seconds": round(time.time() - t0),
    }


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", required=True)
    ap.add_argument("--index", required=True)
    ap.add_argument("--workers", type=int, default=16)
    args = ap.parse_args()
    with open(args.out, "xb") as out, open(args.index, "x") as index:
        summary = repack(sys.stdin.buffer, out, index, args.workers)
    print(json.dumps(summary), flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
