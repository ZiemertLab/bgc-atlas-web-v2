#!/usr/bin/env python3
"""Extract BGC GenBank files from a local all_regions_gbk.tar.gz.

    python3 extract_gbk.py ids.txt --archive all_regions_gbk.tar.gz \\
        --index all_regions_gbk.index.tsv.gz --out gbk/

ids.txt: one BGC id per line, or "-" for stdin.
Files: https://bgc-atlas.cs.uni-tuebingen.de/downloads
"""
import argparse
import gzip
import hashlib
import io
import os
import re
import sys
import tarfile
import zlib
from typing import Dict, Iterable, List, Optional, Set, TextIO, Tuple

UUID_RE = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")
MAX_MEMBER_BYTES = 32 * 1024 * 1024


class IndexMismatch(Exception):
    pass


def open_text(path: str) -> TextIO:
    if path == "-":
        return sys.stdin
    with open(path, "rb") as f:
        gz = f.read(2) == b"\x1f\x8b"
    return io.TextIOWrapper(gzip.open(path, "rb"), encoding="utf-8") if gz else open(path, encoding="utf-8")


def read_ids(lines: Iterable[str]) -> Tuple[List[str], List[str]]:
    ids, bad, seen = [], [], set()
    for line in lines:
        value = line.strip().lower()
        if not value or value.startswith("#"):
            continue
        if value.endswith(".gbk"):
            value = value[:-4]
        if not UUID_RE.match(value):
            bad.append(line.strip())
        elif value not in seen:
            seen.add(value)
            ids.append(value)
    return ids, bad


def read_redirects(lines: Iterable[str], wanted: Set[str]) -> Dict[str, str]:
    out = {}
    for line in lines:
        old, _, new = line.rstrip("\n").partition("\t")
        if old in wanted:
            out[old] = new
    return out


def scan_index(lines: Iterable[str], wanted: Set[str]) -> Tuple[Dict[str, str], Dict[str, Tuple[int, int]]]:
    """Header fields (`# archive sha256 <hex> size <n>`) and (offset, length) per wanted id."""
    header: Dict[str, str] = {}
    found: Dict[str, Tuple[int, int]] = {}
    for line in lines:
        if line.startswith("#"):
            words = line.lstrip("#").split()
            if words[:1] == ["archive"]:
                header.update(zip(words[1::2], words[2::2]))
            continue
        name, offset, length = line.split("\t")[:3]
        bgc_id = name[:-4] if name.endswith(".gbk") else name
        if bgc_id in wanted:
            found[bgc_id] = (int(offset), int(length))
            if len(found) == len(wanted):
                break
    return header, found


def read_region(archive, bgc_id: str, offset: int, length: int) -> bytes:
    if not 0 < length <= MAX_MEMBER_BYTES:
        raise IndexMismatch("bad length %d" % length)
    archive.seek(offset)
    raw = archive.read(length)
    try:
        member = zlib.decompress(raw, 31)
        with tarfile.open(fileobj=io.BytesIO(member + b"\0" * 1024), mode="r:") as tf:
            info = tf.next()
            name = os.path.basename(info.name) if info else None
            if name != bgc_id + ".gbk":
                raise IndexMismatch("found %s instead" % name)
            data = tf.extractfile(info)
            return data.read() if data else b""
    except (zlib.error, tarfile.TarError) as e:
        raise IndexMismatch(str(e))


def sha256_of(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 23), b""):
            h.update(chunk)
    return h.hexdigest()


def run(ids_path: str, archive_path: str, index_path: str, out_dir: str,
        redirects_path: Optional[str] = None, verify_sha: bool = False,
        log: TextIO = sys.stderr) -> int:
    with open_text(ids_path) as f:
        requested, bad = read_ids(f)
    for line in bad:
        print("skipped, not a BGC id: %s" % line, file=log)
    if not requested:
        print("no BGC ids", file=log)
        return 1

    redirects: Dict[str, str] = {}
    if redirects_path:
        with open_text(redirects_path) as f:
            redirects = read_redirects(f, set(requested))
    targets = {i: redirects.get(i, i) for i in requested}

    with open_text(index_path) as f:
        header, found = scan_index(f, set(targets.values()))
    size = os.path.getsize(archive_path)
    if header.get("size") and int(header["size"]) != size:
        print("index does not match this archive (%s vs %d bytes)" % (header["size"], size), file=log)
        return 2
    if verify_sha and header.get("sha256") and sha256_of(archive_path) != header["sha256"]:
        print("index does not match this archive (sha256)", file=log)
        return 2

    os.makedirs(out_dir, exist_ok=True)
    missing = [req for req, t in targets.items() if t not in found]
    mismatched, extracted = [], 0
    with open(archive_path, "rb") as archive:
        for (offset, length), req, target in sorted((found[t], r, t) for r, t in targets.items() if t in found):
            try:
                gbk = read_region(archive, target, offset, length)
            except IndexMismatch as e:
                mismatched.append(req)
                print("%s: %s" % (req, e), file=log)
                continue
            with open(os.path.join(out_dir, req + ".gbk"), "wb") as out:
                out.write(gbk)
            extracted += 1

    print("extracted %d/%d" % (extracted, len(requested)), file=log)
    mapped = sum(1 for r, t in targets.items() if r != t)
    if mapped:
        print("redirected: %d" % mapped, file=log)
    if missing:
        path = os.path.join(out_dir, "not_found.txt")
        with open(path, "w") as f:
            f.write("".join(m + "\n" for m in missing))
        print("not found: %d (%s)%s" % (len(missing), path, "" if redirects_path else "; try --redirects"), file=log)
    if mismatched:
        print("mismatched: %d" % len(mismatched), file=log)
    return 1 if missing or mismatched or bad else 0


def main(argv: Optional[List[str]] = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("ids", help='file of BGC ids, or "-"')
    ap.add_argument("--archive", required=True, help="all_regions_gbk.tar.gz")
    ap.add_argument("--index", required=True, help="all_regions_gbk.index.tsv.gz")
    ap.add_argument("--redirects", help="bgc_id_redirects.tsv.gz (ids removed on 2026-10-05)")
    ap.add_argument("--out", required=True, help="output directory")
    ap.add_argument("--verify-sha", action="store_true", help="hash the whole archive first (slow)")
    a = ap.parse_args(argv)
    return run(a.ids, a.archive, a.index, a.out, a.redirects, a.verify_sha)


if __name__ == "__main__":
    sys.exit(main())
