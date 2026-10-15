#!/usr/bin/env python3
"""Build the `gcf_mibig_anchor` load table from the two clustering-v3 BiG-SLiCE runs.

MIBiG entries are the dataset named `MIBiG` in both runs; the other load steps discard them.
Two filters are required, or the result is overstated:

  * ``clustering_id = 1``: the residual run also holds an unused @0.7 clustering.
  * ``membership_value <= 0.4``: rank 0 is the nearest centroid regardless of distance,
    not necessarily a member.

Names (not uuids) are emitted; the loader resolves them against `gcfs` and drops
MIBiG-only families. Compound names come from the MIBiG 4.0 JSON release.

Usage:
  python3 scripts/mibig/build_gcf_mibig_anchor.py --out /path/to/gcf_mibig_anchor.csv
  psql -d bgc_atlas_v2 -f scripts/mibig/load_gcf_mibig_anchor.sql < gcf_mibig_anchor.csv
"""
from __future__ import annotations

import argparse
import csv
import glob
import json
import os
import sqlite3
import sys

# The clustering bundle and the tag in its family names, as in scripts/clustering-v3/bundle_config.py.
V3 = os.environ.get("CLUSTERING_SRC", "/data/bgc-atlas/data-v2/clustering-v3")
TAG = os.environ.get("CLUSTERING_TAG", "")
RUNS = (
    ("seed", f"{V3}/bigslice-output-v3/result/data.db"),
    ("fragmented", f"{V3}/bigslice-output-residual-v3/result/data.db"),
)
MIBIG_JSON = "/data/bgc-atlas/data-v2/mibig/mibig_json_4.0"

# MIBiG's dataset id differs between runs (17 in one, 18 in another where 17 is `no_source`): it is
# looked up by name in each data.db, never hard-coded.
MIBIG_DATASET_NAME = "MIBiG"
CLUSTERING_ID = 1          # @0.4; the residual run's clustering 2 is @0.7 and unused
THRESHOLD = 0.4            # CLUSTERING_THRESHOLD in families.ts
FRAGMENTED_OFFSET = 400_000

EXPECT_MIBIG_ENTRIES = 2_309


def atlas_gcf_name(tier: str, bigslice_gcf_id: int) -> str:
    """Port of `atlasGcfName` in bgc-atlas/src/lib/bigslice/families.ts."""
    prefix = f"GCF-{TAG}-" if TAG else "GCF-"
    if tier == "fragmented":
        return f"{prefix}F-{FRAGMENTED_OFFSET + bigslice_gcf_id:06d}"
    return f"{prefix}{bigslice_gcf_id:06d}"


def pg_array(values: list[str]) -> str:
    """Postgres array literal for \\copy ... CSV. Doubles quotes and backslashes."""
    if not values:
        return "{}"
    out = []
    for v in values:
        v = v.replace("\\", "\\\\").replace('"', '\\"')
        out.append(f'"{v}"')
    return "{" + ",".join(out) + "}"


def load_mibig_metadata() -> dict[str, dict]:
    meta: dict[str, dict] = {}
    for path in glob.glob(os.path.join(MIBIG_JSON, "BGC*.json")):
        with open(path) as fh:
            d = json.load(fh)
        meta[d["accession"]] = {
            "compounds": [c["name"] for c in d.get("compounds", []) if c.get("name")],
            "chem_classes": [
                c["class"]
                for c in (d.get("biosynthesis") or {}).get("classes", [])
                if c.get("class")
            ],
            # Some MIBiG producer names have doubled internal spaces.
            "producer": " ".join(((d.get("taxonomy") or {}).get("name") or "").split()) or None,
            "version": d.get("version"),
            "status": d.get("status"),
            "quality": d.get("quality"),
        }
    return meta


def anchors_for_run(tier: str, db: str) -> list[tuple[str, str, float]]:
    con = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
    ds = con.execute("SELECT id FROM dataset WHERE name = ?", (MIBIG_DATASET_NAME,)).fetchall()
    if len(ds) != 1:
        sys.exit(f"{tier}: expected one dataset named {MIBIG_DATASET_NAME!r}, found {ds}")
    accession = {
        bgc_id: name.replace("genomes/", "")
        for bgc_id, name in con.execute(
            "SELECT id, name FROM bgc WHERE dataset_id = ?", (ds[0][0],)
        )
    }
    if len(accession) != EXPECT_MIBIG_ENTRIES:
        sys.exit(f"{tier}: expected {EXPECT_MIBIG_ENTRIES} MIBiG entries, got {len(accession)}")

    in_clustering = {
        row[0]
        for row in con.execute("SELECT id FROM gcf WHERE clustering_id = ?", (CLUSTERING_ID,))
    }
    ids = ",".join(str(i) for i in accession)
    rows = con.execute(
        f"SELECT bgc_id, gcf_id, membership_value FROM gcf_membership "
        f"WHERE bgc_id IN ({ids}) AND rank = 0"
    ).fetchall()
    con.close()

    out = []
    beyond = 0
    for bgc_id, gcf_id, distance in rows:
        if gcf_id not in in_clustering:
            continue
        if distance > THRESHOLD:
            beyond += 1
            continue
        out.append((atlas_gcf_name(tier, gcf_id), accession[bgc_id], distance))
    n_fam = len({r[0] for r in out})
    print(
        f"  {tier:11} placements {len(out):5} in-threshold, {beyond:4} beyond {THRESHOLD} "
        f"(dropped), {n_fam:5} families",
        flush=True,
    )
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    args = ap.parse_args()

    meta = load_mibig_metadata()
    print(f"MIBiG 4.0 entries: {len(meta):,}", flush=True)

    rows: list[tuple[str, str, float]] = []
    for tier, db in RUNS:
        rows.extend(anchors_for_run(tier, db))

    missing = {acc for _, acc, _ in rows} - set(meta)
    if missing:
        sys.exit(f"{len(missing)} accessions unresolved against MIBiG 4.0: {sorted(missing)[:10]}")

    seen: set[tuple[str, str]] = set()
    with open(args.out, "w", newline="") as fh:
        w = csv.writer(fh)
        w.writerow([
            "gcf_name", "mibig_accession", "compounds", "chem_classes",
            "producer", "mibig_version", "mibig_status", "membership_distance",
        ])
        for gcf_name, acc, distance in sorted(rows):
            if (gcf_name, acc) in seen:
                continue
            seen.add((gcf_name, acc))
            m = meta[acc]
            w.writerow([
                gcf_name, acc, pg_array(m["compounds"]), pg_array(m["chem_classes"]),
                m["producer"] or "", m["version"], m["status"], f"{distance:.6f}",
            ])

    families = {g for g, _ in seen}
    print(f"\nwrote {args.out}")
    print(f"  rows (family, reference) : {len(seen):,}")
    print(f"  distinct family names    : {len(families):,}")
    print(f"  distinct references      : {len({a for _, a in seen}):,}")


if __name__ == "__main__":
    main()
