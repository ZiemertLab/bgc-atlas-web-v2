"""Backfill the ENVO triad (environment_biome / feature / material) from each sample's existing
gold_ecosystem_path, via envo_from_gold.gold_to_envo. For sources that have GOLD but lack ENVO
(default: GEM, SMAG, TPMC). COALESCE-fills only NULL columns (GEM's environment_feature, set to
its habitat, is preserved). Scope-guarded to bgc_atlas_v2. Dry run unless --apply.

Usage:
    PGPASSWORD=... scripts/populator/.venv/bin/python -m scripts.populator.tools.backfill_envo_from_gold \
        [--sources GEM,SMAG,TPMC] [--dbname bgc_atlas_v2] [--apply]
"""
import argparse
import os
import sys
from collections import Counter

import psycopg2
from psycopg2.extras import execute_values

from scripts.populator.adapters.envo_from_gold import gold_to_envo

COLS = ["environment_biome", "environment_feature", "environment_material"]
DEFAULT_SOURCES = ["GEM", "SMAG", "TPMC"]


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
    ap.add_argument("--sources", default=",".join(DEFAULT_SOURCES),
                    help="comma-separated data_source names")
    ap.add_argument("--dbname", default="bgc_atlas_v2")
    ap.add_argument("--apply", action="store_true")
    ap.add_argument("--only", help="file of sample names (GTDB accessions) to limit the run to")
    args = ap.parse_args()
    only = sorted({l.strip() for l in open(args.only) if l.strip()}) if args.only else None

    conn = _connect(args.dbname)
    cur = conn.cursor()
    cur.execute("SELECT current_database()")
    if cur.fetchone()[0] != "bgc_atlas_v2":
        print("refusing: not bgc_atlas_v2", file=sys.stderr)
        return 2

    total = 0
    for src in [s.strip() for s in args.sources.split(",") if s.strip()]:
        cur.execute(
            """SELECT s.id, s.gold_ecosystem_path
                 FROM samples s JOIN data_sources d ON d.id = ANY(s.data_source_ids)
                WHERE d.name = %s AND s.gold_ecosystem_path IS NOT NULL
                  AND (%s::text[] IS NULL OR s.name = ANY(%s::text[]))""", (src, only, only))
        rows = []
        biome = Counter()
        for sid, gp in cur.fetchall():
            e = gold_to_envo(gp)
            if not e:
                continue
            biome[e["environment_biome"]] += 1
            rows.append((str(sid), *[e[c] for c in COLS]))
        print(f"{src}: {len(rows)} samples -> ENVO  | biomes: {dict(biome.most_common(6))}")
        if args.apply and rows:
            for i in range(0, len(rows), 1000):
                execute_values(cur, _SQL, rows[i:i + 1000], template=_TMPL)
        total += len(rows)
    if args.apply:
        conn.commit()
        print(f"APPLIED {total} updates, committed.")
    else:
        print(f"dry run (no --apply): {total} would be updated.")
    conn.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
