"""Backfill environmental MIxS fields onto existing GTDB samples in bgc_atlas_v2 from
cached NCBI BioSample XML (crawl_ncbi_biosample, parsed by parse_biosample).

COALESCE-only: fills gaps, never overwrites Tier 1/2 values. ``_extras`` go into
``metadata`` under ``biosample_*`` keys so they don't collide with the dump's keys.

Usage:
    PGPASSWORD=... scripts/populator/.venv/bin/python -m scripts.populator.tools.backfill_gtdb_biosample \
        --dump /data/bgc-atlas/.../gtdb_sample_metadata.tsv \
        --cache-dir /data/bgc-atlas/.../biosample_cache \
        [--dbname bgc_atlas_v2] [--apply]
"""
import argparse
import glob
import json
import os
import sys

import psycopg2
from psycopg2.extras import execute_values

from scripts.populator.tools.gtdb_dump_load import iter_gtdb_dump
from scripts.populator.tools.parse_biosample import parse_biosample_set

GTDB_SOURCE = "GTDB"
_FLUSH = 10000
_COLS = ("latitude", "longitude", "geographic_location", "environment_biome",
         "environment_feature", "environment_material", "host_scientific_name",
         "collection_date", "depth", "depth_min_meters", "depth_max_meters")
# VALUES is untyped, so COALESCE(date, text) and leading-NULL batches need explicit casts.
_CAST = {
    "latitude": "numeric", "longitude": "numeric", "depth": "numeric",
    "depth_min_meters": "numeric", "depth_max_meters": "numeric",
    "collection_date": "date",
    "geographic_location": "text", "environment_biome": "text",
    "environment_feature": "text", "environment_material": "text",
    "host_scientific_name": "text",
}


def _connect(dbname):
    return psycopg2.connect(
        host=os.environ.get("PGHOST", "localhost"),
        user=os.environ.get("PGUSER", "bgc_owner"),
        password=os.environ["PGPASSWORD"], dbname=dbname)


def _name_to_biosample(dump_path):
    out = {}
    for ext, fields in iter_gtdb_dump(dump_path):
        bs = fields.get("ncbi_biosample")
        if bs:
            out[ext] = bs
    return out


def _parse_cache(cache_dir):
    """Parse every cached batch XML -> {biosample_accession: fields}."""
    parsed = {}
    files = sorted(glob.glob(os.path.join(cache_dir, "batch_*.xml")))
    for n, path in enumerate(files, 1):
        try:
            with open(path, "rb") as fh:
                parsed.update(parse_biosample_set(fh.read()))
        except Exception as e:                       # skip a corrupt batch
            print(f"  WARN: failed to parse {path}: {e}", flush=True)
        if n % 200 == 0:
            print(f"  parsed {n}/{len(files)} cache files, {len(parsed)} biosamples",
                  flush=True)
    print(f"parsed {len(files)} cache files -> {len(parsed)} biosamples", flush=True)
    return parsed


_SET = ",\n".join(f"{c} = COALESCE(s.{c}, v.{c}::{_CAST[c]})" for c in _COLS)
_UPDATE = f"""
    UPDATE samples AS s
    SET {_SET},
        metadata = COALESCE(s.metadata, '{{}}'::jsonb) || v.extras::jsonb,
        updated_at = now()
    FROM (VALUES %s) AS v(id, {", ".join(_COLS)}, extras)
    WHERE s.id = v.id::uuid
"""
_TEMPLATE = "(" + ", ".join(["%s"] * (len(_COLS) + 2)) + ")"


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--dump", help="gtdb_sample_metadata.tsv (for name->biosample); without it "
                    "the biosample is read from each sample's metadata.ncbi_biosample")
    ap.add_argument("--only", help="file of GTDB accessions (samples.name) to limit the run to")
    ap.add_argument("--cache-dir", required=True, help="dir of crawl_ncbi_biosample batch_*.xml")
    ap.add_argument("--dbname", default="bgc_atlas_v2")
    ap.add_argument("--apply", action="store_true", help="write the UPDATEs (default: dry run)")
    args = ap.parse_args()

    name_to_bs = {}
    if args.dump:
        print(f"building name->biosample from {args.dump} ...", flush=True)
        name_to_bs = _name_to_biosample(args.dump)
        print(f"  {len(name_to_bs)} genomes with a biosample", flush=True)
    only = None
    if args.only:
        only = {line.strip() for line in open(args.only) if line.strip()}
        print(f"limited to the {len(only)} accessions in {args.only}", flush=True)

    print(f"parsing cached biosample XML in {args.cache_dir} ...", flush=True)
    parsed = _parse_cache(args.cache_dir)

    conn = _connect(args.dbname)
    conn.autocommit = False
    cur = conn.cursor()
    # The dump has no archaea: for them, and with no --dump, use the biosample in metadata.
    cur.execute(
        """SELECT s.name, s.id, s.metadata->>'ncbi_biosample' FROM samples s WHERE EXISTS (
               SELECT 1 FROM data_sources d WHERE d.name=%s AND d.id=ANY(s.data_source_ids))""",
        (GTDB_SOURCE,))
    name_to_id = {}
    for name, sid, bs in cur.fetchall():
        if only is not None and name not in only:
            continue
        name_to_id[name] = str(sid)
        if bs and name not in name_to_bs:
            name_to_bs[name] = bs
    print(f"GTDB samples in {args.dbname}: {len(name_to_id)}", flush=True)

    batch = []
    matched = updated = 0
    col_counts = {c: 0 for c in _COLS}
    for name, sid in name_to_id.items():
        bs = name_to_bs.get(name)
        f = parsed.get(bs) if bs else None
        if not f:
            continue
        matched += 1
        extras = f.get("_extras") or {}
        extras = {f"biosample_{k}": v for k, v in extras.items()}
        row = [sid] + [f.get(c) for c in _COLS] + [json.dumps(extras, separators=(",", ":"))]
        for c in _COLS:
            if f.get(c) is not None:
                col_counts[c] += 1
        if args.apply:
            batch.append(tuple(row))
            if len(batch) >= _FLUSH:
                execute_values(cur, _UPDATE, batch, template=_TEMPLATE)
                conn.commit()
                updated += len(batch)
                print(f"  ...committed {updated}", flush=True)
                batch = []
        else:
            updated += 1

    if args.apply and batch:
        execute_values(cur, _UPDATE, batch, template=_TEMPLATE)
        conn.commit()
        updated += len(batch)

    print(f"GTDB samples with a parsed biosample: {matched} | "
          f"{'updated' if args.apply else 'would update'}: {updated}", flush=True)
    print("per-field values available (COALESCE means only empties are actually filled):")
    for c in _COLS:
        print(f"  {c}: {col_counts[c]}")
    if not args.apply:
        print("dry run (no --apply): no writes performed.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
