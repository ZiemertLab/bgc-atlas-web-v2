"""Publish the BiG-SLiCE clustering-v3 runs (each `result/data.db`) as a download bundle.

Each data.db is published whole: BiG-SLiCE's report viewer reads `cds` and `hsp`, and
resuming at another threshold needs the hmmscan stages. Built in a staging directory and
swapped in with two renames, since nginx serves the live directory directly.

Inputs  : the canonical clustering-v3 bundle on CephFS (read-only).
Outputs : one .tar.gz per run, README.txt, checksums.

Build into a release's build directory (--dest <build>/clustering-v3) and publish with
cut_release.py; the served directory is refused.

Usage:
    python build_clustering_bundle.py [--only seed|residual] [--dest DIR]
                                      [--quick-check] [--dry-run]
    python build_clustering_bundle.py --refresh-readme      # text only, no rebuild
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import sqlite3
import subprocess
import sys
import tarfile
import time
from pathlib import Path

SOURCE = Path("/data/bgc-atlas/data-v2/clustering-v3")
DEST = Path("/data/bgc-atlas/data-v2/populator-out-sequences/clustering-v3")
SERVED = Path("/data/bgc-atlas/data-v2/populator-out-sequences")
# The release tag in this clustering's family names (scripts/clustering-v3/bundle_config.py).
TAG = os.environ.get("CLUSTERING_TAG", "")

# In the order they are applied: residual models only see what the seed run missed.
RUNS = [
    {
        "key": "seed",
        "dir": "bigslice-output-v3",
        "archive": "bigslice-v3-seed.tar.gz",
        "title": "Main atlas (seed) run",
        "blurb": "the main atlas families, clustered from the dedup-95 seed",
    },
    {
        "key": "residual",
        "dir": "bigslice-output-residual-v3",
        "archive": "bigslice-v3-residual.tar.gz",
        "title": "Residual run",
        "blurb": "de-novo families of what the seed run could not place",
    },
]


def pigz() -> str:
    found = shutil.which("pigz")
    if found:
        return found
    fallback = "/data/bgc-atlas/miniforge3/bin/pigz"
    if Path(fallback).exists():
        return fallback
    raise SystemExit("pigz not found on PATH")


def human(n: float) -> str:
    for unit in ("B", "KB", "MB", "GB", "TB"):
        if n < 1024 or unit == "TB":
            return f"{n:.0f} {unit}" if unit == "B" else f"{n:.1f} {unit}"
        n /= 1024.0
    return ""


class HashingReader:
    """Hashes the data.db during the tar pass, saving a second full read over CephFS."""

    def __init__(self, fh, total: int, label: str):
        self.fh = fh
        self.h = hashlib.sha256()
        self.total = total
        self.label = label
        self.seen = 0
        self.next_report = 4 << 30
        self.t0 = time.time()

    def read(self, size: int = -1) -> bytes:
        chunk = self.fh.read(size)
        self.h.update(chunk)
        self.seen += len(chunk)
        if self.seen >= self.next_report:
            elapsed = time.time() - self.t0
            rate = self.seen / elapsed if elapsed else 0
            print(f"      {self.label}: {human(self.seen)} / {human(self.total)}"
                  f"  ({100.0 * self.seen / self.total:.0f}%, {human(rate)}/s)",
                  flush=True)
            self.next_report += 4 << 30
        return chunk


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(8 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def read_run_metadata(db_path: Path, quick_check: bool) -> dict:
    """The full counts on gcf_models and bgc_features are a structural check: walking
    those b-trees makes a corrupt page raise here rather than after publication.
    """
    uri = f"file:{db_path}?mode=ro"
    con = sqlite3.connect(uri, uri=True)
    try:
        cur = con.cursor()
        meta: dict = {}

        if quick_check:
            t0 = time.time()
            print("      PRAGMA quick_check ...", flush=True)
            result = cur.execute("PRAGMA quick_check").fetchone()[0]
            if result != "ok":
                raise SystemExit(f"{db_path} failed quick_check: {result}")
            print(f"      quick_check ok ({time.time() - t0:.0f}s)", flush=True)

        meta["schema_ver"] = cur.execute(
            "SELECT ver FROM schema").fetchone()[0]
        meta["hmm_db"] = cur.execute(
            "SELECT md5_biosyn_pfam, md5_sub_pfam FROM hmm_db").fetchall()
        meta["runs"] = cur.execute(
            "SELECT id, status, prog_params FROM run ORDER BY id").fetchall()
        meta["clusterings"] = cur.execute(
            "SELECT id, run_id, clustering_method, num_centroids, threshold,"
            " random_seed FROM clustering ORDER BY id").fetchall()
        meta["gcf_per_clustering"] = cur.execute(
            "SELECT clustering_id, count(*) FROM gcf"
            " GROUP BY clustering_id ORDER BY clustering_id").fetchall()

        counts = {}
        # Cheap first, so a mistake surfaces before the long scans.
        for label, sql in (
            ("hmm", "SELECT count(*) FROM hmm"),
            ("gcf", "SELECT count(*) FROM gcf"),
            ("bgc", "SELECT count(*) FROM bgc"),
            # Never deleted from, so max(id) is the row count without a scan.
            ("cds_max_id", "SELECT max(id) FROM cds"),
            ("hsp_max_id", "SELECT max(id) FROM hsp"),
            ("gcf_membership", "SELECT count(*) FROM gcf_membership"),
            ("gcf_models", "SELECT count(*) FROM gcf_models"),
            ("bgc_features", "SELECT count(*) FROM bgc_features"),
        ):
            t0 = time.time()
            counts[label] = cur.execute(sql).fetchone()[0] or 0
            print(f"      {label:16s} {counts[label]:>12,}"
                  f"   {time.time() - t0:.0f}s", flush=True)
        meta["counts"] = counts
        return meta
    finally:
        con.close()


# What a published data.db says in run.prog_params. The runs record the internal command line (program name and
# cluster paths); published files describe the clustering as BiG-SLiCE 2.0 at 0.4 and nothing else.
PUBLISHED_PROG_PARAMS = "--threshold 0.4"


def publishable_copy(db_path: Path, scratch: Path, run_dir: str) -> Path:
    """A copy of the run's data.db with run.prog_params set to PUBLISHED_PROG_PARAMS; the canonical bundle is
    read-only and stays as delivered."""
    dst = scratch / run_dir / "result" / "data.db"
    dst.parent.mkdir(parents=True, exist_ok=True)
    t0 = time.time()
    shutil.copyfile(db_path, dst)
    dst.chmod(0o644)
    con = sqlite3.connect(dst)
    try:
        thresholds = {t for (t,) in con.execute("SELECT threshold FROM clustering")}
        if 0.4 not in thresholds:
            raise SystemExit(f"{db_path}: no clustering at 0.4 ({sorted(thresholds)}); fix PUBLISHED_PROG_PARAMS")
        before = con.execute("SELECT id, prog_params FROM run ORDER BY id").fetchall()
        con.execute("UPDATE run SET prog_params = ?", (PUBLISHED_PROG_PARAMS,))
        con.commit()
        if con.execute("PRAGMA quick_check").fetchone()[0] != "ok":
            raise SystemExit(f"{dst}: quick_check failed after the prog_params update")
    finally:
        con.close()
    print(f"   run.prog_params of {len(before)} run(s) -> {PUBLISHED_PROG_PARAMS!r} "
          f"(copy {time.time() - t0:.0f}s)", flush=True)
    return dst


def build_archive(db_path: Path, arcname: str, out_path: Path, jobs: str) -> str:
    """Returns the sha256 of the data.db inside the archive."""
    size = db_path.stat().st_size
    # Niced and on a fraction of the cores: the machine also serves the site.
    proc = subprocess.Popen(
        ["nice", "-n", "15", pigz(), "-p", jobs, "-c"],
        stdin=subprocess.PIPE,
        stdout=out_path.open("wb"),
    )
    try:
        with tarfile.open(fileobj=proc.stdin, mode="w|") as tf:
            info = tf.gettarinfo(str(db_path), arcname=arcname)
            info.uid = info.gid = 0
            info.uname = info.gname = ""
            info.mode = 0o644
            with db_path.open("rb") as fh:
                reader = HashingReader(fh, size, arcname)
                tf.addfile(info, reader)
        proc.stdin.close()
    except BaseException:
        proc.kill()
        raise
    if proc.wait() != 0:
        raise SystemExit(f"pigz failed for {arcname}")
    return reader.h.hexdigest()


def build_readme(built: list[dict], dest: Path, build_date: str) -> None:
    sections = []
    for run in built:
        meta = run["meta"]
        clusterings = "\n".join(
            f"    clustering {cid}: {centroids:,} families at threshold"
            f" {threshold}"
            for cid, _rid, _method, centroids, threshold, _seed
            in meta["clusterings"]
        )
        sections.append(f"""\
{run['spec']['archive']}   {human(run['archive_size'])}
  extracts to  {run['arcname']}  ({human(run['db_size'])})
  sha256       {run['db_sha256']}
  {run['spec']['blurb']}
{clusterings}
""")

    prefix = f"GCF-{TAG}-" if TAG else "GCF-"
    text = f"""\
BGC Atlas — BiG-SLiCE clustering runs, published {build_date}

The two BiG-SLiCE 2.0 runs behind the site's gene cluster families, each as one
`result/data.db`. They hold the family models (`gcf_models`) and memberships, which
is what placing new BGCs into these families needs. The per-gene tables (`cds`,
`hsp`, `bgc_features`) are empty, so BiG-SLiCE's report viewer and re-clustering at
another threshold do not work from these files.

{chr(10).join(sections)}
FAMILY IDS
----------
`gcf.id` in each file maps to a family on the site:

  seed run      {prefix}{{id:06d}}           e.g. gcf.id 336 -> {prefix}000336
  residual run  {prefix}F-{{400000+id:06d}}  e.g. gcf.id 42  -> {prefix}F-400042

The two id spaces are independent: gcf.id 42 in one is unrelated to gcf.id 42 in
the other. Only clustering 1 (threshold 0.4) is used.

`bgc.name` is `genomes/<uuid>.regionNNN`; strip the prefix and suffix to get
`bgcs.id`, the key the other downloads use.

VERIFY
------
  sha256sum -c SHA256SUMS
"""
    (dest / "README.txt").write_text(text)


MANIFEST = ".build-manifest.json"


def write_checksums(dest: Path) -> None:
    sums = []
    for path in sorted(dest.iterdir()):
        if (path.suffix == ".sha256" or path.name.startswith(".")
                or path.name == "SHA256SUMS"):
            continue
        digest = sha256_file(path)
        (dest / f"{path.name}.sha256").write_text(f"{digest}  {path.name}\n")
        sums.append(f"{digest}  {path.name}")
    (dest / "SHA256SUMS").write_text("\n".join(sums) + "\n")


def refresh_readme(dest: Path) -> int:
    """Rewrite README.txt from .build-manifest.json without rebuilding the archives."""
    manifest_path = dest / MANIFEST
    if not manifest_path.is_file():
        raise SystemExit(
            f"no {MANIFEST} in {dest} — it predates --refresh-readme, so the "
            "README can only be regenerated by a full build")
    manifest = json.loads(manifest_path.read_text())
    by_key = {r["key"]: r for r in RUNS}
    built = [{**entry, "spec": by_key[entry["key"]]} for entry in manifest["runs"]]

    build_readme(built, dest, manifest["build_date"])
    readme = dest / "README.txt"
    digest = sha256_file(readme)
    (dest / "README.txt.sha256").write_text(f"{digest}  README.txt\n")

    sums = []
    for path in sorted(dest.iterdir()):
        if (path.suffix == ".sha256" or path.name.startswith(".")
                or path.name == "SHA256SUMS"):
            continue
        sidecar = dest / f"{path.name}.sha256"
        sums.append(sidecar.read_text().strip())
    (dest / "SHA256SUMS").write_text("\n".join(sums) + "\n")

    print(f"README.txt rewritten ({readme.stat().st_size} bytes) and "
          f"SHA256SUMS updated in {dest}")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--source", type=Path, default=SOURCE)
    ap.add_argument("--dest", type=Path, default=DEST)
    ap.add_argument("--refresh-readme", action="store_true",
                    help="rewrite README.txt in the published bundle from "
                         "its build manifest, without rebuilding the archives")
    ap.add_argument("--only", choices=[r["key"] for r in RUNS],
                    help="build a single run (the archives are independent)")
    ap.add_argument("--jobs", type=int, default=max(1, (os.cpu_count() or 4) // 2),
                    help="pigz threads (default: half the cores, leaving the "
                         "rest for whatever else the host serves)")
    ap.add_argument("--quick-check", action="store_true",
                    help="PRAGMA quick_check each source db first (a full extra "
                         "read of 46 GB; the row counts already walk the tables "
                         "that matter)")
    ap.add_argument("--keep-previous", action="store_true")
    ap.add_argument("--dry-run", action="store_true",
                    help="build into staging but do not swap it in")
    args = ap.parse_args()

    if args.refresh_readme:
        return refresh_readme(args.dest)

    specs = [r for r in RUNS if not args.only or r["key"] == args.only]

    for spec in specs:
        db = args.source / spec["dir"] / "result" / "data.db"
        if not db.is_file():
            raise SystemExit(f"missing source database: {db}")

    if args.dest.resolve().is_relative_to(SERVED.resolve()):
        raise SystemExit(f"--dest {args.dest} is inside the served downloads; build elsewhere and cut a release")
    staging = args.dest.with_name(args.dest.name + ".staging")
    if staging.exists():
        shutil.rmtree(staging)
    staging.mkdir(parents=True)
    print(f"staging: {staging}\n", flush=True)

    jobs = str(args.jobs)
    built = []
    # Scrubbed data.db copies (publishable_copy), outside staging so they are never published; removed at the end.
    scratch = args.dest.with_name(args.dest.name + ".scrub")
    if scratch.exists():
        shutil.rmtree(scratch)

    for i, spec in enumerate(specs, 1):
        db = args.source / spec["dir"] / "result" / "data.db"
        arcname = f"{spec['dir']}/result/data.db"
        out = staging / spec["archive"]
        db_size = db.stat().st_size

        print(f"[{i}/{len(specs)}] {spec['title']} — {human(db_size)}", flush=True)
        db = publishable_copy(db, scratch, spec["dir"])
        db_size = db.stat().st_size
        print("   reading run metadata ...", flush=True)
        meta = read_run_metadata(db, args.quick_check)

        print(f"   compressing -> {spec['archive']} ...", flush=True)
        t0 = time.time()
        db_sha = build_archive(db, arcname, out, jobs)
        archive_size = out.stat().st_size
        print(f"   {human(archive_size)} in {time.time() - t0:.0f}s"
              f"  ({db_size / archive_size:.2f}x)\n", flush=True)

        built.append({
            "spec": spec, "meta": meta, "arcname": arcname,
            "db_size": db_size, "db_sha256": db_sha,
            "archive_size": archive_size,
        })

    shutil.rmtree(scratch)

    build_date = time.strftime("%Y-%m-%d")
    build_readme(built, staging, build_date)

    # Lets --refresh-readme regenerate the README without a rebuild.
    (staging / MANIFEST).write_text(json.dumps({
        "build_date": build_date,
        "runs": [{
            "key": r["spec"]["key"], "arcname": r["arcname"],
            "db_size": r["db_size"], "db_sha256": r["db_sha256"],
            "archive_size": r["archive_size"], "meta": r["meta"],
        } for r in built],
    }, indent=2))

    print("checksums ...", flush=True)
    write_checksums(staging)

    total = sum(p.stat().st_size for p in staging.iterdir())
    print(f"\nbundle: {len(list(staging.iterdir()))} files, {human(total)}")
    for r in built:
        print(f"  {r['spec']['archive']:32s} {human(r['archive_size']):>10s}")

    if args.dry_run:
        print(f"\n--dry-run: left in {staging}, not published")
        return 0

    prev = args.dest.with_name(
        f"{args.dest.name}.prev-{time.strftime('%Y%m%d-%H%M%S')}")
    if args.dest.exists():
        args.dest.rename(prev)
    staging.rename(args.dest)
    print(f"\npublished: {args.dest}")

    if args.keep_previous:
        print(f"previous bundle kept at: {prev}")
    elif prev.exists():
        shutil.rmtree(prev)
        print("previous bundle removed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
