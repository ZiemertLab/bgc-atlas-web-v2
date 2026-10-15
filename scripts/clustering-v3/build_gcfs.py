#!/usr/bin/env python3
"""Build the `gcfs` load table from the clustering-v3 master.

One row per family across both tiers:

  seed        every distinct GCF appearing anywhere in `gcf_04_all`   ->  371,251
  fragmented  every distinct `residual_gcf_04`                        ->  393,069
                                                                     total 764,320

Seed uses `gcf_04_all`, not `gcf_04`: 34 secondary-only families own bgc_gcf rows and need
a gcfs row for the FK (n_bgc = 0, unlisted). `n_bgc` counts primary members only.

Usage:
  $PY scripts/clustering-v3/build_gcfs.py --out $CLUSTERING_BUILD/out/gcfs.csv
"""
from __future__ import annotations

import argparse
import csv
import sys
import time
import uuid
from pathlib import Path

import duckdb
import pyarrow.parquet as pq

sys.path.insert(0, str(Path(__file__).resolve().parent))
import bundle_config as cfg  # noqa: E402
from gcf_pet_name import gcf_name, pet_name_for_gcf_name  # noqa: E402

CLUSTER_METHOD = "bigslice-2.0-birch"


def gcf_uuid(name: str) -> str:
    """id = uuid5(name); renaming families without re-keying breaks this."""
    return str(uuid.uuid5(uuid.NAMESPACE_URL, name))


def is_listed(family_class: str, n_bgc: int) -> bool:
    """Fragmented singletons keep their membership but get no page; seed singletons are listed."""
    if n_bgc < 1:
        return False
    if family_class == "fragmented":
        return n_bgc >= 2
    return True


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    ap.add_argument("--crosswalk", help="(family_class, int_id) -> gcf uuid, for build_bgc_gcf.py")
    args = ap.parse_args()
    t0 = time.time()

    # pyarrow, not duckdb read_parquet, which hangs on CephFS.
    master = pq.read_table(cfg.master_path(), columns=[
        "bgc_id", "gcf_04", "gcf_04_all", "residual_gcf_04", "primary_category"])
    print(f"[{time.time()-t0:6.1f}s] master: {master.num_rows:,} rows", flush=True)

    con = duckdb.connect()
    con.execute("SET memory_limit='6GB'")
    con.execute(f"SET temp_directory='{cfg.TMP}'")
    con.register("m", master)

    con.execute("""
        CREATE TABLE fam AS
        WITH all_seed AS (
            SELECT DISTINCT unnest(gcf_04_all) AS int_id
            FROM m WHERE gcf_04_all IS NOT NULL
        ),
        seed_primary AS (
            SELECT gcf_04 AS int_id, count(*) AS n_bgc,
                   mode(primary_category) AS dom_category
            FROM m WHERE gcf_04 IS NOT NULL GROUP BY 1
        ),
        seed AS (
            SELECT 'seed' AS family_class, a.int_id,
                   coalesce(p.n_bgc, 0) AS n_bgc, p.dom_category
            FROM all_seed a LEFT JOIN seed_primary p USING (int_id)
        ),
        frag AS (
            SELECT 'fragmented' AS family_class, residual_gcf_04 AS int_id,
                   count(*) AS n_bgc, mode(primary_category) AS dom_category
            FROM m WHERE residual_gcf_04 IS NOT NULL GROUP BY 1, 2
        )
        SELECT * FROM seed UNION ALL SELECT * FROM frag
    """)

    n_seed, n_frag = con.execute(
        "SELECT sum(family_class='seed')::BIGINT, sum(family_class='fragmented')::BIGINT "
        "FROM fam").fetchone()
    print(f"[{time.time()-t0:6.1f}s] seed families:       {n_seed:,}")
    print(f"[{time.time()-t0:6.1f}s] fragmented families: {n_frag:,}")
    print(f"[{time.time()-t0:6.1f}s] total:               {n_seed + n_frag:,}")

    rows = con.execute(
        "SELECT family_class, int_id, n_bgc, dom_category FROM fam "
        "ORDER BY family_class, int_id").fetchall()

    n_listed = 0
    seen_name: set[str] = set()
    seen_pet: set[str] = set()
    crosswalk: list[tuple[str, int, str]] = []
    Path(args.out).parent.mkdir(parents=True, exist_ok=True)
    with open(args.out, "w", newline="") as fh:
        w = csv.writer(fh)
        w.writerow(["id", "name", "pet_name", "family_class", "listed", "n_bgc",
                    "dom_category", "cluster_method"])
        for family_class, int_id, n_bgc, dom_category in rows:
            name = gcf_name(family_class, int_id, cfg.TAG)
            pet = pet_name_for_gcf_name(name)
            if pet is None:
                raise RuntimeError(f"pet name failed to parse its own name: {name!r}")
            # Both are UNIQUE in the schema; fail here rather than after the COPY.
            if name in seen_name:
                raise RuntimeError(f"duplicate gcf name: {name!r}")
            if pet in seen_pet:
                raise RuntimeError(f"duplicate pet_name {pet!r} at {name!r}")
            seen_name.add(name)
            seen_pet.add(pet)
            listed = is_listed(family_class, n_bgc)
            n_listed += listed
            uid = gcf_uuid(name)
            w.writerow([uid, name, pet, family_class,
                        "t" if listed else "f", n_bgc, dom_category or "", CLUSTER_METHOD])
            crosswalk.append((family_class, int_id, uid))

    print(f"[{time.time()-t0:6.1f}s] listed:              {n_listed:,}")
    print(f"[{time.time()-t0:6.1f}s] wrote {args.out}")

    if args.crosswalk:
        # The raw BiG-SLiCE int is the only key the master and both data.db files share.
        with open(args.crosswalk, "w", newline="") as fh:
            w = csv.writer(fh)
            w.writerow(["family_class", "int_id", "gcf_id"])
            w.writerows(crosswalk)
        print(f"[{time.time()-t0:6.1f}s] wrote {args.crosswalk}")

    ok = True
    exp = cfg.expect()
    for label, got, want in (("seed", n_seed, exp.get("gcfs_seed")),
                             ("fragmented", n_frag, exp.get("gcfs_fragmented")),
                             ("listed", n_listed, exp.get("gcfs_listed"))):
        if want is None:
            print(f"  {label} = {got:,} (no independent expectation)")
        elif got != want:
            print(f"FAIL: {label} = {got:,}, expected {want:,}")
            ok = False
    print("\nALL COUNTS MATCH" if ok else "\nCOUNT MISMATCH")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
