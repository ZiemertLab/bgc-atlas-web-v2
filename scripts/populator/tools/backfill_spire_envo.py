"""Backfill the ENVO triad onto SPIRE MAG samples from their microntology tags
(spire_metadata.envo_for). SPIRE BioSamples carry almost no ENVO in ENA.
COALESCE-fills only NULL columns. Dry run unless --apply.

Usage:
    PGPASSWORD=... scripts/populator/.venv/bin/python -m scripts.populator.tools.backfill_spire_envo \
        [--dbname bgc_atlas_v2] [--apply]
"""
import argparse
import os
import sys

import psycopg2
from psycopg2.extras import execute_values

from scripts.populator.adapters import spire_metadata

COLS = ["environment_biome", "environment_feature", "environment_material"]


def _connect(dbname):
    return psycopg2.connect(host=os.environ.get("PGHOST", "localhost"),
                            user=os.environ.get("PGUSER", "bgc_owner"),
                            password=os.environ["PGPASSWORD"], dbname=dbname)


_SET = ",\n".join(f"{c} = COALESCE(s.{c}, v.{c})" for c in COLS)
_SQL = f"""UPDATE samples s SET {_SET}, updated_at = now()
             FROM (VALUES %s) AS v(id, {", ".join(COLS)})
            WHERE s.id = v.id::uuid"""
_TMPL = "(" + ", ".join(["%s"] * (len(COLS) + 1)) + ")"


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

    cur.execute("SELECT id, accession FROM samples WHERE data_source_ids && ARRAY[%s]::uuid[]",
                (spire_metadata.SPIRE_SOURCE_UUID,))
    rows = []
    from collections import Counter
    biome_dist = Counter()
    for sid, acc in cur.fetchall():
        e = spire_metadata.envo_for(acc)
        if not e:
            continue
        biome_dist[e["environment_biome"]] += 1
        rows.append((str(sid), *[e[c] for c in COLS]))
    print(f"SPIRE samples resolving to an ENVO triad: {len(rows)}")
    for b, n in biome_dist.most_common(10):
        print(f"  {n:6d}  {b}")

    if args.apply:
        for i in range(0, len(rows), 1000):
            execute_values(cur, _SQL, rows[i:i + 1000], template=_TMPL)
        conn.commit()
        print(f"APPLIED {len(rows)} updates, committed.")
    else:
        print("dry run (no --apply): no writes performed.")
    conn.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
