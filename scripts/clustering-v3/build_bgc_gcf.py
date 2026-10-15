#!/usr/bin/env python3
"""Build the `bgc_gcf` membership load table from the clustering-v3 master.

One row per (bgc_id, gcf_id) pair; for the first v3 build, 19,254,436 rows of which
14,606,494 are primary.

    route         rows        rank      distance source
    ------------- ----------- --------- ---------------------------------------------
    seed            3,238,559 0         main data.db gcf_membership.membership_value
    contained      11,207,735 0..n      1 - identity/100, containment_identity_v3
    orphan_query    1,569,829 0         orphan_assignments.distance
    residual        3,238,313 0         per residual_route (see below)

Rank order comes from `gcf_04_all` (best bitscore first), never from identity.
`is_primary = (rank = 0)`, guarded by a partial unique index on (bgc_id) WHERE is_primary.

data.db bgc uuids are the dedup/95 representative bgc_ids, not `final_cluster_id` (they
agree for only ~76% of clusters): resolve bgc_id -> final_cluster_id -> rep_bgc_id -> name.

Usage:
  $PY scripts/clustering-v3/build_bgc_gcf.py --out $CLUSTERING_BUILD/out/bgc_gcf.csv
"""
from __future__ import annotations

import argparse
import gc
import sys
import time
from pathlib import Path

import duckdb
import pyarrow.parquet as pq

sys.path.insert(0, str(Path(__file__).resolve().parent))
import bundle_config as cfg  # noqa: E402

V3 = cfg.SRC
BUILD = cfg.BUILD
TMP = cfg.TMP


def rank_rows(bgc_id: str, gcf_ids: list[int]) -> list[tuple[str, int, int, bool]]:
    """Reference ranking; `--check-ranking` asserts the DuckDB unnest agrees with it."""
    return [(bgc_id, gcf, i, i == 0) for i, gcf in enumerate(gcf_ids)]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    ap.add_argument("--check-ranking", type=int, default=2000,
                    help="sample size for the SQL-vs-rank_rows agreement check")
    args = ap.parse_args()
    t0 = time.time()

    def log(msg: str) -> None:
        print(f"[{time.time()-t0:7.1f}s] {msg}", flush=True)

    # File-backed on CephFS, not in-memory: in-memory intermediates pushed RSS high enough
    # to risk OOM-killing the live Postgres on this box.
    db_path = f"{BUILD}/tmp/build_bgc_gcf.duckdb"
    Path(db_path).parent.mkdir(parents=True, exist_ok=True)
    if Path(db_path).exists():
        Path(db_path).unlink()
    con = duckdb.connect(db_path)
    con.execute("SET memory_limit='4GB'")
    con.execute(f"SET temp_directory='{TMP}'")
    con.execute("SET preserve_insertion_order=false")

    def load(name: str, path: str, columns=None) -> None:
        """Materialise and unregister: a registered Arrow table stays pinned in memory."""
        tbl = pq.read_table(path, columns=columns)
        con.register(f"_{name}", tbl)
        con.execute(f"CREATE TABLE {name} AS SELECT * FROM _{name}")
        con.unregister(f"_{name}")
        del tbl
        gc.collect()
        log(f"loaded {name}: {con.execute(f'SELECT count(*) FROM {name}').fetchone()[0]:,}")

    # pyarrow, since duckdb's parquet reader hangs on CephFS.
    load("m", cfg.master_path(), ["bgc_id", "route", "gcf_04", "gcf_04_all", "final_cluster_id",
                       "residual_gcf_04", "residual_route"])
    load("dedup_reps", f"{V3}/dedup-v3/95/representatives.parquet",
         ["rep_bgc_id", "final_cluster_id"])
    load("ident", f"{BUILD}/in/containment_identity_v3.parquet")
    # Some bundles name the orphan distance `best_distance` (same value: the distance to the
    # nearest main GCF @0.4); read whichever the bundle has, as `distance`.
    orph_path = f"{V3}/orphan-v3/orphan_assignments.parquet"
    dist_col = "distance" if "distance" in pq.read_schema(orph_path).names else "best_distance"
    load("orph", orph_path, ["bgc_id", "gcf_id", dist_col, "assigned"])
    if dist_col != "distance":
        con.execute(f"ALTER TABLE orph RENAME COLUMN {dist_col} TO distance")
    load("res_memb", f"{V3}/residual-v3/95/cluster_membership.parquet",
         ["bgc_id", "final_cluster_id"])
    load("res_reps", f"{V3}/residual-v3/95/representatives.parquet",
         ["rep_bgc_id", "final_cluster_id"])
    load("rescont", f"{V3}/residcont-v3/residcont_assignments.parquet",
         ["bgc_id", "identity", "is_assigned"])
    load("resq", f"{V3}/residcont-v3/orphan/residq_assignments.parquet",
         ["bgc_id", "best_distance", "assigned"])
    log("all inputs materialised on disk")

    # extract_data_db.sh dumps `bgc` and `gcf_membership` separately (joining inside SQLite
    # on CephFS takes ~7 h of random seeks); join them here.
    for memb, bgc, out in (("main_membership", "main_bgc", "main_memb"),
                           ("residual_membership", "residual_bgc", "res_gm")):
        con.execute(f"""
            CREATE TABLE {out} AS
            SELECT regexp_replace(regexp_replace(b.name, '^genomes/', ''),
                                  '\\.region\\d+$', '') AS rep_bgc_id,
                   m.gcf_id, m.membership_value
            FROM read_csv('{BUILD}/in/{memb}.tsv', delim='\t', header=false,
                          columns={{'bgc_id':'BIGINT','gcf_id':'BIGINT',
                                    'membership_value':'DOUBLE'}}) m
            JOIN read_csv('{BUILD}/in/{bgc}.tsv', delim='\t', header=false,
                          columns={{'id':'BIGINT','name':'VARCHAR'}}) b ON b.id = m.bgc_id
        """)
        n = con.execute(f"SELECT count(*) FROM {out}").fetchone()[0]
        log(f"loaded {out}: {n:,} rows")

    con.execute("""CREATE TABLE cw AS SELECT * FROM read_csv(
        '""" + f"{BUILD}/out/gcf_crosswalk.csv" + """', header=true,
        columns={'family_class':'VARCHAR','int_id':'BIGINT','gcf_id':'VARCHAR'})""")

    # DuckDB zips two unnests in one projection positionally, so range() gives the index.
    con.execute("""
        CREATE TABLE main_pairs AS
        SELECT bgc_id, route, final_cluster_id,
               unnest(gcf_04_all) AS int_id,
               unnest(range(0, len(gcf_04_all))) AS rank
        FROM m WHERE gcf_04_all IS NOT NULL
    """)
    log(f"main pairs: {con.execute('SELECT count(*) FROM main_pairs').fetchone()[0]:,}")

    # Must run while main_pairs still exists.
    ranking_mismatched = None
    if args.check_ranking:
        # One join, not a query per BGC: main_pairs has no index on bgc_id.
        # USING SAMPLE takes only a literal, so the (int) count is interpolated.
        con.execute("DROP TABLE IF EXISTS rank_sample")
        # Sample the filtered subquery: DuckDB applies USING SAMPLE before the WHERE.
        con.execute(
            "CREATE TABLE rank_sample AS SELECT * FROM ("
            "  SELECT bgc_id, gcf_04_all FROM m "
            "  WHERE gcf_04_all IS NOT NULL AND len(gcf_04_all) > 1"
            f") USING SAMPLE {int(args.check_ranking)} ROWS")
        expected = {b: rank_rows(b, list(g))
                    for b, g in con.execute(
                        "SELECT bgc_id, gcf_04_all FROM rank_sample").fetchall()}
        actual: dict[str, list] = {}
        for row in con.execute(
                "SELECT p.bgc_id, p.int_id, p.rank, (p.rank = 0) FROM main_pairs p "
                "JOIN rank_sample s ON s.bgc_id = p.bgc_id "
                "ORDER BY p.bgc_id, p.rank").fetchall():
            actual.setdefault(row[0], []).append(tuple(row))
        ranking_mismatched = sum(1 for b, exp in expected.items()
                                 if actual.get(b) != exp)
        con.execute("DROP TABLE rank_sample")
        log(f"ranking check: {ranking_mismatched} mismatches in {len(expected)} BGCs")

    # One join per route rather than four LEFT JOINs at once, so each hash table sees only
    # its route's rows and sources can be dropped as soon as they are consumed.
    con.execute("""
        CREATE TABLE main_rows AS
        SELECT p.bgc_id, p.int_id, p.rank, p.route, 1.0 - i.identity / 100.0 AS distance
        FROM main_pairs p JOIN ident i ON i.bgc_id = p.bgc_id AND i.gcf_04 = p.int_id
        WHERE p.route = 'contained'
    """)
    con.execute("DROP TABLE ident")
    log(f"  contained: {con.execute('SELECT count(*) FROM main_rows').fetchone()[0]:,}")

    con.execute("""
        INSERT INTO main_rows
        SELECT p.bgc_id, p.int_id, p.rank, p.route, sm.membership_value
        FROM main_pairs p
        JOIN dedup_reps dr ON dr.final_cluster_id = p.final_cluster_id
        JOIN main_memb sm ON sm.rep_bgc_id = dr.rep_bgc_id AND sm.gcf_id = p.int_id
        WHERE p.route = 'seed'
    """)
    con.execute("DROP TABLE dedup_reps")
    log("  seed joined")

    con.execute("""
        INSERT INTO main_rows
        SELECT p.bgc_id, p.int_id, p.rank, p.route, o.distance
        FROM main_pairs p
        JOIN orph o ON o.bgc_id = p.bgc_id AND o.gcf_id = p.int_id AND o.assigned
        WHERE p.route = 'orphan_query'
    """)
    con.execute("DROP TABLE orph")
    con.execute("DROP TABLE main_pairs")
    log(f"main rows joined: {con.execute('SELECT count(*) FROM main_rows').fetchone()[0]:,}")

    # Residual: one primary row per BGC. Narrow to BGCs with a residual family first, then
    # one INSERT per residual_route; the combined LEFT JOIN form never finished.
    con.execute("""
        CREATE TABLE res_base AS
        SELECT bgc_id, residual_gcf_04 AS int_id, residual_route
        FROM m WHERE residual_gcf_04 IS NOT NULL
    """)
    con.execute("DROP TABLE m")
    log(f"residual base: {con.execute('SELECT count(*) FROM res_base').fetchone()[0]:,}")

    con.execute("""
        CREATE TABLE res_rows AS
        SELECT b.bgc_id, b.int_id, 0 AS rank, 'residual' AS route,
               rm.membership_value AS distance
        FROM res_base b
        JOIN res_memb cm ON cm.bgc_id = b.bgc_id
        JOIN res_reps rr ON rr.final_cluster_id = cm.final_cluster_id
        JOIN res_gm   rm ON rm.rep_bgc_id = rr.rep_bgc_id AND rm.gcf_id = b.int_id
        WHERE b.residual_route = 'residual_seed'
    """)
    for t in ("res_memb", "res_reps", "res_gm"):
        con.execute(f"DROP TABLE {t}")
    log(f"  residual_seed: {con.execute('SELECT count(*) FROM res_rows').fetchone()[0]:,}")

    con.execute("""
        INSERT INTO res_rows
        SELECT b.bgc_id, b.int_id, 0, 'residual', 1.0 - rc.identity / 100.0
        FROM res_base b
        JOIN rescont rc ON rc.bgc_id = b.bgc_id AND rc.is_assigned
        WHERE b.residual_route = 'residual_contained'
    """)
    con.execute("DROP TABLE rescont")
    log("  residual_contained joined")

    con.execute("""
        INSERT INTO res_rows
        SELECT b.bgc_id, b.int_id, 0, 'residual', rq.best_distance
        FROM res_base b
        JOIN resq rq ON rq.bgc_id = b.bgc_id AND rq.assigned
        WHERE b.residual_route = 'residual_orphan'
    """)
    con.execute("DROP TABLE resq")
    con.execute("DROP TABLE res_base")
    log(f"residual rows joined: {con.execute('SELECT count(*) FROM res_rows').fetchone()[0]:,}")

    con.execute("""
        CREATE TABLE final AS
        SELECT r.bgc_id, cw.gcf_id, r.distance, (r.rank = 0) AS is_primary, r.rank, r.route
        FROM (SELECT bgc_id, int_id, rank, route, distance, 'seed' AS fc FROM main_rows
              UNION ALL
              SELECT bgc_id, int_id, rank, route, distance, 'fragmented' FROM res_rows) r
        JOIN cw ON cw.int_id = r.int_id AND cw.family_class = r.fc
    """)
    log("crosswalked to uuids")

    ok = True

    exp = cfg.expect()

    def check(label: str, got: int, want: int | None) -> None:
        nonlocal ok
        if want is None:
            print(f"    {label:<26s} {got:>12,d}   (no independent expectation)")
            return
        flag = "" if got == want else f"   <-- FAIL, expected {want:,}"
        if got != want:
            ok = False
        print(f"    {label:<26s} {got:>12,d}{flag}")

    total = con.execute("SELECT count(*) FROM final").fetchone()[0]
    primary = con.execute("SELECT count(*) FROM final WHERE is_primary").fetchone()[0]
    print("\ncounts:")
    check("total", total, exp.get("bgc_gcf_total"))
    check("primary", primary, exp.get("bgc_gcf_primary"))
    check("secondary", total - primary, exp.get("bgc_gcf_secondary"))
    for route, want in exp.get("bgc_gcf_by_route", {}).items():
        check(f"route {route}", con.execute(
            "SELECT count(*) FROM final WHERE route = ?", [route]).fetchone()[0], want)

    print("\ninvariants:")
    check("distinct bgc_id", con.execute(
        "SELECT count(DISTINCT bgc_id) FROM final").fetchone()[0], primary)
    # Every family in gcfs owns at least one membership row (that is how build_gcfs found it).
    check("distinct gcf_id", con.execute(
        "SELECT count(DISTINCT gcf_id) FROM final").fetchone()[0],
        con.execute("SELECT count(*) FROM cw").fetchone()[0])
    check("null distance", con.execute(
        "SELECT count(*) FROM final WHERE distance IS NULL").fetchone()[0], 0)
    check("dup (bgc, gcf)", con.execute(
        "SELECT count(*) FROM (SELECT bgc_id, gcf_id FROM final "
        "GROUP BY 1,2 HAVING count(*) > 1)").fetchone()[0], 0)
    check("bgcs with != 1 primary", con.execute(
        "SELECT count(*) FROM (SELECT bgc_id FROM final WHERE is_primary "
        "GROUP BY 1 HAVING count(*) <> 1)").fetchone()[0], 0)
    check("negative distance", con.execute(
        "SELECT count(*) FROM final WHERE distance < 0").fetchone()[0], 0)

    lo, hi = con.execute("SELECT min(distance), max(distance) FROM final").fetchone()
    print(f"    {'distance range':<26s} {lo:.4f} .. {hi:.4f}")
    if ranking_mismatched is not None:
        check("SQL ranking mismatches", ranking_mismatched, 0)

    Path(args.out).parent.mkdir(parents=True, exist_ok=True)
    con.execute(f"""COPY (SELECT bgc_id, gcf_id, distance, is_primary, rank
                          FROM final) TO '{args.out}' (HEADER, DELIMITER ',')""")
    log(f"wrote {args.out}")

    print("\nALL CHECKS PASSED" if ok else "\nCHECKS FAILED")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
