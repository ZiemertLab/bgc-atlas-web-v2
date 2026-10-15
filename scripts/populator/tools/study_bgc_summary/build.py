#!/usr/bin/env python3
"""Build the Studies biosynthetic precompute (gcf_study_count + study_bgc_summary).

The /studies pages read only precomputed tables because Postgres cannot aggregate
~16.5M bgcs in reasonable time. This pulls the needed columns through a read-only
ATTACH, detaches, aggregates in DuckDB and writes three CSVs to --workdir; load.sql
loads them in a separate step. Never writes to Postgres.

A "logical study" collapses studies rows by COALESCE(NULLIF(study_name,''),
accession, id::text). An "exclusive" GCF has study_count == 1; "rare" means
study_count <= --rare-max.

--threads is also the number of Postgres connections during the pull; run in a
quiet window.

Usage
-----
    /path/to/venv/python build.py \
        --env ../../../../bgc-atlas/.env \
        --workdir ./_work \
        --threads 3 --rare-max 3 --top-n 20

Requires the `duckdb` python module (>=0.10) with the `postgres` extension
(auto-installed on first run; needs network once).
"""
from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path
from urllib.parse import urlparse, unquote


def log(msg: str) -> None:
    print(f"[{time.strftime('%H:%M:%S')}] {msg}", flush=True)


def read_database_url(env_path: Path) -> str:
    """Pull DATABASE_URL out of a dotenv file without importing dotenv."""
    if not env_path.exists():
        sys.exit(f"env file not found: {env_path}")
    for line in env_path.read_text().splitlines():
        line = line.strip()
        if line.startswith("DATABASE_URL="):
            val = line.split("=", 1)[1].strip()
            if val and val[0] in "\"'" and val[-1] == val[0]:
                val = val[1:-1]
            return val
    sys.exit(f"DATABASE_URL not found in {env_path}")


def pg_dsn_from_url(url: str) -> str:
    """postgresql:// URI -> libpq key=value DSN, for when ATTACH rejects the URI.

    Values are left bare (ours have no spaces); the caller escapes single quotes.
    """
    u = urlparse(url)
    parts = {
        "host": u.hostname or "localhost",
        "port": str(u.port or 5432),
        "dbname": (u.path or "/").lstrip("/"),
        "user": unquote(u.username or ""),
        "password": unquote(u.password or ""),
    }
    return " ".join(f"{k}={v}" for k, v in parts.items() if v != "")


def _attach_pg(con, pg_url: str) -> None:
    """ATTACH PG read-only via the URI, falling back to a key=value DSN."""
    def esc(s: str) -> str:
        return s.replace("'", "''")
    try:
        con.execute(f"ATTACH '{esc(pg_url)}' AS pg (TYPE postgres, READ_ONLY);")
    except Exception as e:  # noqa: BLE001
        log(f"  URI attach failed ({type(e).__name__}); retrying with key=value DSN")
        con.execute(f"ATTACH '{esc(pg_dsn_from_url(pg_url))}' AS pg (TYPE postgres, READ_ONLY);")


# Kept minimal so the heavy bgcs read moves as few bytes as possible.
PULL = {
    # Primary family only, or a multi-family BGC inflates every count.
    # The FROM-rewrite below prefixes only the first table, so bgc_gcf is written
    # as pg.bgc_gcf and the SELECT list must not contain "FROM ".
    "bgcs": ("SELECT b.assembly, bg.gcf_id, b.is_complete, b.product AS product_type, b.product_category "
             "FROM bgcs b LEFT JOIN pg.bgc_gcf bg ON bg.bgc_id=b.id AND bg.is_primary"),
    "sample_assemblies": "SELECT sample_id, assembly_id FROM sample_assemblies",
    # metagenome | MAG | SAG | isolate, for genome_count and source_type_dist
    "assemblies": "SELECT id, source_type FROM assemblies",
    # which data sources a study's samples came from, for data_sources
    "sample_ds": "SELECT id, data_source_ids FROM samples",
    "data_sources": "SELECT id, name FROM data_sources",
    "study_samples": "SELECT study_id, sample_id FROM study_samples",
    "studies": "SELECT id, title, study_name, center_name, accession, bioproject, study_type FROM studies",
    # sample_summary is a MV; slice used only for the index biome chip/filter rollup
    "ss_slice": "SELECT id, primary_biome, gold_ecosystem_path FROM sample_summary",
    # Physical sample behind each samples row, for sample_count: MAG catalogues
    # store one row per genome bin. The per-source expressions were validated
    # against the corpus; sources without a parent fall through to the row id.
    # postgres_query() because DuckDB can't parse these Postgres expressions;
    # such entries skip the FROM-rewrite below.
    "sample_parent": (
        "SELECT * FROM postgres_query('pg', '"
        "SELECT s.id, COALESCE("
        "s.metadata->''spire''->>''biosample'',"          # SPIRE MAGs -> SAMEA…
        "s.metadata->''mfd''->>''barcode'',"              # Microflora Danica -> MFD#####
        "s.metadata->''gem''->>''metagenome_id'',"        # GEM -> JGI IMG taxon id
        "substring(s.name from ''^[A-Za-z0-9-]+_(SAM[END][A-Z]?[0-9]+)_MAG''),"  # OMD v2
        "substring(s.name from ''^(.*)_bin\\.[0-9]+$''),"                        # TPMC
        "substring(s.name from ''^(SRR[0-9]+)bin\\.[0-9]+$''),"                  # SMAG
        "s.id::text) AS parent_key FROM samples s')"),
}


def build(args: argparse.Namespace) -> None:
    import duckdb

    workdir = Path(args.workdir).resolve()
    workdir.mkdir(parents=True, exist_ok=True)
    tmpdir = Path(args.temp_dir).resolve() if args.temp_dir else (workdir / "duckdb_tmp")
    tmpdir.mkdir(parents=True, exist_ok=True)

    pg_url = read_database_url(Path(args.env).resolve())

    if args.duckdb_file and args.duckdb_file != ":memory:":
        dbpath = Path(args.duckdb_file).resolve()
        if dbpath.exists() and args.fresh:
            dbpath.unlink()
        con = duckdb.connect(str(dbpath))
    else:
        con = duckdb.connect()  # in-memory; hot data in RAM, spills to temp_directory
    con.execute(f"SET threads TO {args.threads};")
    con.execute(f"SET memory_limit = '{args.memory_limit}';")
    con.execute(f"SET temp_directory = '{tmpdir}';")
    con.execute("SET preserve_insertion_order = false;")  # less memory on large ops
    log(f"duckdb: threads={args.threads} memory_limit={args.memory_limit} temp_dir={tmpdir}")

    log("installing/loading the postgres extension")
    con.execute("INSTALL postgres;")
    con.execute("LOAD postgres;")

    log("attaching live Postgres READ-ONLY")
    _attach_pg(con, pg_url)

    for name, sql in PULL.items():
        t0 = time.time()
        stmt = sql if "postgres_query(" in sql else sql.replace("FROM ", "FROM pg.", 1)
        con.execute(f"CREATE OR REPLACE TABLE {name} AS {stmt};")
        n = con.execute(f"SELECT count(*) FROM {name}").fetchone()[0]
        log(f"  pulled {name}: {n:,} rows in {time.time()-t0:,.1f}s")

    con.execute("DETACH pg;")
    log("detached Postgres -- the database is untouched for the rest of the run")

    con.execute("""
        CREATE OR REPLACE TABLE study_key_map AS
        SELECT id AS study_id,
               COALESCE(NULLIF(study_name,''), accession, CAST(id AS VARCHAR)) AS study_key
        FROM studies;

        CREATE OR REPLACE TABLE study_rep AS
        SELECT study_key,
               id AS study_id, title, study_name, center_name,
               accession, bioproject, study_type
        FROM (
            SELECT s.*,
                   COALESCE(NULLIF(study_name,''), accession, CAST(id AS VARCHAR)) AS study_key,
                   row_number() OVER (
                       PARTITION BY COALESCE(NULLIF(study_name,''), accession, CAST(id AS VARCHAR))
                       ORDER BY (accession IS NOT NULL) DESC, id
                   ) AS rn
            FROM studies s
        ) WHERE rn = 1;
    """)
    n_logical = con.execute("SELECT count(*) FROM study_rep").fetchone()[0]
    log(f"logical studies (study_name-collapsed): {n_logical:,}")

    log("building assembly->study and bgc x study (heavy join, local)")
    con.execute("""
        CREATE OR REPLACE TABLE assembly_study AS
        SELECT DISTINCT sa.assembly_id, km.study_key
        FROM sample_assemblies sa
        JOIN study_samples ss ON ss.sample_id = sa.sample_id
        JOIN study_key_map  km ON km.study_id = ss.study_id;

        -- one row per (logical study, bgc); a bgc shared by 2 studies counts in both
        CREATE OR REPLACE TABLE study_bgc AS
        SELECT asy.study_key, b.assembly, b.gcf_id, b.is_complete, b.product_type, b.product_category
        FROM bgcs b
        JOIN assembly_study asy ON asy.assembly_id = b.assembly;
    """)
    n_sb = con.execute("SELECT count(*) FROM study_bgc").fetchone()[0]
    log(f"  study_bgc rows (bgc x study): {n_sb:,}")

    con.execute("""
        CREATE OR REPLACE TABLE gcf_study_count AS
        SELECT gcf_id, CAST(COUNT(DISTINCT study_key) AS INTEGER) AS study_count
        FROM study_bgc
        WHERE gcf_id IS NOT NULL
        GROUP BY gcf_id;
    """)
    # Full (study, GCF) relation, built while study_bgc is in memory. is_exclusive
    # is denormalised so requests never join against gcf_study_count.
    con.execute("""
        CREATE OR REPLACE TABLE study_gcf AS
        SELECT sb.study_key,
               sb.gcf_id,
               CAST(COUNT(*) AS INTEGER) AS bgcs_in_study,
               CAST(MAX(CASE WHEN gsc.study_count = 1 THEN 1 ELSE 0 END) AS BOOLEAN) AS is_exclusive
        FROM study_bgc sb
        JOIN gcf_study_count gsc ON gsc.gcf_id = sb.gcf_id
        WHERE sb.gcf_id IS NOT NULL
        GROUP BY sb.study_key, sb.gcf_id;
    """)
    n_pairs = con.execute("SELECT count(*) FROM study_gcf").fetchone()[0]
    n_excl_pairs = con.execute("SELECT count(*) FROM study_gcf WHERE is_exclusive").fetchone()[0]
    log(f"  study_gcf: {n_pairs:,} (study, GCF) pairs, {n_excl_pairs:,} exclusive")

    n_gcf = con.execute("SELECT count(*) FROM gcf_study_count").fetchone()[0]
    n_excl = con.execute("SELECT count(*) FROM gcf_study_count WHERE study_count = 1").fetchone()[0]
    log(f"  gcf_study_count: {n_gcf:,} GCFs, {n_excl:,} study-exclusive")

    log("computing per-study metrics")
    con.execute(f"""
        CREATE OR REPLACE TABLE study_base AS
        SELECT sb.study_key,
               CAST(COUNT(*) AS BIGINT) AS total_bgcs,
               CAST(COUNT(*) FILTER (WHERE sb.gcf_id IS NOT NULL) AS BIGINT) AS clustered_bgcs,
               CAST(COUNT(DISTINCT sb.gcf_id) AS BIGINT) AS distinct_gcfs,
               CAST(COUNT(DISTINCT sb.gcf_id) FILTER (WHERE gsc.study_count = 1) AS BIGINT) AS exclusive_gcfs,
               CAST(COUNT(DISTINCT sb.gcf_id) FILTER (WHERE gsc.study_count <= {args.rare_max}) AS BIGINT) AS rare_gcfs,
               ROUND(100.0 * COUNT(*) FILTER (WHERE sb.is_complete) / NULLIF(COUNT(*),0), 1) AS pct_complete,
               CAST(COUNT(*) FILTER (WHERE sb.is_complete) AS BIGINT) AS complete_bgcs
        FROM study_bgc sb
        LEFT JOIN gcf_study_count gsc ON gsc.gcf_id = sb.gcf_id
        GROUP BY sb.study_key;

        CREATE OR REPLACE TABLE study_ptype AS
        SELECT study_key, CAST(COUNT(DISTINCT pt) AS INTEGER) AS product_type_count
        FROM study_bgc, UNNEST(product_type) AS u(pt)
        GROUP BY study_key;

        -- product_category distribution -> JSON object of category -> bgc_count
        CREATE OR REPLACE TABLE study_pcat AS
        SELECT study_key, CAST(to_json(map(list(category), list(cnt))) AS VARCHAR) AS product_category_dist
        FROM (
            SELECT study_key, pc AS category, COUNT(*) AS cnt
            FROM study_bgc, UNNEST(product_category) AS u(pc)
            GROUP BY study_key, pc
        ) GROUP BY study_key;

        -- top-N exclusive GCFs per study, for the detail page (precomputed, no live join)
        CREATE OR REPLACE TABLE excl_per_study AS
        SELECT sb.study_key, sb.gcf_id, COUNT(*) AS bgcs_in_study
        FROM study_bgc sb
        JOIN gcf_study_count gsc ON gsc.gcf_id = sb.gcf_id AND gsc.study_count = 1
        WHERE sb.gcf_id IS NOT NULL
        GROUP BY sb.study_key, sb.gcf_id;

        CREATE OR REPLACE TABLE study_topexcl AS
        SELECT study_key,
               CAST(to_json(list({{'gcf_id': CAST(gcf_id AS VARCHAR),
                                    'bgcs_in_study': bgcs_in_study}}
                                  ORDER BY bgcs_in_study DESC)
                            FILTER (WHERE rn <= {args.top_n})) AS VARCHAR) AS top_exclusive_gcfs
        FROM (
            SELECT study_key, gcf_id, bgcs_in_study,
                   row_number() OVER (PARTITION BY study_key ORDER BY bgcs_in_study DESC) AS rn
            FROM excl_per_study
        )
        GROUP BY study_key;

        -- Counted on the physical sample (see sample_parent), not samples rows.
        CREATE OR REPLACE TABLE study_samplecount AS
        SELECT km.study_key, CAST(COUNT(DISTINCT sp.parent_key) AS INTEGER) AS sample_count
        FROM study_samples ss
        JOIN study_key_map km ON km.study_id = ss.study_id
        JOIN sample_parent sp ON sp.id = ss.sample_id
        GROUP BY km.study_key;

        -- genomes = MAG / SAG / isolate assemblies; metagenome assemblies are not
        -- genomes. Counted over every linked assembly, BGCs or not.
        CREATE OR REPLACE TABLE study_genomes AS
        SELECT asy.study_key, CAST(COUNT(DISTINCT asy.assembly_id) AS INTEGER) AS genome_count
        FROM assembly_study asy
        JOIN assemblies a ON a.id = asy.assembly_id
        WHERE a.source_type IN ('MAG', 'SAG', 'isolate')
        GROUP BY asy.study_key;

        -- BGCs per assembly source_type -> JSON object source_type -> bgc_count. One
        -- assembly per BGC, so the counts sum to total_bgcs.
        CREATE OR REPLACE TABLE study_srctype AS
        SELECT study_key, CAST(to_json(map(list(source_type), list(cnt))) AS VARCHAR) AS source_type_dist
        FROM (
            SELECT sb.study_key, a.source_type, COUNT(*) AS cnt
            FROM study_bgc sb
            JOIN assemblies a ON a.id = sb.assembly
            GROUP BY sb.study_key, a.source_type
        ) GROUP BY study_key;

        -- data sources of the study's samples -> sorted JSON array of raw names
        CREATE OR REPLACE TABLE study_ds AS
        SELECT km.study_key,
               CAST(to_json(list(DISTINCT ds.name ORDER BY ds.name)) AS VARCHAR) AS data_sources
        FROM (
            SELECT ss.study_id, UNNEST(sd.data_source_ids) AS dsid
            FROM study_samples ss
            JOIN sample_ds sd ON sd.id = ss.sample_id
        ) u
        JOIN study_key_map km ON km.study_id = u.study_id
        JOIN data_sources ds ON ds.id = u.dsid
        GROUP BY km.study_key;

        -- biome rollup (modal primary_biome + top-level GOLD) for the index chip/filter
        CREATE OR REPLACE TABLE study_biome AS
        SELECT study_key,
               mode(primary_biome) AS primary_biome,
               mode(gold_bucket)   AS gold_bucket
        FROM (
            SELECT km.study_key, ssum.primary_biome,
                   NULLIF(split_part(ssum.gold_ecosystem_path, ':', 1), '') AS gold_bucket
            FROM study_samples ssj
            JOIN study_key_map km ON km.study_id = ssj.study_id
            JOIN ss_slice ssum   ON ssum.id = ssj.sample_id
        ) GROUP BY study_key;
    """)

    con.execute("""
        CREATE OR REPLACE TABLE study_bgc_summary AS
        SELECT
            study_key,
            sr.study_id,
            sr.title, sr.study_name, sr.center_name, sr.accession, sr.bioproject, sr.study_type,
            COALESCE(sc.sample_count, 0)                                   AS sample_count,
            COALESCE(base.total_bgcs, 0)                                   AS total_bgcs,
            COALESCE(base.clustered_bgcs, 0)                               AS clustered_bgcs,
            CAST(ROUND(base.clustered_bgcs::DOUBLE / NULLIF(base.total_bgcs, 0), 4) AS REAL) AS gcf_coverage,
            COALESCE(base.distinct_gcfs, 0)                                AS distinct_gcfs,
            COALESCE(base.exclusive_gcfs, 0)                               AS exclusive_gcfs,
            COALESCE(base.rare_gcfs, 0)                                    AS rare_gcfs,
            CAST(base.pct_complete AS REAL)                                AS pct_complete,
            COALESCE(pt.product_type_count, 0)                            AS product_type_count,
            pc.product_category_dist,
            te.top_exclusive_gcfs,
            bm.primary_biome,
            bm.gold_bucket,
            -- appended last: load.sql is positional
            COALESCE(base.complete_bgcs, 0)                                AS complete_bgcs,
            COALESCE(sg.genome_count, 0)                                   AS genome_count,
            st.source_type_dist,
            sd.data_sources
        FROM study_rep sr
        LEFT JOIN study_base        base USING (study_key)
        LEFT JOIN study_samplecount sc   USING (study_key)
        LEFT JOIN study_ptype       pt   USING (study_key)
        LEFT JOIN study_pcat        pc   USING (study_key)
        LEFT JOIN study_topexcl     te   USING (study_key)
        LEFT JOIN study_biome       bm   USING (study_key)
        LEFT JOIN study_genomes     sg   USING (study_key)
        LEFT JOIN study_srctype     st   USING (study_key)
        LEFT JOIN study_ds          sd   USING (study_key);
    """)

    out_summary = workdir / "study_bgc_summary.csv"
    out_gcf = workdir / "gcf_study_count.csv"
    out_study_gcf = workdir / "study_gcf.csv"
    con.execute(f"COPY (SELECT * FROM study_bgc_summary) TO '{out_summary}' (HEADER, FORMAT CSV);")
    con.execute(f"COPY (SELECT * FROM gcf_study_count) TO '{out_gcf}' (HEADER, FORMAT CSV);")
    con.execute(f"COPY (SELECT * FROM study_gcf) TO '{out_study_gcf}' (HEADER, FORMAT CSV);")
    log(f"wrote {out_summary}")
    log(f"wrote {out_study_gcf}")
    log(f"wrote {out_gcf}")

    _sanity(con)
    con.close()
    log("done. Next: review sanity output, then run load.sql to load into bgc_atlas_v2.")


def _sanity(con) -> None:
    print("\n================= SANITY =================")
    total, with_bgcs, with_excl = con.execute("""
        SELECT count(*),
               count(*) FILTER (WHERE total_bgcs > 0),
               count(*) FILTER (WHERE exclusive_gcfs > 0)
        FROM study_bgc_summary
    """).fetchone()
    print(f"logical studies: {total:,}  | with >0 BGCs: {with_bgcs:,}  | with >0 exclusive GCFs: {with_excl:,}")

    # A ratio drifting back toward 1.0 means a source's naming stopped matching
    # sample_parent.
    rows, parents = con.execute("""
        SELECT COUNT(DISTINCT ss.sample_id), COUNT(DISTINCT sp.parent_key)
        FROM study_samples ss JOIN sample_parent sp ON sp.id = ss.sample_id
    """).fetchone()
    print(f"sample rows in studies: {rows:,} -> physical samples: {parents:,} "
          f"({rows / parents:.2f}x MAG-bin collapse)")

    print("\nGCF-coverage distribution (studies with >0 BGCs):")
    for lo, hi, c in con.execute("""
        SELECT b.lo, b.hi, count(*) FROM (
            SELECT CASE WHEN gcf_coverage IS NULL THEN 0 ELSE floor(gcf_coverage*5)/5 END AS lo,
                   CASE WHEN gcf_coverage IS NULL THEN 0 ELSE floor(gcf_coverage*5)/5 + 0.2 END AS hi
            FROM study_bgc_summary WHERE total_bgcs > 0
        ) b GROUP BY b.lo, b.hi ORDER BY b.lo
    """).fetchall():
        print(f"  coverage {lo:.1f}-{hi:.1f}: {c:,}")

    print("\nTop 15 studies by exclusive GCFs (do these look biologically credible?):")
    rows = con.execute("""
        SELECT left(COALESCE(title, study_name), 46) AS name, center_name,
               exclusive_gcfs, distinct_gcfs, total_bgcs, gcf_coverage, sample_count
        FROM study_bgc_summary ORDER BY exclusive_gcfs DESC LIMIT 15
    """).fetchall()
    print(f"  {'study':46}  {'excl':>6} {'dist':>6} {'bgcs':>8} {'cov':>5} {'samp':>6}")
    for name, center, excl, dist, bgcs, cov, samp in rows:
        print(f"  {name:46}  {excl:>6} {dist:>6} {bgcs:>8} {(cov or 0):>5.2f} {samp:>6}")
    print("==========================================\n")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    here = Path(__file__).resolve().parent
    ap.add_argument("--env", default=str(here / "../../../../bgc-atlas/.env"),
                    help="dotenv with DATABASE_URL (default: repo bgc-atlas/.env)")
    ap.add_argument("--workdir", default=str(here / "_work"), help="scratch + CSV output dir (put on a roomy fs)")
    ap.add_argument("--duckdb-file", default=":memory:", help="DuckDB db file, or :memory: (default)")
    ap.add_argument("--temp-dir", default=None, help="DuckDB spill dir (default <workdir>/duckdb_tmp); put on a roomy fs")
    ap.add_argument("--threads", type=int, default=3, help="DuckDB threads = Postgres connections during pull (lower = gentler)")
    ap.add_argument("--memory-limit", default="8GB")
    ap.add_argument("--rare-max", type=int, default=3, help="GCF is 'rare' if it occurs in <= this many studies")
    ap.add_argument("--top-n", type=int, default=20, help="exclusive GCFs stored per study for the detail page")
    ap.add_argument("--fresh", action="store_true", help="delete any existing DuckDB work file first")
    build(ap.parse_args())


if __name__ == "__main__":
    main()
