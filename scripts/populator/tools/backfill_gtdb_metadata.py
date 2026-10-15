"""Backfill ``samples.metadata`` onto existing GTDB samples in bgc_atlas_v2 from the
production GTDB sample-metadata dump, without a full re-ingest.

Groups the EAV dump (``gtdb_sample_metadata.tsv``, exported from live ``bgc_atlas``)
into one metadata object per genome and merges it onto the GTDB sample whose
``name`` matches (``metadata || dump``).

Usage:
    PGPASSWORD=... scripts/populator/.venv/bin/python -m scripts.populator.tools.backfill_gtdb_metadata \
        --dump /data/bgc-atlas/data-v2/full-data/gtdb_sample_metadata.tsv \
        [--dbname bgc_atlas_v2] [--apply]

Without --apply it is a dry run (counts only, no writes).
"""
import argparse
import json
import os
import sys

import psycopg2
from psycopg2.extras import execute_values

from scripts.populator.tools.gtdb_dump_load import iter_gtdb_dump

GTDB_SOURCE = "GTDB"
_FLUSH = 20000


def _connect(dbname: str):
    return psycopg2.connect(
        host=os.environ.get("PGHOST", "localhost"),
        user=os.environ.get("PGUSER", "bgc_owner"),
        password=os.environ["PGPASSWORD"],
        dbname=dbname,
    )


def _apply_batch(cur, batch):
    execute_values(
        cur,
        """
        UPDATE samples AS s
        SET metadata = COALESCE(s.metadata, '{}'::jsonb) || v.md::jsonb,
            updated_at = now()
        FROM (VALUES %s) AS v(id, md)
        WHERE s.id = v.id::uuid
        """,
        batch,
        template="(%s, %s)",
    )


def main() -> int:
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    ap.add_argument("--dump", required=True, help="gtdb_sample_metadata.tsv (EAV dump)")
    ap.add_argument("--dbname", default="bgc_atlas_v2")
    ap.add_argument("--apply", action="store_true", help="write the UPDATEs (default: dry run)")
    args = ap.parse_args()

    conn = _connect(args.dbname)
    conn.autocommit = False
    cur = conn.cursor()

    print(f"loading GTDB sample name->id map from {args.dbname} ...", flush=True)
    cur.execute(
        """
        SELECT s.name, s.id
        FROM samples s
        WHERE EXISTS (
            SELECT 1 FROM data_sources d
            WHERE d.name = %s AND d.id = ANY(s.data_source_ids)
        )
        """,
        (GTDB_SOURCE,),
    )
    name_to_id = {name: str(sid) for name, sid in cur.fetchall()}
    print(f"GTDB samples in {args.dbname}: {len(name_to_id)}", flush=True)

    print(f"streaming dump {args.dump} ...", flush=True)
    batch = []
    matched = updated = dump_genomes = empty_skipped = 0
    examples = []
    for ext, fields in iter_gtdb_dump(args.dump):
        dump_genomes += 1
        sid = name_to_id.get(ext)
        if sid is None:
            continue
        matched += 1
        if not fields:
            empty_skipped += 1
            continue
        if len(examples) < 5:
            examples.append((ext, sorted(fields)[:6], len(fields)))
        if args.apply:
            batch.append((sid, json.dumps(fields, separators=(",", ":"))))
            if len(batch) >= _FLUSH:
                _apply_batch(cur, batch)
                conn.commit()
                updated += len(batch)
                print(f"  ...committed {updated} so far", flush=True)
                batch = []
        else:
            updated += 1

    if args.apply and batch:
        _apply_batch(cur, batch)
        conn.commit()
        updated += len(batch)

    print(
        f"dump genomes: {dump_genomes} | matched GTDB samples: {matched} "
        f"| empty (no fields, skipped): {empty_skipped} | "
        f"{'updated' if args.apply else 'would update'}: {updated}",
        flush=True,
    )
    for ext, keys, n in examples:
        print(f"  {ext}: {n} keys e.g. {keys}")

    if not args.apply:
        print("dry run (no --apply): no writes performed.")
        return 0

    cur.execute(
        """
        SELECT count(*) total, count(*) FILTER (WHERE metadata <> '{}'::jsonb) with_meta
        FROM samples s
        WHERE EXISTS (
            SELECT 1 FROM data_sources d
            WHERE d.name = %s AND d.id = ANY(s.data_source_ids)
        )
        """,
        (GTDB_SOURCE,),
    )
    total, with_meta = cur.fetchone()
    print(f"post-update GTDB coverage: total={total} non_empty_metadata={with_meta}", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
