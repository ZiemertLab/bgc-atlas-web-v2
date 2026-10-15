"""Deepen SMAG generic-Soil MAGs from BioSample isolation_source via the soil_subtype crosswalk.

Join: DB accession ``<user_genome>.<bin>`` -> ``user_genome`` -> biosample -> isolation_source
(cached by crawl_smag_biosample_isolation.py). Rewrites only samples still at generic Soil.
Dry run unless --apply.

Usage:
    PGPASSWORD=... scripts/populator/.venv/bin/python -m scripts.populator.tools.backfill_smag_soil_subtype \
        [--dbname bgc_atlas_v2] [--apply]
"""
import argparse
import csv
import os
import sys
from collections import Counter, defaultdict
from pathlib import Path

import psycopg2
from psycopg2.extras import execute_values

from scripts.populator.adapters.soil_subtype import soil_subtype_for
from scripts.populator.core.gold_normalize import normalize_gold_ecosystem_path

SMAG_DIR = Path(__file__).resolve().parent.parent / "data" / "smag"
SAMPLE_TSV = SMAG_DIR / "smag_sample_metadata.tsv"
CACHE_TSV = SMAG_DIR / "smag_biosample_isolation.tsv"
GENERIC_ECO = {"Bare Land", "Artificial Surfaces", "NA", "Sea", ""}
GENERIC_SOIL = "Environmental:Terrestrial:Soil"

_SQL = f"""UPDATE samples s SET gold_ecosystem_path = v.path, updated_at = now()
             FROM (VALUES %s) AS v(id, path)
            WHERE s.id = v.id::uuid AND s.gold_ecosystem_path = '{GENERIC_SOIL}'"""


def _connect(dbname):
    return psycopg2.connect(host=os.environ.get("PGHOST", "localhost"),
                            user=os.environ.get("PGUSER", "bgc_owner"),
                            password=os.environ["PGPASSWORD"], dbname=dbname)


def _load_user_genome_to_subtype():
    """Return {user_genome: (subtype, isolation_source)} for generic-ecosystem SMAG samples whose
    crawled isolation_source maps to a soil subtype."""
    iso = {}
    with CACHE_TSV.open() as f:
        for row in csv.reader(f, delimiter="\t"):
            if row:
                iso[row[0]] = row[1] if len(row) > 1 else ""
    out = {}
    with SAMPLE_TSV.open() as f:
        for r in csv.DictReader(f, delimiter="\t"):
            if r.get("ecosystem", "").strip() not in GENERIC_ECO:
                continue
            bs = (r.get("biosample", "") or "").strip()
            src = iso.get(bs, "")
            sub = soil_subtype_for(src)
            if sub:
                out[r["user_genome"].strip()] = (sub, src)
    return out


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--dbname", default="bgc_atlas_v2")
    ap.add_argument("--apply", action="store_true")
    args = ap.parse_args()

    ug_map = _load_user_genome_to_subtype()
    print(f"{len(ug_map)} SMAG samples (user_genome) resolve to a subtype from isolation_source\n")
    by_iso = defaultdict(lambda: [None, 0])
    for sub, src in ug_map.values():
        by_iso[src.lower()][0] = sub
        by_iso[src.lower()][1] += 1
    print("=== isolation_source -> subtype (sample-level) ===")
    for src, (sub, n) in sorted(by_iso.items(), key=lambda kv: -kv[1][1]):
        print(f"  {n:4d}  {src!r:55s} -> {sub}")

    conn = _connect(args.dbname)
    cur = conn.cursor()
    cur.execute("SELECT current_database()")
    if cur.fetchone()[0] != "bgc_atlas_v2":
        print("refusing: not bgc_atlas_v2", file=sys.stderr)
        return 2

    cur.execute(
        """SELECT s.id, s.accession FROM samples s
             JOIN data_sources ds ON ds.id = ANY(s.data_source_ids)
            WHERE ds.name = 'SMAG' AND s.gold_ecosystem_path = %s""", (GENERIC_SOIL,))
    rows = []
    per_subtype = Counter()
    for sid, acc in cur.fetchall():
        key = acc.rsplit(".", 1)[0]
        hit = ug_map.get(key)
        if not hit:
            continue
        path = normalize_gold_ecosystem_path(f"{GENERIC_SOIL}:{hit[0]}")
        rows.append((str(sid), path))
        per_subtype[path.split(":")[-1]] += 1

    print(f"\n=== DB MAGs (genomes) affected: {len(rows)} ===")
    for sub, n in per_subtype.most_common():
        print(f"  {n:5d}  Environmental:Terrestrial:Soil:{sub}")

    if args.apply and rows:
        for i in range(0, len(rows), 1000):
            execute_values(cur, _SQL, rows[i:i + 1000])
        conn.commit()
        print(f"\nAPPLIED {len(rows)} updates, committed.")
    else:
        print(f"\ndry run (no --apply): {len(rows)} would be updated.")
    conn.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
