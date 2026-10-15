#!/usr/bin/env python3
r"""Generate the in-place MGnify-v2 patch SQL for ``bgc_atlas_v2``.

Writes one transactional ``.sql`` script from the ``populator-out-mgnify-v2`` TSVs
that patches the MGnify metadata slice in place without touching ``bgcs`` /
``antismash_runs``. Never opens a database connection.

  1. ``\copy`` each present TSV into a ``tmp_<table>`` (ON COMMIT DROP).
  2. Entities and the ``mgnify_*`` tables are UPSERTed, never deleted:
     ``bgcs.assembly`` is ON DELETE CASCADE. ``data_sources`` is DO NOTHING.
  3. Junctions are deleted scoped to the owning v2 id-set, then re-inserted, so
     v1-only entities keep theirs.
  4. ``assembly_analyses`` is additive only (also written by the BGC pass).

Requires migration ``0048_mgnify_v2_new_types.sql``. MV refresh is separate.

After applying, derive GOLD paths for the new samples (left NULL by every load):

    DATABASE_URL=postgresql://bgc_owner@localhost/bgc_atlas_v2 \
      python3 scripts/backfill_gold_ecosystem.py --refresh-sample-mvs \
      --no-export-unmapped --no-export-mapped
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

from ..schema import TABLES

# Used in the generated header only; the patch scopes by id-sets.
DEFAULT_MGNIFY_DATA_SOURCE_ID = "27a9fa9d-2762-5e68-9fbe-0025002ce203"

# Matches tools/emit_mgnify_v2.py DEFAULT_OUT.
DEFAULT_TSV_DIR = "/data/bgc-atlas/data-v2/populator-out-mgnify-v2"

# entity/newtype: UPSERT, never delete. data_source: DO NOTHING. junction: scoped
# DELETE then INSERT. additive: INSERT DO NOTHING only (dual-owned).

ENTITY_TABLES = (
    "assemblies", "analyses", "samples", "runs", "studies", "biomes",
)

NEWTYPE_TABLES = (
    "mgnify_publications", "mgnify_super_studies",
    "mgnify_genome_catalogues", "mgnify_genomes",
)

# junction -> (scope_tmp_table, scope_col): the v2 entity id-set that owns it.
JUNCTION_SCOPE = {
    "sample_assemblies": ("assemblies", "assembly_id"),
    "sample_runs":       ("runs", "run_id"),
    "run_assemblies":    ("runs", "run_id"),
    "run_analyses":      ("runs", "run_id"),
    "run_studies":       ("runs", "run_id"),
    "sample_analyses":   ("analyses", "analysis_id"),
    "sample_biomes":     ("samples", "sample_id"),
}

ADDITIVE_TABLES = ("assembly_analyses",)

DATA_SOURCE_TABLE = "data_sources"

# Emission order of the per-table steps.
ALL_TABLES = (
    (DATA_SOURCE_TABLE,)
    + ENTITY_TABLES
    + NEWTYPE_TABLES
    + tuple(JUNCTION_SCOPE)
    + ADDITIVE_TABLES
)


def _classify(table: str) -> str:
    if table == DATA_SOURCE_TABLE:
        return "data_source"
    if table in NEWTYPE_TABLES:
        return "newtype"
    if table in ENTITY_TABLES:
        return "entity"
    if table in JUNCTION_SCOPE:
        return "junction"
    if table in ADDITIVE_TABLES:
        return "additive"
    raise KeyError(f"unclassified table: {table}")


def _cols(table: str) -> str:
    return ", ".join(TABLES[table].columns)


def _pk_cols(table: str) -> tuple:
    """The ON CONFLICT target: ``id``, or the junction's composite natural key."""
    cols = TABLES[table].columns
    if "id" in cols:
        return ("id",)
    return tuple(TABLES[table].natural_key_cols)


def _conflict_target(table: str) -> str:
    return "(" + ", ".join(_pk_cols(table)) + ")"


def _update_set(table: str) -> str:
    """``col = EXCLUDED.col`` for every non-PK column."""
    pk = set(_pk_cols(table))
    assigns = [f"{c} = EXCLUDED.{c}" for c in TABLES[table].columns if c not in pk]
    return ", ".join(assigns)


def _present(tsv_dir: Path) -> list:
    """Present ``<table>.tsv`` files (empty counts), in ALL_TABLES order."""
    return [t for t in ALL_TABLES if (tsv_dir / f"{t}.tsv").exists()]


def _sql_quote(path) -> str:
    return str(path).replace("'", "''")


def generate(tsv_dir, *, mgnify_data_source_id: str = DEFAULT_MGNIFY_DATA_SOURCE_ID) -> dict:
    """Build the patch SQL from the TSVs present in ``tsv_dir``.

    Returns ``{"sql", "present", "missing", "counts"}``.
    """
    tsv_dir = Path(tsv_dir)
    present = _present(tsv_dir)
    present_set = set(present)
    missing = [t for t in ALL_TABLES if t not in present_set]

    header = [
        "-- ============================================================================",
        "-- MGnify v2 in-place patch for bgc_atlas_v2 — GENERATED, review before applying.",
        "--",
        "-- Patches the MGnify metadata slice IN PLACE from the emit_mgnify_v2.py TSVs WITHOUT",
        "-- touching the 5.2M bgcs / antismash_runs. One transaction; no MV refresh (run the post-load refresh after).",
        "--",
        "-- Strategy:",
        "--   * entity tables (assemblies/analyses/samples/runs/studies/biomes) + the 4",
        "--     mgnify_* new-type tables: INSERT ... ON CONFLICT (id) DO UPDATE (never DELETE",
        "--     — bgcs.assembly is ON DELETE CASCADE, so deleting an assembly drops its bgcs;",
        "--     keeping v1-only entities also preserves their junctions).",
        f"--   * data_sources: ON CONFLICT (id) DO NOTHING (the MGnify row {mgnify_data_source_id}",
        "--     already exists).",
        "--   * junctions (except assembly_analyses): DELETE scoped to the v2 entity id-set",
        "--     then re-INSERT, so v1-only entities keep their junctions and nothing orphans.",
        "--   * assembly_analyses: ADDITIVE (dual-owned BGC-pass antiSMASH + mgnify metadata-",
        "--     pass) — INSERT ... ON CONFLICT DO NOTHING, NO delete.",
        "--",
        "-- mgnify-row identity (informational — the patch scopes by the v2 id-sets, so these",
        "-- accession filters are NOT used by the SQL): all runs are mgnify; mgnify assemblies",
        "-- = accession LIKE 'ERZ%'; mgnify analyses = accession LIKE 'MGYA%'; samples/studies",
        "-- are data_source-tagged.",
        "--",
        "-- PREREQUISITE: migration 0048_mgnify_v2_new_types.sql (the four mgnify_* tables)",
        "-- must already be applied — this script only UPSERTS into them.",
        "-- ============================================================================",
        "BEGIN;",
        "",
    ]

    load = ["-- 1) load each present v2 TSV into a TEMP table (dropped on COMMIT)"]
    for t in present:
        path = tsv_dir / f"{t}.tsv"
        load.append(
            f"CREATE TEMP TABLE tmp_{t} (LIKE {t} INCLUDING DEFAULTS) ON COMMIT DROP;")
        load.append(
            rf"\copy tmp_{t} ({_cols(t)}) FROM '{_sql_quote(path)}' "
            r"WITH (FORMAT text, NULL '\N');")
    load.append("")
    for t in missing:
        load.append(f"-- (skipped: {t}.tsv not present in the TSV dir)")
    if missing:
        load.append("")

    counts = {"entity": 0, "newtype": 0, "data_source": 0,
              "junction": 0, "additive": 0}

    upserts = ["-- 2) entity upserts (never delete) + data_sources (do nothing)"]
    for t in present:
        kind = _classify(t)
        if kind not in ("entity", "newtype", "data_source"):
            continue
        cols = _cols(t)
        if kind == "data_source":
            upserts.append(
                f"INSERT INTO {t} ({cols})\n  SELECT {cols} FROM tmp_{t}\n"
                f"  ON CONFLICT {_conflict_target(t)} DO NOTHING;")
        else:
            upserts.append(
                f"INSERT INTO {t} ({cols})\n  SELECT {cols} FROM tmp_{t}\n"
                f"  ON CONFLICT {_conflict_target(t)} DO UPDATE SET {_update_set(t)};")
        counts[kind] += 1
    upserts.append("")

    junctions = ["-- 3) junction refresh scoped to the v2 entity id-sets"]
    for t in present:
        if _classify(t) != "junction":
            continue
        scope_tmp, scope_col = JUNCTION_SCOPE[t]
        cols = _cols(t)
        junctions.append(
            f"DELETE FROM {t} WHERE {scope_col} IN (SELECT id FROM tmp_{scope_tmp});")
        junctions.append(
            f"INSERT INTO {t} ({cols})\n  SELECT {cols} FROM tmp_{t}\n"
            f"  ON CONFLICT {_conflict_target(t)} DO NOTHING;")
        counts["junction"] += 1
    junctions.append("")

    additive = ["-- 4) assembly_analyses: ADDITIVE (no delete — preserves BGC-pass links)"]
    for t in present:
        if _classify(t) != "additive":
            continue
        cols = _cols(t)
        additive.append(
            f"INSERT INTO {t} ({cols})\n  SELECT {cols} FROM tmp_{t}\n"
            f"  ON CONFLICT {_conflict_target(t)} DO NOTHING;")
        counts["additive"] += 1
    additive.append("")

    lines = header + load + upserts + junctions + additive + ["COMMIT;", ""]
    return {
        "sql": "\n".join(lines),
        "present": present,
        "missing": missing,
        "counts": counts,
    }


def main(argv=None) -> int:
    p = argparse.ArgumentParser(
        description="Generate the in-place MGnify-v2 patch SQL for bgc_atlas_v2 "
                    "PURE generator — never touches a database.")
    p.add_argument("--tsv-dir", default=DEFAULT_TSV_DIR,
                   help=f"dir of emit_mgnify_v2.py TSVs (default {DEFAULT_TSV_DIR})")
    p.add_argument("--out", default=None,
                   help="output .sql path (default <tsv-dir>/patch_mgnify_v2.sql)")
    p.add_argument("--mgnify-data-source-id", default=DEFAULT_MGNIFY_DATA_SOURCE_ID,
                   help="MGnify data_source id (used in comments only)")
    args = p.parse_args(argv)

    tsv_dir = Path(args.tsv_dir)
    out = Path(args.out) if args.out else tsv_dir / "patch_mgnify_v2.sql"

    res = generate(tsv_dir, mgnify_data_source_id=args.mgnify_data_source_id)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(res["sql"])

    c = res["counts"]
    print(f"wrote {out}")
    print(f"  TSV dir: {tsv_dir}")
    print(f"  steps: {c['entity']} entity-upsert, {c['newtype']} newtype-upsert, "
          f"{c['data_source']} data_source, {c['junction']} junction-refresh, "
          f"{c['additive']} additive")
    print(f"  TSVs found ({len(res['present'])}): {', '.join(res['present'])}")
    if res["missing"]:
        print(f"  TSVs missing ({len(res['missing'])}): {', '.join(res['missing'])}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
