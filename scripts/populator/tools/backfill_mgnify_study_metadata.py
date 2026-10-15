"""Backfill MGnify study abstracts (+ center_name / bioproject) into bgc_atlas_v2
from the full studies dump bundle, without a re-ingest.

Streams the bundle through the shared ``mgnify_dump_emit.emit_study`` so values match
a fresh populate. Fill-only, and never touches study_name/title (study_bgc_summary
keys on study_name; renaming orphans its metrics row) or biome_ids (owned by the
ENVO/GOLD enrichment). Abstracts are loaded verbatim, including TPA boilerplate.

Matched on ``studies.accession``; dump accessions with no DB row are reported, not
inserted. --apply also re-syncs center_name/bioproject in study_bgc_summary.

Usage:
    PGPASSWORD=... scripts/populator/.venv/bin/python \
      -m scripts.populator.tools.backfill_mgnify_study_metadata \
        [--studies-tar <.../mgnify_asms/studies.tar.gz>] [--dbname bgc_atlas_v2] [--apply]

Without --apply it is a dry run (coverage counts + example rows only, no writes).
"""
import argparse
import os
import sys
from typing import Dict, List

import psycopg2
from psycopg2.extras import execute_values

from scripts.populator.adapters import mgnify_dump_emit as de
from scripts.populator.adapters.mgnify_dump import iter_entities

DEFAULT_TAR = "/data/bgc-atlas/data-v2/metadata/mgnify_asms/studies.tar.gz"

# study_name/title/biome_ids are deliberately absent; see the module docstring.
TARGET_COLS: List[str] = ["abstract", "center_name", "bioproject"]

_FLUSH = 5000


def _connect(dbname):
    return psycopg2.connect(host=os.environ.get("PGHOST", "localhost"),
                            user=os.environ.get("PGUSER", "bgc_owner"),
                            password=os.environ.get("PGPASSWORD"), dbname=dbname)


def dump_fields(tar_path: str) -> Dict[str, Dict[str, str]]:
    """accession -> {col: value} for the TARGET_COLS present in the dump."""
    out: Dict[str, Dict[str, str]] = {}
    for accession, obj in iter_entities(tar_path):
        for rec in de.emit_study(accession, obj):
            if rec.table != "studies":
                continue
            vals = {c: rec.fields[c] for c in TARGET_COLS
                    if rec.fields.get(c) not in (None, "")}
            if vals:
                out[accession] = vals
    return out


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--studies-tar", default=DEFAULT_TAR)
    ap.add_argument("--dbname", default="bgc_atlas_v2")
    ap.add_argument("--apply", action="store_true")
    args = ap.parse_args()

    if args.dbname == "bgc_atlas":
        print("refusing to touch the live v1 database", file=sys.stderr)
        return 2

    print(f"streaming {args.studies_tar} ...", flush=True)
    dump = dump_fields(args.studies_tar)
    per_col = {c: sum(1 for v in dump.values() if c in v) for c in TARGET_COLS}
    print(f"  dump studies with any target field: {len(dump)} | "
          + " | ".join(f"{c}: {n}" for c, n in per_col.items()), flush=True)

    conn = _connect(args.dbname)
    conn.autocommit = False
    cur = conn.cursor()

    cur.execute(
        "SELECT accession, abstract, center_name, bioproject FROM studies "
        "WHERE accession = ANY(%s)", (list(dump),))
    rows = cur.fetchall()
    current = {acc: dict(zip(TARGET_COLS, vals)) for acc, *vals in rows}
    missing = sorted(set(dump) - set(current))
    print(f"matched in DB: {len(current)} | in dump but not in DB: {len(missing)}"
          + (f" (e.g. {missing[:3]})" if missing else ""), flush=True)

    # NULL for already-populated or absent columns; COALESCE makes those no-ops.
    updates, filled = [], {c: 0 for c in TARGET_COLS}
    for acc, have in current.items():
        vals = dump[acc]
        row = [acc]
        touched = False
        for col in TARGET_COLS:
            new = vals.get(col) if have.get(col) in (None, "") else None
            row.append(new)
            if new is not None:
                filled[col] += 1
                touched = True
        if touched:
            updates.append(tuple(row))

    print(f"studies to update: {len(updates)} | "
          + " | ".join(f"+{n} {c}" for c, n in filled.items()), flush=True)

    if not args.apply:
        print("dry run (no --apply): no writes performed.")
        for acc, *vals in updates[:3]:
            preview = {c: (v[:60] + "…" if isinstance(v, str) and len(v) > 60 else v)
                       for c, v in zip(TARGET_COLS, vals) if v is not None}
            print(f"  e.g. {acc} -> {preview}")
        return 0

    for i in range(0, len(updates), _FLUSH):
        execute_values(
            cur,
            """UPDATE studies s SET
                 abstract    = COALESCE(s.abstract, v.abstract),
                 center_name = COALESCE(s.center_name, v.center_name),
                 bioproject  = COALESCE(s.bioproject, v.bioproject),
                 updated_at  = now()
               FROM (VALUES %s) AS v(accession, abstract, center_name, bioproject)
               WHERE s.accession = v.accession""",
            updates[i:i + _FLUSH])
        conn.commit()
    print(f"updated {len(updates)} studies", flush=True)

    # Only the cached identity columns; study_key and metrics are untouched.
    cur.execute(
        """UPDATE study_bgc_summary sbs
             SET center_name = s.center_name, bioproject = s.bioproject
           FROM studies s
           WHERE s.id = sbs.study_id
             AND s.accession = ANY(%s)
             AND (sbs.center_name IS DISTINCT FROM s.center_name
                  OR sbs.bioproject IS DISTINCT FROM s.bioproject)""",
        (list(current),))
    print(f"study_bgc_summary identity re-sync: {cur.rowcount} rows", flush=True)
    conn.commit()

    cur.execute(
        "SELECT count(*), count(abstract), count(center_name), count(bioproject) "
        "FROM studies WHERE accession ~ '^MGYS'")
    total, abs_n, cn, bp = cur.fetchone()
    print(f"post-backfill MGnify studies: {total} | abstract {abs_n} | "
          f"center_name {cn} | bioproject {bp}", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
