"""GTDB Phase B (geo/host) enrichment from ENA sample attributes.

Fills geographic/host columns on GTDB samples in ``bgc_atlas_v2`` from the ENA Portal
sample endpoint. ENA rather than NCBI efetch because efetch misses most SAMEA
biosamples (~39% of the gap).

Finds GTDB samples missing host/env_biome/coords, fetches ENA attributes in batches
of 1000 (cached to ``--cache-dir``, so resumable), and COALESCE-fills only NULL
columns. isolation_source goes to ``metadata.ena_isolation_source``; lat/lon are
range-checked; collection_date only when a full ISO date. Dry run unless --apply.

Usage:
    PGPASSWORD=... scripts/populator/.venv/bin/python -m scripts.populator.tools.backfill_gtdb_ena_geo \
        --cache-dir /var/tmp/gtdb_ena_cache [--dbname bgc_atlas_v2] [--apply]
"""
import argparse
import csv
import datetime
import json
import math
import os
import re
import sys
import time

import psycopg2
import requests
from psycopg2.extras import execute_values

GTDB_SOURCE = "GTDB"
ENA_SEARCH = "https://www.ebi.ac.uk/ena/portal/api/search"
ENA_FIELDS = ("sample_accession,host_scientific_name,host_tax_id,lat,lon,country,"
              "collection_date,isolation_source,environment_biome,environment_feature,"
              "environment_material")
BATCH = 1000
# VALUES is untyped text, so cast per column.
COLS = ("host_scientific_name", "host_taxid", "latitude", "longitude",
        "geographic_location", "collection_date", "environment_biome",
        "environment_feature", "environment_material")
CAST = {"host_taxid": "integer", "latitude": "numeric", "longitude": "numeric",
        "collection_date": "date"}
_DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def _connect(dbname):
    return psycopg2.connect(
        host=os.environ.get("PGHOST", "localhost"),
        user=os.environ.get("PGUSER", "bgc_owner"),
        password=os.environ["PGPASSWORD"], dbname=dbname)


def _fnum(x):
    try:
        v = float(x)
        return v if math.isfinite(v) else None
    except (TypeError, ValueError):
        return None


def _latlon(la, lo):
    la, lo = _fnum(la), _fnum(lo)
    if la is None or lo is None or not (-90 <= la <= 90) or not (-180 <= lo <= 180):
        return None, None
    return la, lo


def _date(x):
    x = (x or "").strip()
    if _DATE.match(x):
        try:
            datetime.date.fromisoformat(x)
            return x
        except ValueError:
            return None
    return None


def _int(x):
    try:
        return int(str(x).strip())
    except (TypeError, ValueError):
        return None


def _txt(x):
    x = (x or "").strip()
    return x if x and x.upper() not in ("NA", "N/A", "NONE") else None


def _gap_biosamples(cur, only=None):
    cur.execute(
        """SELECT DISTINCT s.metadata->>'ncbi_biosample'
             FROM samples s JOIN data_sources d ON d.id = ANY(s.data_source_ids)
            WHERE d.name = %s AND COALESCE(s.metadata->>'ncbi_biosample','') <> ''
              AND (s.host_scientific_name IS NULL OR s.environment_biome IS NULL
                   OR s.latitude IS NULL)
              AND (%s::text[] IS NULL OR s.name = ANY(%s::text[]))""",
        (GTDB_SOURCE, only, only))
    return sorted(r[0] for r in cur.fetchall())


def _fetch_ena(accessions, cache_dir):
    """Fetch ENA sample attrs in batches, caching each batch TSV."""
    os.makedirs(cache_dir, exist_ok=True)
    session = requests.Session()
    out = {}
    nbatch = (len(accessions) + BATCH - 1) // BATCH
    for i in range(nbatch):
        path = os.path.join(cache_dir, f"batch_{i:05d}.tsv")
        if not os.path.exists(path):
            chunk = accessions[i * BATCH:(i + 1) * BATCH]
            for attempt in range(4):
                try:
                    resp = session.post(ENA_SEARCH, data={
                        "result": "sample", "includeAccessions": ",".join(chunk),
                        "fields": ENA_FIELDS, "format": "tsv"}, timeout=180)
                    resp.raise_for_status()
                    with open(path, "w") as fh:
                        fh.write(resp.text)
                    break
                except requests.RequestException as e:
                    if attempt == 3:
                        raise
                    time.sleep(2 ** attempt)
                    print(f"  retry batch {i}: {e}", flush=True)
            if (i + 1) % 25 == 0:
                print(f"  fetched {i + 1}/{nbatch} batches", flush=True)
        with open(path) as fh:
            for r in csv.DictReader(fh, delimiter="\t"):
                bs = (r.get("sample_accession") or "").strip()
                if bs:
                    out[bs] = r
    print(f"ENA rows: {len(out)} for {len(accessions)} gap biosamples", flush=True)
    return out


def _fields(r):
    la, lo = _latlon(r.get("lat"), r.get("lon"))
    return {
        "host_scientific_name": _txt(r.get("host_scientific_name")),
        "host_taxid": _int(r.get("host_tax_id")),
        "latitude": la, "longitude": lo,
        "geographic_location": _txt(r.get("country")),
        "collection_date": _date(r.get("collection_date")),
        "environment_biome": _txt(r.get("environment_biome")),
        "environment_feature": _txt(r.get("environment_feature")),
        "environment_material": _txt(r.get("environment_material")),
        "_iso": _txt(r.get("isolation_source")),
    }


_SET = ",\n".join(f"{c} = COALESCE(s.{c}, v.{c}::{CAST.get(c, 'text')})" for c in COLS)
_UPDATE = f"""
    UPDATE samples AS s
       SET {_SET},
           metadata = s.metadata || v.extras::jsonb,
           updated_at = now()
      FROM (VALUES %s) AS v(id, {", ".join(COLS)}, extras)
     WHERE s.id = v.id::uuid
"""
_TEMPLATE = "(" + ", ".join(["%s"] * (len(COLS) + 2)) + ")"


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--cache-dir", required=True, help="dir for ENA batch TSV cache (resumable)")
    ap.add_argument("--dbname", default="bgc_atlas_v2")
    ap.add_argument("--apply", action="store_true", help="write the UPDATEs (default: dry run)")
    ap.add_argument("--only", help="file of GTDB accessions (samples.name) to limit the run to")
    args = ap.parse_args()
    only = sorted({l.strip() for l in open(args.only) if l.strip()}) if args.only else None

    conn = _connect(args.dbname)
    cur = conn.cursor()
    cur.execute("SELECT current_database()")
    if cur.fetchone()[0] != "bgc_atlas_v2" and args.dbname == "bgc_atlas_v2":
        print("refusing: not connected to bgc_atlas_v2", file=sys.stderr)
        return 2
    conn.autocommit = False

    gap = _gap_biosamples(cur, only)
    print(f"GTDB gap biosamples (missing host/env_biome/coords): {len(gap)}", flush=True)
    ena = _fetch_ena(gap, args.cache_dir)

    cur.execute(
        """SELECT s.id, s.metadata->>'ncbi_biosample'
             FROM samples s JOIN data_sources d ON d.id = ANY(s.data_source_ids)
            WHERE d.name = %s AND COALESCE(s.metadata->>'ncbi_biosample','') <> ''
              AND (%s::text[] IS NULL OR s.name = ANY(%s::text[]))""",
        (GTDB_SOURCE, only, only))
    batch, matched = [], 0
    gains = {c: 0 for c in COLS}
    for sid, bs in cur.fetchall():
        r = ena.get(bs)
        if not r:
            continue
        f = _fields(r)
        matched += 1
        for c in COLS:
            if f.get(c) is not None:
                gains[c] += 1
        extras = {"ena_isolation_source": f["_iso"]} if f["_iso"] else {}
        batch.append((str(sid), *[f.get(c) for c in COLS],
                      json.dumps(extras, separators=(",", ":"))))

    print(f"matched GTDB samples: {matched}")
    print("per-field ENA values available (COALESCE fills only NULLs):")
    for c in COLS:
        print(f"  {c}: {gains[c]}")

    if args.apply:
        for i in range(0, len(batch), 1000):
            execute_values(cur, _UPDATE, batch[i:i + 1000], template=_TEMPLATE)
        conn.commit()
        print(f"APPLIED {len(batch)} updates, committed.")
    else:
        print("dry run (no --apply): no writes performed.")
    conn.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
