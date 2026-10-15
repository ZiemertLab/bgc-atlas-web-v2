#!/usr/bin/env python3
"""Where each family of the previous clustering went: `gcf_successor` and `gcf_legacy`.

A re-clustering replaces every family (ids are not comparable between runs), so an old family's name, uuid and
page must not silently point at a new family. Instead each old family gets a page listing the new families its
members are now in, from this table:

  gcf_successor(old_gcf_id, new_gcf_id, shared_bgcs, share_of_old, share_of_new)
      one row per (old family, new family) pair sharing at least one BGC as PRIMARY member in both clusterings.
      share_of_old = shared / old family's primary members now in the corpus (removed BGCs drop out);
      share_of_new = shared / new family's primary members.

  gcf_legacy(gcf_id, name, pet_name, family_class, listed, n_bgc, clustering)
      every old family, so its name and uuid keep resolving after it leaves `gcfs`.

Inputs (CLUSTERING_BUILD):
  old/old_primary.csv  (bgc_id, gcf_id)    `bgc_gcf WHERE is_primary` exported from the live DB before cutover
  old/old_gcfs.csv     (id, name, pet_name, family_class, listed, n_bgc)
  out/bgc_gcf.csv      the new membership build (is_primary rows used)

Prints the numbers the cutover gate reviews: how much of each old family stays together.

--old-primary / --old-gcfs read another clustering's export instead, and --successor-only skips gcf_legacy.csv:
used to re-point an already retired clustering's families at the new ones, from that clustering's own
membership export.

Usage:
  CLUSTERING_BUILD=... $PY build_gcf_successor.py --clustering v3-2026-08
"""
from __future__ import annotations

import argparse
import os
import sys
import time

import duckdb

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bundle_config as cfg  # noqa: E402


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--clustering", required=True, help="label of the OLD clustering, e.g. v3-2026-08")
    ap.add_argument("--old-primary", help="default <BUILD>/old/old_primary.csv")
    ap.add_argument("--old-gcfs", help="default <BUILD>/old/old_gcfs.csv")
    ap.add_argument("--successor-only", action="store_true", help="write gcf_successor.csv only (no gcf_legacy.csv)")
    args = ap.parse_args()
    t0 = time.time()
    b = cfg.BUILD
    old_primary = args.old_primary or f"{b}/old/old_primary.csv"
    old_gcfs = args.old_gcfs or f"{b}/old/old_gcfs.csv"

    def log(msg: str) -> None:
        print(f"[{time.time() - t0:6.1f}s] {msg}", flush=True)

    con = duckdb.connect(os.path.join(cfg.TMP, "successor.duckdb"))
    con.execute(f"SET temp_directory='{cfg.TMP}'")
    con.execute(f"""CREATE OR REPLACE TABLE old_p AS SELECT * FROM read_csv('{old_primary}', header=true,
                    columns={{'bgc_id':'VARCHAR','gcf_id':'VARCHAR'}})""")
    con.execute(f"""CREATE OR REPLACE TABLE new_p AS SELECT bgc_id, gcf_id FROM read_csv('{b}/out/bgc_gcf.csv',
                    header=true, columns={{'bgc_id':'VARCHAR','gcf_id':'VARCHAR','distance':'DOUBLE',
                    'is_primary':'BOOLEAN','rank':'INTEGER'}}) WHERE is_primary""")
    con.execute(f"""CREATE OR REPLACE TABLE old_g AS SELECT * FROM read_csv('{old_gcfs}', header=true,
                    columns={{'id':'VARCHAR','name':'VARCHAR','pet_name':'VARCHAR','family_class':'VARCHAR',
                              'listed':'BOOLEAN','n_bgc':'INTEGER'}})""")
    log(f"old primary {con.execute('SELECT count(*) FROM old_p').fetchone()[0]:,}, "
        f"new primary {con.execute('SELECT count(*) FROM new_p').fetchone()[0]:,}")

    con.execute("""
        CREATE OR REPLACE TABLE succ AS
        WITH pairs AS (
            SELECT o.gcf_id AS old_gcf_id, n.gcf_id AS new_gcf_id, count(*) AS shared_bgcs
            FROM old_p o JOIN new_p n USING (bgc_id) GROUP BY 1, 2
        ),
        old_n AS (SELECT gcf_id, count(*) AS n FROM old_p GROUP BY 1),
        new_n AS (SELECT gcf_id, count(*) AS n FROM new_p GROUP BY 1)
        SELECT p.old_gcf_id, p.new_gcf_id, p.shared_bgcs,
               -- Not rounded: one BGC of a 20,000-member family rounds to 0 at 4 decimals, and the table
               -- requires every share > 0.
               p.shared_bgcs / o.n AS share_of_old,
               p.shared_bgcs / nn.n AS share_of_new
        FROM pairs p JOIN old_n o ON o.gcf_id = p.old_gcf_id JOIN new_n nn ON nn.gcf_id = p.new_gcf_id
        ORDER BY p.old_gcf_id, p.shared_bgcs DESC, p.new_gcf_id
    """)
    con.execute(f"COPY succ TO '{b}/out/gcf_successor.csv' (HEADER, DELIMITER ',')")
    if not args.successor_only:
        con.execute(f"""COPY (SELECT id AS gcf_id, name, pet_name, family_class, listed, n_bgc,
                              '{args.clustering}' AS clustering FROM old_g ORDER BY name)
                        TO '{b}/out/gcf_legacy.csv' (HEADER, DELIMITER ',')""")
    log(f"gcf_successor {con.execute('SELECT count(*) FROM succ').fetchone()[0]:,} rows, "
        f"gcf_legacy {con.execute('SELECT count(*) FROM old_g').fetchone()[0]:,} rows")

    # --- what the gate reviews: how much of each listed old family stays together --------------------------
    print("\nlisted old families, by the share of their members in their largest successor:")
    for lo, hi, label in ((0.999, 2, "all (100%)"), (0.9, 0.999, "90-99.9%"), (0.5, 0.9, "50-90%"),
                          (0, 0.5, "under 50% (split up)")):
        n = con.execute(f"""
            WITH best AS (SELECT old_gcf_id, max(share_of_old) AS s FROM succ GROUP BY 1)
            SELECT count(*) FROM best JOIN old_g g ON g.id = best.old_gcf_id
            WHERE g.listed AND s >= {lo} AND s < {hi}""").fetchone()[0]
        print(f"  {label:<22s} {n:>9,}")
    gone = con.execute("""SELECT count(*) FROM old_g g WHERE g.listed AND NOT EXISTS
                          (SELECT 1 FROM succ s WHERE s.old_gcf_id = g.id)""").fetchone()[0]
    print(f"  {'no member left':<22s} {gone:>9,}   (every member removed from the corpus or now unclustered)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
