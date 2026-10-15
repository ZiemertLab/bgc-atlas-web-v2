"""Backfill metadata for the small custom MAG sources (deep-sea hydrothermal DSV70, FRAM RAS,
ocean-surface HaDS, ziemert-lab) in bgc_atlas_v2, from customs_metadata. COALESCE-fills value
columns, overwrites the source-owned classification tags, jsonb-merges metadata, and sets each
source's source_url. Scope-guarded. Dry run unless --apply.

Skips customs_metadata.EMIT_SOURCES (Great Barrier Reef, Helgoland 2020): those load with their
metadata at emit, and this tool's overwrite of the classification tags would revert any later
GOLD correction of them.

Usage:
    PGPASSWORD=... scripts/populator/.venv/bin/python -m scripts.populator.tools.backfill_customs_metadata \
        [--dbname bgc_atlas_v2] [--apply]
"""
import argparse
import os
import sys

import psycopg2
from psycopg2.extras import execute_values

from scripts.populator.adapters import customs_metadata

VALUE_COLS = ["latitude", "longitude", "depth", "geographic_location", "collection_date",
              "environment_biome", "environment_feature", "environment_material"]
OVERWRITE_COLS = ["gold_ecosystem_path", "location_resolution"]
TARGET_COLS = VALUE_COLS + OVERWRITE_COLS + ["metadata"]
CAST = {"latitude": "numeric", "longitude": "numeric", "depth": "numeric",
        "collection_date": "date", "metadata": "jsonb"}


def _connect(dbname):
    return psycopg2.connect(host=os.environ.get("PGHOST", "localhost"),
                            user=os.environ.get("PGUSER", "bgc_owner"),
                            password=os.environ["PGPASSWORD"], dbname=dbname)


def _build_sql():
    parts = []
    for c in TARGET_COLS:
        cast = CAST.get(c, "text")
        if c == "metadata":
            parts.append("metadata = s.metadata || v.metadata::jsonb")
        elif c in OVERWRITE_COLS:
            parts.append(f"{c} = COALESCE(v.{c}::{cast}, s.{c})")
        else:
            parts.append(f"{c} = COALESCE(s.{c}, v.{c}::{cast})")
    return f"""UPDATE samples s SET {", ".join(parts)}, updated_at = now()
                 FROM (VALUES %s) AS v(id, {", ".join(TARGET_COLS)})
                WHERE s.id = v.id::uuid"""


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

    tmpl = "(" + ", ".join(["%s"] * (len(TARGET_COLS) + 1)) + ")"
    sql = _build_sql()
    total = 0
    for src, (uuid, url, _fn) in customs_metadata.SOURCES.items():
        if src in customs_metadata.EMIT_SOURCES:
            continue
        cur.execute("SELECT id, name FROM samples WHERE data_source_ids && ARRAY[%s]::uuid[]",
                    (uuid,))
        samples = cur.fetchall()
        rows = []
        for sid, acc in samples:
            f = customs_metadata.enrichment_for(src, acc)
            if not f:
                continue
            rows.append((str(sid), *[f.get(c) for c in TARGET_COLS]))
        resolved = len(rows)
        gold = sum(1 for r in rows if r[1 + TARGET_COLS.index("gold_ecosystem_path")])
        print(f"{src}: {len(samples)} samples, {resolved} resolved "
              f"({gold} with gold), source_url={url}")
        if args.apply and rows:
            for i in range(0, len(rows), 1000):
                execute_values(cur, sql, rows[i:i + 1000], template=tmpl)
            cur.execute("""UPDATE data_sources SET source_url = %s
                            WHERE id = %s::uuid AND (source_url IS NULL OR source_url = '')""",
                        (url, uuid))
        total += resolved
    if args.apply:
        conn.commit()
        print(f"APPLIED {total} sample updates + source_urls, committed.")
    else:
        print(f"dry run (no --apply): {total} would be updated.")
    conn.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
