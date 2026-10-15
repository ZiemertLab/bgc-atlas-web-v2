"""Deepen samples at ``Environmental:Terrestrial:Soil`` by mapping ``environment_feature`` to a
GOLD soil subtype (adapters.soil_subtype). Ambiguous features are left untouched.
Dry run unless --apply.
Usage:
    PGPASSWORD=... scripts/populator/.venv/bin/python -m scripts.populator.tools.backfill_soil_subtype \
        [--dbname bgc_atlas_v2] [--apply]
"""
import argparse
import os
import sys
from collections import Counter, defaultdict

import psycopg2
from psycopg2.extras import execute_values

from scripts.populator.adapters.soil_subtype import soil_subtype_for
from scripts.populator.core.gold_normalize import normalize_gold_ecosystem_path

GENERIC_SOIL = "Environmental:Terrestrial:Soil"


def _connect(dbname):
    return psycopg2.connect(host=os.environ.get("PGHOST", "localhost"),
                            user=os.environ.get("PGUSER", "bgc_owner"),
                            password=os.environ["PGPASSWORD"], dbname=dbname)


# Rewrite only if still exactly the generic Soil path (idempotent, never clobbers a deeper path).
_SQL = f"""UPDATE samples s SET gold_ecosystem_path = v.path, updated_at = now()
             FROM (VALUES %s) AS v(id, path)
            WHERE s.id = v.id::uuid AND s.gold_ecosystem_path = '{GENERIC_SOIL}'"""


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
        f"""SELECT id, environment_feature FROM samples
             WHERE gold_ecosystem_path = %s AND environment_feature IS NOT NULL""",
        (GENERIC_SOIL,))

    rows = []
    per_subtype = Counter()
    feature_map = defaultdict(lambda: [None, 0])  # feature -> [subtype, count]
    scanned = 0
    for sid, feat in cur.fetchall():
        scanned += 1
        sub = soil_subtype_for(feat)
        if not sub:
            continue
        path = normalize_gold_ecosystem_path(f"{GENERIC_SOIL}:{sub}")
        rows.append((str(sid), path))
        per_subtype[path.split(":")[-1]] += 1
        fm = feature_map[feat.strip().lower()]
        fm[0] = sub
        fm[1] += 1

    print(f"scanned {scanned} generic-Soil samples with a feature; {len(rows)} map to a subtype "
          f"({round(100.0*len(rows)/scanned) if scanned else 0}%)\n")
    print("=== resulting subtype distribution ===")
    for sub, n in per_subtype.most_common():
        print(f"  {n:6d}  Environmental:Terrestrial:Soil:{sub}")
    print("\n=== full feature -> subtype mapping (review these) ===")
    for feat, (sub, n) in sorted(feature_map.items(), key=lambda kv: -kv[1][1]):
        print(f"  {n:6d}  {feat!r:45s} -> {sub}")

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
