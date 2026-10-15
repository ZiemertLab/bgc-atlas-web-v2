"""Deepen samples stuck at a short GOLD aquatic path (Environmental:Aquatic[:Marine|:Freshwater])
by mapping their free-text environment_feature to a deeper aquatic subtype via
adapters.aquatic_subtype.aquatic_deepen (branch-aware, conservative).

Rewrites only samples whose path is exactly one of the handled short paths and whose feature
maps to a confident deeper path. Prints the feature->path mapping for review. Dry run unless
--apply.

Usage:
    PGPASSWORD=... scripts/populator/.venv/bin/python -m scripts.populator.tools.backfill_aquatic_subtype \
        [--dbname bgc_atlas_v2] [--apply]
"""
import argparse
import os
import sys
from collections import Counter, defaultdict

import psycopg2
from psycopg2.extras import execute_values

from scripts.populator.adapters.aquatic_subtype import aquatic_deepen
from scripts.populator.core.gold_normalize import normalize_gold_ecosystem_path

SHORT_PATHS = [
    "Environmental:Aquatic:Marine",
    "Environmental:Aquatic:Freshwater",
    "Environmental:Aquatic",
]

# Idempotent: only rewrites rows still on the original short path.
_SQL = """UPDATE samples s SET gold_ecosystem_path = v.newpath, updated_at = now()
            FROM (VALUES %s) AS v(id, oldpath, newpath)
           WHERE s.id = v.id::uuid AND s.gold_ecosystem_path = v.oldpath"""


def _connect(dbname):
    return psycopg2.connect(host=os.environ.get("PGHOST", "localhost"),
                            user=os.environ.get("PGUSER", "bgc_owner"),
                            password=os.environ["PGPASSWORD"], dbname=dbname)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--dbname", default="bgc_atlas_v2")
    ap.add_argument("--apply", action="store_true")
    args = ap.parse_args()

    conn = _connect(args.dbname)
    cur = conn.cursor()
    cur.execute("SELECT current_database()")
    if cur.fetchone()[0] != "bgc_atlas_v2":
        print("refusing: not bgc_atlas_v2", file=sys.stderr)
        return 2

    cur.execute(
        """SELECT id, gold_ecosystem_path, environment_feature FROM samples
             WHERE gold_ecosystem_path = ANY(%s) AND environment_feature IS NOT NULL""",
        (SHORT_PATHS,))

    rows = []
    per_path = Counter()
    feature_map = defaultdict(lambda: [None, 0])  # (old, feature) -> [newpath, count]
    scanned = 0
    for sid, old, feat in cur.fetchall():
        scanned += 1
        new = aquatic_deepen(old, feat)
        if not new:
            continue
        new = normalize_gold_ecosystem_path(new)
        rows.append((str(sid), old, new))
        per_path[new] += 1
        fm = feature_map[(old, feat.strip().lower())]
        fm[0] = new
        fm[1] += 1

    print(f"scanned {scanned} short-aquatic samples with a feature; {len(rows)} deepen "
          f"({round(100.0*len(rows)/scanned) if scanned else 0}%)\n")
    print("=== resulting path distribution ===")
    for p, n in per_path.most_common():
        print(f"  {n:6d}  {p}")
    print("\n=== full (current -> feature) -> new path (review these) ===")
    for (old, feat), (new, n) in sorted(feature_map.items(), key=lambda kv: -kv[1][1])[:120]:
        branch = old.split(":")[-1]
        print(f"  {n:6d}  [{branch:11s}] {feat!r:42s} -> {new.replace('Environmental:Aquatic:', '')}")

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
