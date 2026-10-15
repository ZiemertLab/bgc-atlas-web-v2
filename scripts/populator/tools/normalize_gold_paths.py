"""Canonicalize existing ``samples.gold_ecosystem_path`` values in-place.

Applies the same normalizer the populator runs at ingest (``core/gold_normalize.py``),
so ingest and this backfill cannot disagree. Idempotent.

Usage:
    DATABASE_URL="postgresql://.../bgc_atlas_v2" \
      scripts/populator/.venv/bin/python -m scripts.populator.tools.normalize_gold_paths \
        [--dbname bgc_atlas_v2] [--apply]

Without --apply it is a dry run that prints the old->new change set. Materialized
views are not refreshed here; the ones to refresh are printed after --apply.
"""
import argparse
import os
import sys

import psycopg2
from psycopg2.extras import execute_values

from scripts.populator.core.gold_normalize import normalize_gold_ecosystem_path

# Read samples.gold_ecosystem_path; refresh after --apply.
GOLD_MVS = [
    "assembly_samples_mv",
    "gcf_gold_ecosystem_distribution_mv",
    "bgc_gold_ecosystem_distribution_mv",
    "sample_map_view",
    "sample_summary",
]


def _connect(dbname: str):
    url = os.environ.get("DATABASE_URL")
    if url:
        return psycopg2.connect(url)
    return psycopg2.connect(
        host=os.environ.get("PGHOST", "localhost"),
        user=os.environ.get("PGUSER", "bgc_owner"),
        password=os.environ["PGPASSWORD"],
        dbname=dbname,
    )


def main() -> int:
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    ap.add_argument("--dbname", default="bgc_atlas_v2")
    ap.add_argument("--apply", action="store_true",
                    help="write the UPDATEs (default: dry run)")
    args = ap.parse_args()

    conn = _connect(args.dbname)
    conn.autocommit = False
    cur = conn.cursor()
    try:
        cur.execute("SELECT current_database()")
        db = cur.fetchone()[0]
        if db != args.dbname:
            print(f"ABORT: connected to '{db}', expected '{args.dbname}'. "
                  f"Set --dbname or fix DATABASE_URL.", file=sys.stderr)
            return 2
        print(f"connected to {db}", flush=True)

        cur.execute(
            "SELECT gold_ecosystem_path, count(*) "
            "FROM samples "
            "WHERE gold_ecosystem_path IS NOT NULL AND gold_ecosystem_path <> '' "
            "GROUP BY gold_ecosystem_path"
        )
        rows = cur.fetchall()

        changes = []          # (old, new, n_samples)
        samples_affected = 0
        for old, n in rows:
            new = normalize_gold_ecosystem_path(old)
            if new != old:
                changes.append((old, new, n))
                samples_affected += n

        print(f"distinct paths: {len(rows)}; paths changed: {len(changes)}; "
              f"samples affected: {samples_affected}\n", flush=True)
        for old, new, n in sorted(changes, key=lambda c: -c[2]):
            print(f"  [{n:>6}]  {old}\n            -> {new}", flush=True)

        if not changes:
            print("\nnothing to do -- already canonical.", flush=True)
            return 0

        if not args.apply:
            print("\nDRY RUN -- no writes. Re-run with --apply to persist.", flush=True)
            return 0

        execute_values(
            cur,
            # newp is cast because a rule may normalize to NULL, and a VALUES list of
            # only NULLs would otherwise have type "unknown".
            "UPDATE samples AS s SET gold_ecosystem_path = v.newp::text, updated_at = now() "
            "FROM (VALUES %s) AS v(oldp, newp) "
            "WHERE s.gold_ecosystem_path = v.oldp",
            [(old, new) for old, new, _ in changes],
        )
        print(f"\nUPDATE affected {cur.rowcount} rows", flush=True)
        conn.commit()
        print("committed.", flush=True)
        print("\nNOW REFRESH the gold-carrying materialized views:", flush=True)
        for mv in GOLD_MVS:
            print(f"  REFRESH MATERIALIZED VIEW {mv};", flush=True)
        return 0
    except Exception:
        conn.rollback()
        raise
    finally:
        cur.close()
        conn.close()


if __name__ == "__main__":
    sys.exit(main())
