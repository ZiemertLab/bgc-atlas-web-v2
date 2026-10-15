"""Re-adjudicate the GOLD ecosystem path of every GTDB genome that is not on an
authoritative GOLD path, preferring the genome's own metadata over species-level
guesses, and deleting the BacDive layer.

Scope, by ``metadata.gtdb_ecosystem_source``:
  * ``GOLD``              -> never touched;
  * ``isolation_source``  -> retagged ``ncbi_isolation_source`` only (no path change);
  * NULL / ``madin`` / ``bacdive`` -> re-adjudicated via ``gtdb_ecosystem.ecosystem_for``.

The ENVO triad may have been derived from the old path by backfill_envo_from_gold.py;
reading it back as evidence would re-launder the deleted guess. Detection compares
against the old path, so it must happen in the same pass as the path write. Such
rows are stamped ``metadata.envo_source = 'gold_derived'``.

Does not refresh the dependent materialized views; refresh them separately.

Usage:
    DATABASE_URL="postgresql://.../bgc_atlas_v2" \
      scripts/populator/.venv/bin/python -m scripts.populator.tools.backfill_gtdb_ecosystem \
        [--dbname bgc_atlas_v2] [--apply]

Without --apply it is a dry run (outcome table + per-field provenance + triad actions).
"""
import argparse
import collections
import dataclasses
import json
import os
import sys
from typing import Dict, List, Optional, Tuple

import psycopg2
from psycopg2.extras import execute_values

from scripts.populator.adapters import gtdb_ecosystem
from scripts.populator.adapters.envo_from_gold import gold_to_envo

# Cohorts this tool may re-adjudicate, by metadata.gtdb_ecosystem_source.
SCOPE_SOURCES: Tuple[Optional[str], ...] = (None, "", "madin", "bacdive")

LEGACY_SOURCE = "isolation_source"
LEGACY_SOURCE_FIELD = "ncbi_isolation_source"

TRIAD_COLS: List[str] = ["environment_biome", "environment_feature", "environment_material"]

# set_triad distinguishes "write NULL" from "leave alone".
VALUES_COLUMNS: List[str] = (
    ["id", "gold_ecosystem_path"] + TRIAD_COLS + ["set_triad", "meta_set", "meta_drop"]
)

_SCAN_SQL = """
    SELECT id,
           metadata->>'gtdb_ecosystem_source'                          AS source,
           metadata->>'envo_source'                                    AS envo_source,
           gold_ecosystem_path,
           metadata->>'ncbi_biosample'                                 AS ncbi_biosample,
           nullif(btrim(metadata->>'ncbi_isolation_source'), '')       AS ncbi_isolation_source,
           nullif(btrim(metadata->>'biosample_isolation_source'), '')  AS biosample_isolation_source,
           nullif(btrim(host_scientific_name), '')                     AS host_scientific_name,
           nullif(btrim(environment_biome), '')                        AS environment_biome,
           nullif(btrim(environment_feature), '')                      AS environment_feature,
           nullif(btrim(environment_material), '')                     AS environment_material,
           lower(regexp_replace(coalesce(metadata->>'gtdb_taxonomy', ''), '.*;s__', '')) AS species
    FROM samples
    WHERE data_source_ids && ARRAY[%s]::uuid[]
"""

_SCAN_COLUMNS = ("id", "source", "envo_source", "gold_ecosystem_path", "ncbi_biosample",
                 "ncbi_isolation_source", "biosample_isolation_source",
                 "host_scientific_name", "environment_biome", "environment_feature",
                 "environment_material", "species")


@dataclasses.dataclass(frozen=True)
class Decision:
    """``triad is None`` means leave the triad alone; a dict (possibly all-NULL) clears
    or rewrites it."""
    path: Optional[str] = None
    source: Optional[str] = None
    path_changed: bool = False
    triad: Optional[Dict[str, Optional[str]]] = None
    meta_set: Dict[str, str] = dataclasses.field(default_factory=dict)
    meta_drop: Tuple[str, ...] = ()
    outcome: str = "untouched"
    write: bool = False


def _outcome(old: Optional[str], new: Optional[str], source: Optional[str]) -> str:
    if new is None:
        return "dropped" if old is not None else "untouched"
    if old is None:
        return "filled"
    if new == old:
        return "unchanged"
    return "refined" if new.split(":")[0] == old.split(":")[0] else "corrected"


def decide(row) -> Decision:
    """Pure per-genome decision. ``GOLD`` is never written; ``isolation_source`` only
    gets the provenance relabel."""
    source = row.get("source")
    old = row.get("gold_ecosystem_path") or None

    if source == LEGACY_SOURCE:
        return Decision(path=old, source=LEGACY_SOURCE_FIELD, path_changed=False,
                        meta_set={"gtdb_ecosystem_source": LEGACY_SOURCE_FIELD},
                        outcome="retagged", write=True)
    if source not in SCOPE_SOURCES:
        return Decision(path=old, source=source, outcome="untouched", write=False)

    eco = gtdb_ecosystem.ecosystem_for(row.get("ncbi_biosample"), row, row.get("species"),
                                       current_path=old)
    new = eco["gold_ecosystem_path"] if eco else None
    new_source = eco["ecosystem_source"] if eco else None
    changed = new != old

    meta_set: Dict[str, str] = {}
    meta_drop: List[str] = []
    if new_source:
        meta_set["gtdb_ecosystem_source"] = new_source
    elif source:
        # a stored token with no layer behind it (the dropped BacDive rows)
        meta_drop.append("gtdb_ecosystem_source")

    # Only a triad derived from the old path is rewritten; an independent one is evidence.
    triad: Optional[Dict[str, Optional[str]]] = None
    manufactured = gtdb_ecosystem.derived_triad_fields(row, old)
    if manufactured:
        if changed:
            # only the derived fields follow the new path
            fresh = gold_to_envo(new) if new else None
            triad = {c: ((fresh[c] if fresh else None) if c in manufactured else row.get(c))
                     for c in TRIAD_COLS}
        if new:
            meta_set["envo_source"] = "gold_derived"
        else:
            meta_drop.append("envo_source")

    # Idempotence: skip rows where nothing differs, so a re-run doesn't rewrite every row.
    stored = {"gtdb_ecosystem_source": source or None,
              "envo_source": row.get("envo_source") or None}
    meta_drop = [k for k in meta_drop if stored.get(k) is not None]
    meta_differs = any(stored.get(k) != v for k, v in meta_set.items())
    write = bool(changed or triad is not None or meta_drop or meta_differs)

    return Decision(path=new, source=new_source, path_changed=changed, triad=triad,
                    meta_set=meta_set, meta_drop=tuple(meta_drop),
                    outcome=_outcome(old, new, source), write=write)


def to_values(sample_id, d: Decision) -> tuple:
    triad = d.triad or {c: None for c in TRIAD_COLS}
    return (
        str(sample_id),
        d.path,
        triad["environment_biome"],
        triad["environment_feature"],
        triad["environment_material"],
        d.triad is not None,
        json.dumps(d.meta_set, separators=(",", ":")),
        list(d.meta_drop),
    )


def _build_update_sql() -> str:
    """``set_triad`` guards the triad because writing NULL and leaving a column alone
    differ. ``metadata`` deletes then merges so a dropped key actually goes away."""
    col_list = ", ".join(VALUES_COLUMNS)
    return f"""
        UPDATE samples AS s SET
          gold_ecosystem_path  = v.gold_ecosystem_path,
          environment_biome    = CASE WHEN v.set_triad THEN v.environment_biome
                                      ELSE s.environment_biome END,
          environment_feature  = CASE WHEN v.set_triad THEN v.environment_feature
                                      ELSE s.environment_feature END,
          environment_material = CASE WHEN v.set_triad THEN v.environment_material
                                      ELSE s.environment_material END,
          metadata             = (s.metadata - v.meta_drop::text[]) || v.meta_set::jsonb,
          updated_at           = now()
        FROM (VALUES %s) AS v({col_list})
        WHERE s.id = v.id::uuid
    """


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

    try:
        gold_map = gtdb_ecosystem.load_gold_biosample_ecosystem()
        madin = gtdb_ecosystem.load_madin_species_traits()
    except FileNotFoundError as exc:
        print(f"ERROR: missing input file {exc.filename!r}. Run "
              f"`python -m scripts.populator.tools.prepare_gtdb_ecosystem_inputs` first to "
              f"regenerate the GTDB ecosystem TSVs.", file=sys.stderr)
        return 1
    print(f"loaded GOLD biosample map: {len(gold_map)} biosamples; "
          f"Madin species traits: {len(madin)} species", flush=True)
    print(f"GOLD validity prefix set: {len(gtdb_ecosystem.gold_prefixes())} prefixes",
          flush=True)

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

        scan = conn.cursor(name="gtdb_ecosystem_scan")
        scan.itersize = 20000
        scan.execute(_SCAN_SQL, (gtdb_ecosystem.GTDB_SOURCE_UUID,))

        updates: List[tuple] = []
        scanned = 0
        outcome = collections.Counter()
        by_cohort = collections.Counter()
        field = collections.Counter()
        triad_action = collections.Counter()
        out_of_scope_derived = 0
        examples: List[tuple] = []

        for values in scan:
            scanned += 1
            row = dict(zip(_SCAN_COLUMNS, values))
            d = decide(row)
            cohort = row["source"] or "NULL"
            outcome[d.outcome] += 1
            by_cohort[f"{cohort} -> {d.outcome}"] += 1
            if d.source and d.outcome not in ("retagged", "untouched"):
                field[d.source] += 1
            if d.outcome in ("untouched", "retagged") and \
                    gtdb_ecosystem.derived_triad_fields(row, row["gold_ecosystem_path"]):
                out_of_scope_derived += 1
            if d.triad is not None:
                triad_action["cleared" if d.path is None else "re-derived"] += 1
            elif "envo_source" in d.meta_set:
                triad_action["stamped only"] += 1
            if not d.write:
                continue
            if d.outcome in ("corrected", "dropped") and len(examples) < 8:
                examples.append((row, d))
            updates.append(to_values(row["id"], d))
        scan.close()

        print(f"\nGTDB samples scanned: {scanned}", flush=True)
        print(f"rows to write: {len(updates)}\n", flush=True)

        print("outcome:", flush=True)
        for k, n in outcome.most_common():
            print(f"  {k:12s} {n:8d}", flush=True)

        print("\nby cohort:", flush=True)
        for k, n in sorted(by_cohort.items()):
            print(f"  {k:34s} {n:8d}", flush=True)

        print("\nwinning field (re-adjudicated rows only):", flush=True)
        for k, n in field.most_common():
            print(f"  {k:30s} {n:8d}", flush=True)

        print("\nENVO triad:", flush=True)
        for k, n in triad_action.most_common():
            print(f"  {k:14s} {n:8d}", flush=True)
        print(f"  NOT stamped, out-of-scope GTDB rows whose triad is ALSO path-derived: "
              f"{out_of_scope_derived}", flush=True)

        print("\nexample corrections:", flush=True)
        for row, d in examples:
            evidence = {k: row[k] for k in gtdb_ecosystem.OWN_METADATA_CASCADE if row.get(k)}
            print(f"  {row['gold_ecosystem_path']!r} -> {d.path!r}  via {d.source!r}\n"
                  f"      evidence={evidence}", flush=True)

        if not args.apply:
            print("\ndry run (no --apply): no writes performed.", flush=True)
            return 0

        if updates:
            template = "(" + ", ".join(["%s"] * len(VALUES_COLUMNS)) + ")"
            for i in range(0, len(updates), 1000):
                batch = updates[i:i + 1000]
                # execute_values pages at 100 by default and rowcount reports only the
                # last page.
                execute_values(cur, _build_update_sql(), batch, template=template,
                               page_size=len(batch))
            print(f"\napplied {len(updates)} sample UPDATEs.", flush=True)
        else:
            print("\nno sample updates to apply.", flush=True)

        conn.commit()
        print("committed GTDB ecosystem re-adjudication.", flush=True)

        cur.execute(
            """
            SELECT count(gold_ecosystem_path), count(*),
                   count(*) FILTER (WHERE metadata->>'gtdb_ecosystem_source' = 'bacdive'),
                   count(*) FILTER (WHERE metadata->>'gtdb_ecosystem_source' = 'isolation_source')
            FROM samples
            WHERE data_source_ids && ARRAY[%s]::uuid[]
            """,
            (gtdb_ecosystem.GTDB_SOURCE_UUID,),
        )
        gold, total, bacdive_left, legacy_left = cur.fetchone()
        print("post-update coverage (GTDB samples):", flush=True)
        print(f"  gold_ecosystem_path={gold} total={total} "
              f"({100.0 * gold / total:.1f}%)", flush=True)
        print(f"  rows still tagged 'bacdive': {bacdive_left} (must be 0)", flush=True)
        print(f"  rows still tagged 'isolation_source': {legacy_left} (must be 0)", flush=True)
        return 0
    except Exception:
        conn.rollback()
        raise
    finally:
        cur.close()
        conn.close()


if __name__ == "__main__":
    sys.exit(main())
