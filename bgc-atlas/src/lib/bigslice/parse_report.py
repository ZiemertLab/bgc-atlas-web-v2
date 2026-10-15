#!/usr/bin/env python3
"""Read a BiG-SLiCE query report and emit its results as JSON.

Prints {"results": [{"origFilename","bigsliceGcfId","distance","rank"}...], "totalMatches": N}.
Standard library only (sqlite3), so it runs under the app host's plain python3.

Usage: parse_report.py <output_dir> <query_name> <filename_map_json>
"""
import json
import os
import sqlite3
import sys


def main():
    if len(sys.argv) != 4:
        sys.stderr.write("usage: parse_report.py <output_dir> <query_name> <filename_map_json>\n")
        sys.exit(2)

    output_dir, query_name, filename_map_path = sys.argv[1], sys.argv[2], sys.argv[3]

    # renamed-on-disk -> original upload name
    filename_map = {}
    try:
        with open(filename_map_path) as fh:
            filename_map = json.load(fh)
    except FileNotFoundError:
        pass

    reports_db = os.path.join(output_dir, "reports", "reports.db")
    rc = sqlite3.connect("file:%s?mode=ro" % reports_db, uri=True)
    try:
        row = rc.execute(
            "SELECT id FROM reports WHERE name = ? ORDER BY id DESC LIMIT 1", (query_name,)
        ).fetchone()
    finally:
        rc.close()

    if not row:
        print(json.dumps({"results": [], "totalMatches": 0}))
        return

    report_db = os.path.join(output_dir, "reports", str(row[0]), "data.db")
    conn = sqlite3.connect("file:%s?mode=ro" % report_db, uri=True)
    try:
        rows = conn.execute(
            "SELECT b.orig_filename, m.gcf_id, m.membership_value, m.rank "
            "FROM gcf_membership m JOIN bgc b ON m.bgc_id = b.id "
            "ORDER BY b.orig_filename, m.rank"
        ).fetchall()
    finally:
        conn.close()

    results = [
        {
            "origFilename": filename_map.get(orig_filename, orig_filename),
            "bigsliceGcfId": gcf_id,
            "distance": value,
            "rank": rank,
        }
        for (orig_filename, gcf_id, value, rank) in rows
    ]

    print(json.dumps({"results": results, "totalMatches": len(results)}))


if __name__ == "__main__":
    main()
