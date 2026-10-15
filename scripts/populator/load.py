from __future__ import annotations
import argparse, json, sys
from pathlib import Path
from typing import List
from .schema import load_order, TABLES


def _sql_quote(path) -> str:
    return str(path).replace("'", "''")


def table_files(in_dir, table: str) -> List[Path]:
    """Parquet file(s) for a table: ``<table>.parquet`` or its streamed
    ``<table>_NNNN.parquet`` parts (``_[0-9]*`` keeps ``samples`` from matching
    ``sample_assemblies``)."""
    in_dir = Path(in_dir)
    single = in_dir / f"{table}.parquet"
    if single.exists():
        return [single]
    return sorted(in_dir.glob(f"{table}_[0-9]*.parquet"))


def ordered_parquet(in_dir) -> List[str]:
    """Tables present in in_dir (single file or streamed parts), FK-safe load order."""
    in_dir = Path(in_dir)
    return [t for t in load_order() if table_files(in_dir, t)]


def duckdb_load(in_dir, db_path, execute: bool) -> dict:
    in_dir = Path(in_dir)
    order = ordered_parquet(in_dir)
    stmts = []
    for t in order:
        lit = "[" + ", ".join(f"'{_sql_quote(f)}'" for f in table_files(in_dir, t)) + "]"
        stmts.append(f"CREATE OR REPLACE TABLE {t} AS SELECT * FROM read_parquet({lit})")
    if not execute:
        return {"target": "duckdb", "order": order, "plan": stmts}
    import duckdb
    con = duckdb.connect(str(db_path))
    counts = {}
    try:
        for t, sql in zip(order, stmts):
            con.execute(sql)
            counts[t] = con.execute(f"SELECT count(*) FROM {t}").fetchone()[0]
    finally:
        con.close()
    return {"target": "duckdb", "db": str(db_path), "order": order, "counts": counts}


def postgres_script(in_dir, execute: bool) -> dict:
    """Generate a FK-safe \\copy load script. Dry-run only: never writes to Postgres."""
    if execute:
        raise SystemExit(
            "Postgres --execute is intentionally disabled. Review the generated "
            "script and run it manually against a NON-production database.")
    in_dir = Path(in_dir)
    order = ordered_parquet(in_dir)
    lines = ["-- Atlas populator Postgres load (FK-safe order).",
             "-- Review carefully and run against a NON-production DB only.",
             "BEGIN;"]
    for t in order:
        cols = ", ".join(TABLES[t].columns)
        tsvs = [in_dir / (p.stem + ".tsv") for p in table_files(in_dir, t)]
        existing = [tsv for tsv in tsvs if tsv.exists()]
        if existing:
            for tsv in existing:
                lines.append(rf"\copy {t} ({cols}) FROM '{_sql_quote(tsv)}' WITH (FORMAT text, NULL '\N');")
        else:
            lines.append(f"-- {t}: no .tsv present "
                         f"(run populate.py with --emit tsv to generate it).")
    lines.append("COMMIT;")
    return {"target": "postgres", "order": order, "script": "\n".join(lines)}


def main(argv=None) -> int:
    p = argparse.ArgumentParser(description="Atlas populator loader (parquet -> DuckDB | Postgres script)")
    p.add_argument("--in", dest="in_dir", required=True, help="directory of <table>.parquet")
    p.add_argument("--target", choices=["duckdb", "postgres"], required=True)
    p.add_argument("--execute", action="store_true",
                   help="duckdb: actually create the DB; postgres: refused (dry-run only)")
    p.add_argument("--duckdb", default=":memory:",
                   help="DuckDB file for --target duckdb --execute (CREATE OR REPLACE "
                        "drops same-named tables; use a throwaway file). Default :memory: "
                        "evaporates on exit.")
    p.add_argument("--out-script", default=None, help="write the postgres script to this file")
    args = p.parse_args(argv)

    if args.target == "duckdb":
        res = duckdb_load(args.in_dir, args.duckdb, args.execute)
        if args.execute:
            print(json.dumps(res["counts"], indent=2))
        else:
            print("\n".join(res["plan"]))
        return 0

    if args.execute:
        print("Refusing to execute against Postgres (no production writes). "
              "Generating the load script instead.", file=sys.stderr)
    res = postgres_script(args.in_dir, execute=False)
    if args.out_script:
        Path(args.out_script).write_text(res["script"])
        print(f"wrote {args.out_script}")
    else:
        print(res["script"])
    return 0


if __name__ == "__main__":
    sys.exit(main())
