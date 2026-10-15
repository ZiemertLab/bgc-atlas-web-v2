"""Reclassify `Host-associated:Animal:*` samples to the correct GOLD host category.

GOLD has no "Animal" category. Samples with a known ``host_taxid`` get the "Animal"
segment replaced (exact taxid mapping only); host-less ones are left as-is.
Idempotent; dry run unless --apply.

Usage:
    DATABASE_URL="postgresql://.../bgc_atlas_v2" \
      scripts/populator/.venv/bin/python -m scripts.populator.tools.reclassify_animal_host [--apply]
"""
import argparse
import os
import sys
from collections import defaultdict

import psycopg2
from psycopg2.extras import execute_values

# Only well-identified hosts.
TAXID_CATEGORY = {
    9031: "Birds",     # Gallus gallus (chicken)
    9103: "Birds",     # Meleagris gallopavo (turkey)
    9913: "Mammals",   # Bos taurus (cattle)
}


def _connect(dbname):
    url = os.environ.get("DATABASE_URL")
    if url:
        return psycopg2.connect(url)
    return psycopg2.connect(host=os.environ.get("PGHOST", "localhost"),
                            user=os.environ.get("PGUSER", "bgc_owner"),
                            password=os.environ["PGPASSWORD"], dbname=dbname)


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--dbname", default="bgc_atlas_v2")
    ap.add_argument("--apply", action="store_true", help="write the UPDATEs (default: dry run)")
    args = ap.parse_args()

    conn = _connect(args.dbname); conn.autocommit = False; cur = conn.cursor()
    try:
        cur.execute("SELECT current_database()")
        db = cur.fetchone()[0]
        if db != args.dbname:
            print(f"ABORT: connected to '{db}', expected '{args.dbname}'.", file=sys.stderr)
            return 2
        print(f"connected to {db}", flush=True)

        cur.execute(
            "SELECT id, gold_ecosystem_path, host_taxid FROM samples "
            "WHERE gold_ecosystem_path LIKE 'Host-associated:Animal%'")
        rows = cur.fetchall()

        updates = []          # (id, new_path, note)
        by = defaultdict(int)
        skipped_no_host = 0
        for sid, path, taxid in rows:
            cat = TAXID_CATEGORY.get(taxid)
            if not cat:
                skipped_no_host += 1
                continue
            segs = path.split(":")
            segs[1] = cat
            newp = ":".join(segs)
            updates.append((str(sid), newp, f"host_taxid={taxid}"))
            by[cat] += 1

        print(f"Animal samples: {len(rows)}; reclassifying: {len(updates)}; "
              f"left (no identifying host): {skipped_no_host}\n", flush=True)
        for cat in sorted(by):
            print(f"  -> {cat}: {by[cat]}", flush=True)

        if not updates:
            print("\nnothing to do.", flush=True); return 0
        if not args.apply:
            print("\nDRY RUN -- no writes. Re-run with --apply.", flush=True); return 0

        execute_values(
            cur,
            "UPDATE samples AS s SET gold_ecosystem_path = v.newp, "
            "  gold_ecosystem_metadata = coalesce(s.gold_ecosystem_metadata,'{}'::jsonb) "
            "    || jsonb_build_object('source','reclassify_animal_host', "
            "                          'reclassified_from','Host-associated:Animal', 'note', v.note), "
            "  updated_at = now() "
            "FROM (VALUES %s) AS v(id, newp, note) WHERE s.id = v.id::uuid",
            updates, page_size=max(len(updates), 1))
        print(f"\nUPDATE affected {cur.rowcount} rows", flush=True)
        conn.commit(); print("committed.", flush=True)
        return 0
    except Exception:
        conn.rollback(); raise
    finally:
        cur.close(); conn.close()


if __name__ == "__main__":
    sys.exit(main())
