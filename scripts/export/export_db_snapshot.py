"""Export the bgc_atlas_v2 science tables to TSV + Parquet.

Types come from the PostgreSQL catalog, not CSV inference (Arrow reads ``t``/``f`` as
strings and an all-NULL column as ``null`` type). User/search tables are excluded as
personal data; matviews are excluded as derivable. Every base table in `public` must be
in TABLES or DENY (check_table_coverage) so a new migration's table is never missed.

Usage:
    python export_db_snapshot.py --out DIR [--limit N] [--only T1,T2] [--force]
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import pyarrow as pa
import pyarrow.compute as pc
import pyarrow.csv as pacsv
import pyarrow.parquet as pq

from pg_array import parse_pg_array

DB = "bgc_atlas_v2"

# Ordered small -> large: a conversion bug surfaces in seconds, not hours.
TABLES = [
    "product_category_map",
    "data_sources",
    "biomes",
    "mgnify_super_studies",
    "mgnify_genome_catalogues",
    "mgnify_publications",
    "study_biomes",
    "run_analyses",
    "study_bgc_summary",
    "studies",
    "run_studies",
    "run_assemblies",
    "sample_runs",
    "runs",
    "mgnify_genomes",
    "sample_biomes",
    "taxonomies",
    "gcf_study_count",
    "gcf_mibig_anchor",
    # where each family of a replaced clustering went: the old -> new crosswalk
    "gcf_legacy",
    "gcf_successor",
    "study_samples",
    "sample_measurements",
    "gcfs",
    "gcf_taxonomy_distribution_mv",
    "sample_assemblies",
    "sample_analyses",
    "assembly_analyses",
    "assemblies",
    "antismash_runs",
    "analyses",
    "samples",
    "assembly_taxonomy",
    "bgc_redirect",
    "study_gcf",
    "bgc_gcf",
    "bgc_taxonomy",
    "bgc_features",
    "bgcs",
]

# Exported like a table but built by a query: convenience views of the tables above, for readers who
# should not need a filter and three joins. Each must reconcile to DERIVED_EXPECT at export time.
#
# genomes: one row per genome (isolate, MAG or SAG assembly) with its CheckM2 quality, provenance,
# lineage and BGC count. Every genome has exactly one sample and one assembly; a
# genome with no BGC has no lineage, because assembly_taxonomy is derived from its BGCs.
DERIVED = {
    "genomes": """
        WITH g AS (
            SELECT sa.sample_id, a.id AS assembly_id, a.source_type
            FROM sample_assemblies sa JOIN assemblies a ON a.id = sa.assembly_id
            WHERE a.source_type IN ('isolate', 'MAG', 'SAG')
        ), n AS (
            SELECT b.assembly AS assembly_id, count(*)::int AS bgc_count FROM bgcs b GROUP BY b.assembly
        )
        SELECT s.id AS sample_id, s.accession, s.name, g.assembly_id, g.source_type,
               (SELECT string_agg(ds.name, '; ' ORDER BY ds.name) FROM data_sources ds
                 WHERE ds.id = ANY (s.data_source_ids)) AS collection,
               s.checkm_completeness, s.checkm_contamination, s.genome_quality, s.genome_size,
               s.checkm_tool, s.checkm_source,
               t.domain, t.phylum, t.class, t.order_name AS "order", t.family, t.genus, t.species,
               t.rank AS taxonomy_rank, t.method AS taxonomy_method,
               COALESCE(n.bgc_count, 0) AS bgc_count
        FROM g
        JOIN samples s ON s.id = g.sample_id
        LEFT JOIN assembly_taxonomy t ON t.assembly_id = g.assembly_id
        LEFT JOIN n ON n.assembly_id = g.assembly_id
        ORDER BY s.accession, s.id
    """,
}

# The row count each derived export must have: a join that duplicates or drops genomes fails the export.
DERIVED_EXPECT = {
    "genomes": "SELECT count(DISTINCT sa.sample_id) FROM sample_assemblies sa "
               "JOIN assemblies a ON a.id = sa.assembly_id WHERE a.source_type IN ('isolate', 'MAG', 'SAG')",
}


def one_line(sql: str) -> str:
    """\\copy takes its query on one line."""
    return " ".join(sql.split())


DENY_PREFIXES = (
    "admin_",              # operational tables, in databases that still have them
    "user_",               # visitor uploads and contributions
    "bigslice_",           # per-visitor query-search sessions and results
    "sequence_search_",    # per-visitor DIAMOND sessions and results
    "tmp_",                # scratch
    "_",                   # migration bookkeeping (_prisma_migrations)
)

DENY = {
    # personal data
    "feedback",
    # operational
    "api_performance_metrics",
    "cache_analytics",
    "request_analytics",
    "system_metrics",
    "loader_progress",
    "gcf_export_jobs",
    # one-off backups, rollbacks and audit records
    "bgc_taxonomy_v1_backup",             # taxonomy v1, superseded by bgc_taxonomy
    "gold_path_reclass",                  # GOLD reclass staging/audit record, not a hot path
    "gold_path_reclass_run1",             # prior run of the same
    "gtdb_ecosystem_rollback_20260818",   # rollback copy
    # byte offsets into the combined GBK archive: serving index, not data
    "bgc_gbk_offsets",
}

ARROW_BY_PGTYPE = {
    "int2": pa.int16(),
    "int4": pa.int32(),
    "int8": pa.int64(),
    "float4": pa.float32(),
    "float8": pa.float64(),
    # Every numeric here is a measurement or score; none needs exactness.
    "numeric": pa.float64(),
    "date": pa.date32(),
    "timestamp": pa.timestamp("us"),
    "timestamptz": pa.timestamp("us", tz="UTC"),
    "bool": pa.bool_(),
    "_text": pa.list_(pa.string()),
    "_uuid": pa.list_(pa.string()),
}


def psql(sql: str, db: str = DB) -> str:
    env = {**os.environ, "PGOPTIONS": "-c lock_timeout=30s -c statement_timeout=0"}
    res = subprocess.run(
        ["psql", "-d", db, "-Atc", sql],
        capture_output=True, text=True, env=env, check=True,
    )
    return res.stdout


def public_base_tables() -> list[str]:
    """relkind='r' only; tables named *_mv (built in DuckDB) are real tables and included."""
    out = psql(
        "select c.relname from pg_class c "
        "where c.relnamespace='public'::regnamespace and c.relkind='r' "
        "order by c.relname"
    )
    return [ln for ln in out.strip().splitlines() if ln]


def check_table_coverage() -> None:
    live = public_base_tables()
    known = set(TABLES) | DENY
    unclassified = [
        t for t in live
        if t not in known and not t.startswith(DENY_PREFIXES)
    ]
    if unclassified:
        raise SystemExit(
            "export_db_snapshot: these tables exist in public but are in neither "
            "TABLES nor DENY:\n"
            + "".join(f"  - {t}\n" for t in unclassified)
            + "Add each to TABLES (to publish it) or to DENY (with a reason). "
            "Refusing to export a partial snapshot."
        )

    missing = [t for t in TABLES if t not in set(live)]
    if missing:
        raise SystemExit(
            "export_db_snapshot: TABLES names tables that no longer exist:\n"
            + "".join(f"  - {t}\n" for t in missing)
        )


def pg_columns(table: str) -> list[tuple[str, str]]:
    """A derived export is typed through a temporary view of its query, so its types come
    from the catalog too."""
    if table in DERIVED:
        out = psql(
            f"CREATE TEMP VIEW _derived AS {one_line(DERIVED[table])}; "
            "select a.attname || E'\\t' || t.typname from pg_attribute a "
            "join pg_type t on t.oid = a.atttypid "
            "where a.attrelid = 'pg_temp._derived'::regclass and a.attnum > 0 order by a.attnum"
        )
        # psql also prints CREATE VIEW's status line; the columns are the tab-separated ones.
        return [tuple(line.split("\t")) for line in out.strip().splitlines() if "\t" in line]
    out = psql(
        "select a.attname || E'\\t' || t.typname "
        "from pg_attribute a "
        "join pg_class c on c.oid = a.attrelid "
        "join pg_type t on t.oid = a.atttypid "
        f"where c.relnamespace='public'::regnamespace and c.relname = '{table}' "
        "and a.attnum > 0 and not a.attisdropped order by a.attnum"
    )
    cols = []
    for line in out.strip().splitlines():
        name, typname = line.split("\t")
        cols.append((name, typname))
    if not cols:
        raise SystemExit(f"table not found: {table}")
    return cols


def arrow_type(pg_type: str) -> pa.DataType:
    # uuid, text, varchar, jsonb, json, inet, enums -> string
    return ARROW_BY_PGTYPE.get(pg_type, pa.string())


def copy_tsv(table: str, dest: Path, limit: int | None) -> int:
    rel = f"({one_line(DERIVED[table])})" if table in DERIVED else table
    src = rel if limit is None else f"(select * from {rel} AS x limit {limit})"
    cmd = (
        f"\\copy {src} TO '{dest}' "
        "(FORMAT csv, DELIMITER E'\\t', HEADER true, QUOTE '\"')"
    )
    env = {**os.environ, "PGOPTIONS": "-c lock_timeout=30s -c statement_timeout=0"}
    res = subprocess.run(
        ["psql", "-d", DB, "-c", cmd],
        capture_output=True, text=True, env=env, check=True,
    )
    tail = res.stdout.strip().splitlines()[-1] if res.stdout.strip() else ""
    if not tail.startswith("COPY "):
        raise RuntimeError(f"{table}: unexpected psql output {tail!r} {res.stderr[:200]}")
    return int(tail.split()[1])


def convert_column(col: pa.ChunkedArray | pa.Array, target: pa.DataType) -> pa.Array:
    if pa.types.is_boolean(target):
        # Arrow cannot cast PostgreSQL's 't'/'f'; equal() propagates nulls.
        return pc.equal(col, "t")
    if pa.types.is_list(target):
        parsed = [parse_pg_array(v) for v in col.to_pylist()]
        return pa.array(parsed, type=target)
    if pa.types.is_string(target):
        return col if isinstance(col, pa.Array) else col.combine_chunks()
    return pc.cast(col, target)


def convert(tsv: Path, parquet: Path, cols: list[tuple[str, str]]) -> int:
    names = [n for n, _ in cols]
    schema = pa.schema([pa.field(n, arrow_type(t)) for n, t in cols])

    read_opts = pacsv.ReadOptions(block_size=128 << 20)
    parse_opts = pacsv.ParseOptions(
        delimiter="\t", quote_char='"', double_quote=True,
        escape_char=False, newlines_in_values=True,
    )
    # Read everything as string; unquoted empty -> null, quoted "" -> "".
    convert_opts = pacsv.ConvertOptions(
        strings_can_be_null=True,
        quoted_strings_can_be_null=False,
        column_types={n: pa.string() for n in names},
    )

    rows = 0
    writer = None
    try:
        with pacsv.open_csv(tsv, read_options=read_opts, parse_options=parse_opts,
                            convert_options=convert_opts) as reader:
            if writer is None:
                writer = pq.ParquetWriter(parquet, schema, compression="zstd",
                                          compression_level=3)
            for batch in reader:
                arrays = [
                    convert_column(batch.column(i), schema.field(i).type)
                    for i in range(len(names))
                ]
                out = pa.RecordBatch.from_arrays(arrays, schema=schema)
                writer.write_batch(out)
                rows += out.num_rows
    finally:
        if writer is not None:
            writer.close()
    return rows


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(8 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def utc_now_iso() -> str:
    now = datetime.now(timezone.utc).replace(microsecond=0)
    return now.isoformat().replace("+00:00", "Z")


def write_manifest(path: Path, manifest: dict) -> None:
    """Scalar metadata first, so generated_at is not buried after the table block."""
    lead = [k for k in ("database", "generated_at") if k in manifest]
    ordered = {k: manifest[k] for k in lead}
    ordered.update({k: v for k, v in manifest.items() if k not in ordered})
    path.write_text(json.dumps(ordered, indent=2))


def dump_schema(tables: list[str], dest: Path) -> None:
    args = ["pg_dump", "-d", DB, "--schema-only", "--no-owner", "--no-privileges"]
    for t in tables:
        args += ["-t", f"public.{t}"]
    res = subprocess.run(args, capture_output=True, text=True, check=True)
    dest.write_text(res.stdout)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True, type=Path)
    ap.add_argument("--limit", type=int, help="rows per table (smoke test)")
    ap.add_argument("--only", help="comma-separated subset of tables")
    ap.add_argument("--force", action="store_true", help="re-export completed tables")
    args = ap.parse_args()

    # Runs even with --only.
    check_table_coverage()

    if args.only:
        wanted = [t.strip() for t in args.only.split(",")]
        unknown = [t for t in wanted if t not in TABLES and t not in DERIVED]
        if unknown:
            raise SystemExit(f"not in TABLES or DERIVED: {unknown}")
        tables = wanted
    else:
        tables = TABLES + list(DERIVED)

    out = args.out
    (out / "tsv").mkdir(parents=True, exist_ok=True)
    (out / "parquet").mkdir(parents=True, exist_ok=True)

    manifest_path = out / "MANIFEST.json"
    manifest = {"database": DB, "tables": {}}
    if manifest_path.exists():
        manifest = json.loads(manifest_path.read_text())
    manifest.setdefault("tables", {})

    for table in tables:
        if not args.force and table in manifest["tables"]:
            print(f"[skip] {table} (already in manifest)", flush=True)
            continue

        tsv = out / "tsv" / f"{table}.tsv"
        parquet = out / "parquet" / f"{table}.parquet"
        cols = pg_columns(table)

        t0 = time.time()
        copied = copy_tsv(table, tsv, args.limit)
        t1 = time.time()
        written = convert(tsv, parquet, cols)
        t2 = time.time()

        if written != copied:
            raise SystemExit(
                f"{table}: row mismatch — COPY {copied}, parquet {written}"
            )
        if table in DERIVED and args.limit is None:
            expect = int(psql(DERIVED_EXPECT[table]).strip())
            if copied != expect:
                raise SystemExit(f"{table}: {copied:,} rows, expected {expect:,}: the query drops or duplicates rows")

        manifest["tables"][table] = {
            "rows": copied,
            **({"derived": True} if table in DERIVED else {}),
            "tsv_bytes": tsv.stat().st_size,
            "tsv_sha256": sha256(tsv),
            "parquet_bytes": parquet.stat().st_size,
            "parquet_sha256": sha256(parquet),
            "copy_seconds": round(t1 - t0, 1),
            "convert_seconds": round(t2 - t1, 1),
            "columns": [
                {"name": n, "pg_type": t, "arrow_type": str(arrow_type(t))}
                for n, t in cols
            ],
        }
        # Stamped per table: runs resume from the manifest, so it means "newest table
        # finished at this instant".
        manifest["generated_at"] = utc_now_iso()
        write_manifest(manifest_path, manifest)
        print(
            f"[done] {table}: {copied:,} rows  "
            f"tsv {tsv.stat().st_size / 1e9:.2f} GB  "
            f"pq {parquet.stat().st_size / 1e9:.2f} GB  "
            f"copy {t1 - t0:.0f}s convert {t2 - t1:.0f}s",
            flush=True,
        )

    dump_schema([t for t in TABLES if t in manifest["tables"]], out / "schema.sql")
    # Not re-stamped: a no-op re-run must not make stale data look fresh.
    write_manifest(manifest_path, manifest)
    print(f"\nmanifest: {manifest_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
