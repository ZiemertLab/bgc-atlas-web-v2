"""Backfill latitude / longitude / geographic_location onto existing GTDB samples in
bgc_atlas_v2 from the GTDB release metadata, without a full re-ingest.

Reads a pre-extracted TSV (``accession<TAB>ncbi_country<TAB>ncbi_lat_lon``, see
fetch_gtdb_release_metadata.sh), parses lat/lon with the shared ``parse_lat_lon``, and
COALESCE-writes onto matching GTDB samples (``accession`` = ``samples.name``).

Usage:
    PGPASSWORD=... scripts/populator/.venv/bin/python -m scripts.populator.tools.backfill_gtdb_geo \
        --geo /data/bgc-atlas/data-v2/gtdb-release/geo_r232.tsv \
        [--dbname bgc_atlas_v2] [--apply]

Without --apply it is a dry run (counts only, no writes).
"""
import argparse
import csv
import os
import sys

import psycopg2
from psycopg2.extras import execute_values

from scripts.populator.adapters.gtdb_metadata import parse_lat_lon, _clean

GTDB_SOURCE = "GTDB"
_FLUSH = 20000


def geo_fields(country, lat_lon) -> dict:
    """(ncbi_country, ncbi_lat_lon) -> {latitude?, longitude?, geographic_location?}."""
    f: dict = {}
    lat, lon = parse_lat_lon(lat_lon)
    if lat is not None:
        f["latitude"], f["longitude"] = lat, lon
    loc = _clean(country)
    if loc is not None:
        f["geographic_location"] = loc
    return f


def _connect(dbname: str):
    return psycopg2.connect(
        host=os.environ.get("PGHOST", "localhost"),
        user=os.environ.get("PGUSER", "bgc_owner"),
        password=os.environ["PGPASSWORD"],
        dbname=dbname,
    )


def _apply_batch(cur, batch):
    execute_values(
        cur,
        """
        UPDATE samples AS s
        SET latitude = COALESCE(s.latitude, v.lat),
            longitude = COALESCE(s.longitude, v.lon),
            geographic_location = COALESCE(s.geographic_location, v.loc),
            updated_at = now()
        FROM (VALUES %s) AS v(id, lat, lon, loc)
        WHERE s.id = v.id::uuid
        """,
        batch,
        template="(%s, %s, %s, %s)",
    )


def main() -> int:
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    ap.add_argument("--geo", required=True,
                    help="3-col TSV: accession<TAB>ncbi_country<TAB>ncbi_lat_lon")
    ap.add_argument("--dbname", default="bgc_atlas_v2")
    ap.add_argument("--apply", action="store_true", help="write the UPDATEs (default: dry run)")
    args = ap.parse_args()

    conn = _connect(args.dbname)
    conn.autocommit = False
    cur = conn.cursor()

    print(f"loading GTDB sample name->id map from {args.dbname} ...", flush=True)
    cur.execute(
        """
        SELECT s.name, s.id
        FROM samples s
        WHERE EXISTS (
            SELECT 1 FROM data_sources d
            WHERE d.name = %s AND d.id = ANY(s.data_source_ids)
        )
        """,
        (GTDB_SOURCE,),
    )
    name_to_id = {name: str(sid) for name, sid in cur.fetchall()}
    print(f"GTDB samples in {args.dbname}: {len(name_to_id)}", flush=True)

    print(f"streaming geo TSV {args.geo} ...", flush=True)
    batch = []
    matched = updated = n_latlon = n_loc = 0
    with open(args.geo, newline="") as fh:
        reader = csv.reader(fh, delimiter="\t")
        for row in reader:
            if len(row) < 3:
                continue
            acc, country, lat_lon = row[0], row[1], row[2]
            sid = name_to_id.get(acc)
            if sid is None:
                continue
            matched += 1
            f = geo_fields(country, lat_lon)
            if not f:
                continue
            if "latitude" in f:
                n_latlon += 1
            if "geographic_location" in f:
                n_loc += 1
            if args.apply:
                batch.append((sid, f.get("latitude"), f.get("longitude"),
                              f.get("geographic_location")))
                if len(batch) >= _FLUSH:
                    _apply_batch(cur, batch)
                    conn.commit()
                    updated += len(batch)
                    print(f"  ...committed {updated} so far", flush=True)
                    batch = []
            else:
                updated += 1

    if args.apply and batch:
        _apply_batch(cur, batch)
        conn.commit()
        updated += len(batch)

    print(
        f"matched GTDB samples: {matched} | gaining lat/lon: {n_latlon} | "
        f"gaining geographic_location: {n_loc} | "
        f"{'updated' if args.apply else 'would update'}: {updated}",
        flush=True,
    )

    if not args.apply:
        print("dry run (no --apply): no writes performed.")
        return 0

    cur.execute(
        """
        SELECT count(*) total, count(latitude) with_latlon,
               count(geographic_location) with_loc
        FROM samples s
        WHERE EXISTS (
            SELECT 1 FROM data_sources d
            WHERE d.name = %s AND d.id = ANY(s.data_source_ids)
        )
        """,
        (GTDB_SOURCE,),
    )
    total, with_latlon, with_loc = cur.fetchone()
    print(f"post-update GTDB coverage: total={total} latitude={with_latlon} "
          f"geographic_location={with_loc}", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
