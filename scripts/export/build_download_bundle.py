"""Build the published `db/` download bundle from an export_db_snapshot run.

Inputs  : a snapshot directory (tsv/, parquet/, MANIFEST.json) from
          export_db_snapshot.py, plus the database for the pg_dump.
Outputs : <table>.tsv.gz per table, a tar of those, a tar of the parquet files,
          a restorable pg_dump of the core relational subset, README.txt, and
          checksums.

Builds only, never into the served directory: point --out at <build dir>/db and
publish with `cut_release.py cut <id> --build <build dir>`, which makes the bundle part
of a new release (docs/runbooks/data-releases.md).

Usage:
    python build_download_bundle.py --snapshot DIR --out BUILD/db [--skip-dump]
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import time
from pathlib import Path

from export_db_snapshot import DB, DERIVED, DERIVED_EXPECT, TABLES, psql

SERVED = Path("/data/bgc-atlas/data-v2/populator-out-sequences")

# Precomputed aggregates and bgc_features are left out to keep pg_restore practical;
# they are still in the TSV and Parquet forms.
CORE_DUMP_TABLES = [
    "bgcs", "samples", "assemblies", "analyses", "antismash_runs", "gcfs",
    "taxonomies", "biomes", "data_sources", "studies", "runs",
    "mgnify_genomes", "mgnify_publications", "mgnify_super_studies",
    "mgnify_genome_catalogues",
    "sample_assemblies", "sample_analyses", "assembly_analyses", "study_samples",
    "sample_biomes", "sample_measurements", "sample_runs", "run_assemblies",
    "run_studies", "run_analyses",
    "bgc_gcf", "bgc_taxonomy", "study_gcf", "assembly_taxonomy",
    "bgc_redirect",
]

TSV_TAR = "bgc_atlas_v2_tables_tsv.tar.gz"
PARQUET_TAR = "bgc_atlas_v2_tables_parquet.tar.gz"
CORE_DUMP = "bgc_atlas_v2_core.dump"


def run(args: list[str], **kw) -> subprocess.CompletedProcess:
    return subprocess.run(args, check=True, **kw)


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(8 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def human(n: int) -> str:
    for unit in ("B", "KB", "MB", "GB", "TB"):
        if n < 1024 or unit == "TB":
            return f"{n:.0f} {unit}" if unit == "B" else f"{n:.1f} {unit}"
        n /= 1024.0
    return ""


def live_count(table: str) -> int:
    return int(psql(f"select count(*) from {table}").strip())


def verify_snapshot(snapshot: Path) -> dict:
    manifest = json.loads((snapshot / "MANIFEST.json").read_text())
    exported = manifest["tables"]

    missing = [t for t in TABLES + list(DERIVED) if t not in exported]
    if missing:
        raise SystemExit(
            "snapshot is incomplete — export_db_snapshot did not finish:\n"
            + "".join(f"  - {t}\n" for t in missing)
        )

    print("reconciling snapshot against the live database ...", flush=True)
    drift = []
    for table in ("bgcs", "gcfs", "bgc_gcf", "bgc_taxonomy", "samples",
                  "study_gcf"):
        snap = exported[table]["rows"]
        live = live_count(table)
        flag = "" if snap == live else "   <-- DRIFT"
        print(f"  {table:16s} snapshot {snap:>12,}  live {live:>12,}{flag}")
        if snap != live:
            drift.append((table, snap, live))
    for table in DERIVED:
        snap = exported[table]["rows"]
        live = int(psql(DERIVED_EXPECT[table]).strip())
        flag = "" if snap == live else "   <-- DRIFT"
        print(f"  {table:16s} snapshot {snap:>12,}  live {live:>12,}{flag}")
        if snap != live:
            drift.append((table, snap, live))

    # Each COPY is its own transaction, so concurrent writes can drift between tables.
    if drift:
        raise SystemExit(
            "the database changed while the snapshot was taken:\n"
            + "".join(f"  - {t}: snapshot {s:,} vs live {l:,}\n" for t, s, l in drift)
            + "Re-run export_db_snapshot.py for the affected tables (--only --force)."
        )
    return manifest


def build_readme(manifest: dict, dest: Path, snapshot_date: str) -> None:
    exported = manifest["tables"]
    rows = lambda t: exported[t]["rows"]  # noqa: E731

    # Coverage over every row of bgcs -- the BGCs the site counts -- so the
    # README and the site state one figure.
    primary = int(psql(
        "select count(*) from bgc_gcf x where x.is_primary").strip())
    total_bgcs = rows("bgcs")

    table_list = "\n".join(
        f"  {t:32s} {exported[t]['rows']:>12,} "
        + ("row" if exported[t]["rows"] == 1 else "rows")
        for t in sorted(exported)
    )
    clustered_pct = 100.0 * primary / total_bgcs

    # Genome quality, stated with the figures of this snapshot.
    genomes = rows("genomes")
    qc = [ln.rsplit("|", 1) for ln in psql(
        "select coalesce(checkm_source, ''), count(*) from samples "
        "where checkm_completeness is not null group by 1 order by 2 desc").strip().splitlines()]
    with_qc = sum(int(n) for _, n in qc)
    qc_lines = "\n".join(f"                {int(n):>9,}  {src}" for src, n in qc)
    no_lineage, no_bgc = (int(x) for x in psql(
        "select count(*) filter (where t.assembly_id is null), "
        "count(*) filter (where not exists (select 1 from bgcs b where b.assembly = a.id)) "
        "from assemblies a left join assembly_taxonomy t on t.assembly_id = a.id "
        "where a.source_type in ('isolate', 'MAG', 'SAG')").strip().split("|"))
    # Family names: the current clustering's tag from its names, the retired ones from gcf_legacy.
    tag = psql("select substring(min(name) from '^GCF-([a-z0-9]+)-') from gcfs").strip()
    retired = ", ".join(f"'{c}'" for c in psql(
        "select clustering from gcf_legacy group by 1 "
        "order by substring(clustering from '[0-9]{4}-[0-9]{2}(?:-[0-9]{2})?$')").split())

    text = f"""\
BGC Atlas database tables, snapshot {snapshot_date}

The same {len(exported)} tables in three forms:

  <table>.tsv.gz    tab-separated with a header row; all of them in {TSV_TAR}
                    pandas.read_csv(path, sep='\\t')   |   DuckDB read_csv_auto(path)

  {PARQUET_TAR}
                    Parquet (zstd), with the PostgreSQL column types

  {CORE_DUMP}
                    pg_dump of the core relational subset ({len(CORE_DUMP_TABLES)} tables):
                      createdb mydb
                      pg_restore --no-owner -d mydb {CORE_DUMP}

HOW TO JOIN
-----------
Families:   bgc_gcf(bgc_id, gcf_id, distance, is_primary, rank)
            A BGC can be in more than one family; is_primary marks the one the
            site shows. {primary:,} of {total_bgcs:,} BGCs ({clustered_pct:.1f}%) have a
            family. The other {total_bgcs - primary:,} are mostly short contig-edge
            fragments, too small to place.

Taxonomy:   bgc_taxonomy(bgc_id, taxonomy_id, rank, support, method) -> taxonomies

Genomes:    genomes(sample_id, accession, name, assembly_id, source_type, collection,
                    checkm_*, genome_quality, genome_size, lineage, bgc_count)
            One row per genome ({genomes:,} isolates, MAGs and SAGs), with sample,
            assembly, source and lineage fields already joined. sample_id joins to
            samples, assembly_id to bgcs.assembly. Derived, so not in the pg_dump.

Sequences:  bgcs.id is the key of the region GenBank and FASTA downloads. It is
            uuid5 of the region file name, not of the sequence: an identical BGC
            in two genomes has two ids.

GENOME QUALITY
--------------
CheckM2 completeness and contamination (percent) for {with_qc:,} of the {genomes:,}
genomes, in genomes and samples; empty for metagenome samples.
  genome_quality   MIMAG thresholds on CheckM2 alone: high = >=90% complete and
                   <=5% contaminated, medium = >=50% and <10%. Genomes below medium
                   were removed on 2026-10-09.
  checkm_source
{qc_lines}

genomes.lineage comes from assembly_taxonomy: gtdb_r232 and gtdb_legacy are GTDB's
classification, consensus_v1 the consensus of the genome's BGC lineages.
{no_lineage:,} genomes have none ({no_bgc:,} of them have no BGC).

FAMILY NAMES AND EARLIER CLUSTERINGS
------------------------------------
A family name carries the data release its clustering first shipped in:
GCF-{tag}-000042 (seed tier), GCF-{tag}-F-400042 (fragmented tier). Each clustering
numbers its families afresh; gcfs.id is uuid5 of the name.

gcf_legacy lists the families of earlier clusterings; its clustering column is one of
{retired} (oldest first).
gcf_successor(old_gcf_id, new_gcf_id, shared_bgcs, share_of_old, share_of_new) links
each to the families of the next clustering that share primary members with it;
follow the links to reach gcfs.

REMOVED BGC IDS
---------------
bgc_redirect maps the {rows("bgc_redirect"):,} BGC ids removed on 2026-10-05 (MGnify
assemblies stored twice) to their sequence-identical twins.

CONSISTENCY
-----------
Each table was exported in its own transaction: consistent within a table, not
across tables.

TABLES
------
{table_list}

VERIFY
------
  sha256sum -c SHA256SUMS
"""
    (dest / "README.txt").write_text(text)


def snapshot_date_of(manifest: dict, snapshot: Path) -> str:
    """Prefer the manifest's stamp; the directory name is arbitrary (--out)."""
    stamp = str(manifest.get("generated_at") or "")
    if len(stamp) >= 10 and stamp[4] == "-" and stamp[7] == "-":
        return stamp[:10]
    m = re.search(r"(\d{4})(\d{2})(\d{2})", snapshot.name)
    if m:
        return "-".join(m.groups())
    return snapshot.name


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--snapshot", required=True, type=Path)
    ap.add_argument("--out", required=True, type=Path,
                    help="the bundle directory: <build dir>/db for cut_release.py")
    ap.add_argument("--skip-dump", action="store_true",
                    help="skip pg_dump (the slow step) when iterating")
    args = ap.parse_args()
    if args.out.resolve().is_relative_to(SERVED.resolve()):
        raise SystemExit(f"--out {args.out} is inside the served downloads; build elsewhere and cut a release")

    snapshot = args.snapshot
    manifest = verify_snapshot(snapshot)
    exported = manifest["tables"]
    snapshot_date = snapshot_date_of(manifest, snapshot)

    staging = args.out.with_name(args.out.name + ".staging")
    if staging.exists():
        shutil.rmtree(staging)
    staging.mkdir(parents=True)
    print(f"\nstaging: {staging}", flush=True)

    jobs = str(max(1, (os.cpu_count() or 4)))

    for i, table in enumerate(sorted(exported), 1):
        src = snapshot / "tsv" / f"{table}.tsv"
        dst = staging / f"{table}.tsv.gz"
        t0 = time.time()
        with dst.open("wb") as out:
            run(["pigz", "-p", jobs, "-c", str(src)], stdout=out)
        print(f"  [{i:2d}/{len(exported)}] {table:32s} "
              f"{human(dst.stat().st_size):>10s}  {time.time() - t0:.0f}s",
              flush=True)

    # Members are already compressed; the outer gzip keeps the published filename stable.
    print(f"\nbuilding {TSV_TAR} ...", flush=True)
    run(["tar", "-czf", str(staging / TSV_TAR), "-C", str(staging),
         *sorted(f"{t}.tsv.gz" for t in exported)])

    print(f"building {PARQUET_TAR} ...", flush=True)
    run(["tar", "-czf", str(staging / PARQUET_TAR), "-C",
         str(snapshot / "parquet"),
         *sorted(f"{t}.parquet" for t in exported)])

    if args.skip_dump:
        print("\nskipping pg_dump (--skip-dump)", flush=True)
    else:
        print(f"\nbuilding {CORE_DUMP} ({len(CORE_DUMP_TABLES)} tables) ...",
              flush=True)
        unknown = [t for t in CORE_DUMP_TABLES if t not in exported]
        if unknown:
            raise SystemExit(f"CORE_DUMP_TABLES not in the snapshot: {unknown}")
        cmd = ["pg_dump", "-d", DB, "-Fc", "-Z", "6",
               "--no-owner", "--no-privileges"]
        for t in CORE_DUMP_TABLES:
            cmd += ["-t", f"public.{t}"]
        t0 = time.time()
        with (staging / CORE_DUMP).open("wb") as out:
            run(cmd, stdout=out)
        print(f"  {human((staging / CORE_DUMP).stat().st_size)}  "
              f"{time.time() - t0:.0f}s", flush=True)

    build_readme(manifest, staging, snapshot_date)

    print("\nchecksums ...", flush=True)
    sums = []
    for path in sorted(staging.iterdir()):
        if path.suffix == ".sha256":
            continue
        digest = sha256(path)
        (staging / f"{path.name}.sha256").write_text(f"{digest}  {path.name}\n")
        sums.append(f"{digest}  {path.name}")
    (staging / "SHA256SUMS").write_text("\n".join(sums) + "\n")

    total = sum(p.stat().st_size for p in staging.iterdir())
    print(f"\nbundle: {len(list(staging.iterdir()))} files, {human(total)}")

    if args.out.exists():
        raise SystemExit(f"{args.out} exists; the new bundle is left in {staging}")
    staging.rename(args.out)
    print(f"\nbuilt: {args.out}\npublish: cut_release.py cut <id> --build {args.out.parent} --notes ...")
    return 0


if __name__ == "__main__":
    sys.exit(main())
