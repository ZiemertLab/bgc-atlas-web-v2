#!/usr/bin/env python3
"""Add `representative_bgc_id` to the gcfs load table, offline.

Same rule as new-schema/postload/0097 (a window over the primary memberships joined to `bgcs`), computed from
the build outputs plus one exported column, so the database only has to export `bgcs` lengths:

  per family, among its PRIMARY members: best completeness_class (complete, near-complete, core-complete,
  partial, fragment, other), then the longest region (end_pos - start_pos + 1), then the smallest bgc id.

Families with no primary member (secondary-only seed families) get none.

Inputs (CLUSTERING_BUILD): out/gcfs.csv, out/bgc_gcf.csv, out/bgc_features.csv, old/bgc_lengths.csv
  (`\\copy (SELECT id, end_pos - start_pos + 1 AS len FROM bgcs) TO ... CSV HEADER`).
Output: out/gcfs.csv rewritten with a representative_bgc_id column (the original kept as gcfs.no-rep.csv).
"""
from __future__ import annotations

import os
import sys

import duckdb

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bundle_config as cfg  # noqa: E402


def main() -> int:
    b = cfg.BUILD
    out = f"{b}/out"
    con = duckdb.connect(os.path.join(cfg.TMP, "representatives.duckdb"))
    con.execute(f"SET temp_directory='{cfg.TMP}'")
    con.execute(f"""CREATE OR REPLACE TABLE g AS SELECT * FROM read_csv('{out}/gcfs.csv', header=true,
                    all_varchar=true)""")
    con.execute(f"""CREATE OR REPLACE TABLE p AS SELECT bgc_id, gcf_id FROM read_csv('{out}/bgc_gcf.csv', header=true,
                    columns={{'bgc_id':'VARCHAR','gcf_id':'VARCHAR','distance':'DOUBLE','is_primary':'BOOLEAN',
                    'rank':'INTEGER'}}) WHERE is_primary""")
    con.execute(f"""CREATE OR REPLACE TABLE f AS SELECT bgc_id, completeness_class
                    FROM read_csv('{out}/bgc_features.csv', header=true)""")
    con.execute(f"""CREATE OR REPLACE TABLE l AS SELECT * FROM read_csv('{b}/old/bgc_lengths.csv', header=true,
                    columns={{'id':'VARCHAR','len':'BIGINT'}})""")
    con.execute("""
        CREATE OR REPLACE TABLE rep AS
        SELECT gcf_id, bgc_id FROM (
            SELECT p.gcf_id, p.bgc_id,
                   row_number() OVER (PARTITION BY p.gcf_id ORDER BY
                       CASE f.completeness_class WHEN 'complete' THEN 1 WHEN 'near-complete' THEN 2
                            WHEN 'core-complete' THEN 3 WHEN 'partial' THEN 4 WHEN 'fragment' THEN 5 ELSE 6 END,
                       l.len DESC NULLS LAST, p.bgc_id) AS rn
            FROM p JOIN l ON l.id = p.bgc_id LEFT JOIN f ON f.bgc_id = p.bgc_id
        ) WHERE rn = 1
    """)
    n_rep = con.execute("SELECT count(*) FROM rep").fetchone()[0]
    n_with_primary = con.execute("SELECT count(DISTINCT gcf_id) FROM p").fetchone()[0]
    n_unmatched = con.execute("SELECT count(*) FROM p LEFT JOIN l ON l.id = p.bgc_id WHERE l.id IS NULL").fetchone()[0]
    print(f"families with a primary member {n_with_primary:,}; representatives {n_rep:,}; "
          f"primary members missing from bgcs {n_unmatched:,}")
    if n_rep != n_with_primary or n_unmatched:
        print("FAIL: every family with a primary member needs exactly one representative from bgcs")
        return 1

    os.replace(f"{out}/gcfs.csv", f"{out}/gcfs.no-rep.csv")
    con.execute(f"""COPY (SELECT g.*, r.bgc_id AS representative_bgc_id
                          FROM read_csv('{out}/gcfs.no-rep.csv', header=true, all_varchar=true) g
                          LEFT JOIN rep r ON r.gcf_id = g.id ORDER BY g.family_class, g.name)
                    TO '{out}/gcfs.csv' (HEADER, DELIMITER ',')""")
    n_none = con.execute(f"""SELECT count(*) FROM read_csv('{out}/gcfs.csv', header=true, all_varchar=true)
                             WHERE representative_bgc_id IS NULL""").fetchone()[0]
    print(f"wrote {out}/gcfs.csv; {n_none:,} families without a representative (no primary member)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
