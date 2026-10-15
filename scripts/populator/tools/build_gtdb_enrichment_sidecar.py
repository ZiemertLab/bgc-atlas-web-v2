"""Build the consolidated GTDB enrichment sidecar so a fresh populate reproduces the
Tier 1+2+3 backfills in one pass.

One TSV row per genome: accession, sample_fields_json, metadata_json, bioproject, title.
Precedence mirrors the backfills:

  metadata  = Tier 1 dump fields  (+ biosample_* extras from Tier 3)
  geo cols  = Tier 2 release geo FIRST, Tier 3 biosample fills the gaps (COALESCE)
  env/host/date/depth cols = Tier 3 biosample only

Loads all inputs in memory; run on a big node. Read by
``gtdb_metadata.load_gtdb_enrichment``.

Usage:
    scripts/populator/.venv/bin/python -m scripts.populator.tools.build_gtdb_enrichment_sidecar \
        --dump /data/bgc-atlas/.../gtdb_sample_metadata.tsv \
        --geo /data/bgc-atlas/.../gtdb-release/geo_r232.tsv \
        --cache-dir /data/bgc-atlas/.../biosample_cache \
        --out /data/bgc-atlas/.../gtdb-release/gtdb_enrichment_sidecar.tsv
"""
import argparse
import csv
import glob
import gzip
import json
import os
import sys

from scripts.populator.tools.gtdb_dump_load import iter_gtdb_dump
from scripts.populator.tools.gtdb_release_metadata import release_metadata
from scripts.populator.tools.backfill_gtdb_geo import geo_fields
from scripts.populator.tools.parse_biosample import parse_biosample_set
from scripts.populator.tools.backfill_gtdb_biosample import _COLS as _BS_COLS
from scripts.populator.tools.gtdb_study_map import (
    load_acc_bioproject, load_titles, load_biosample_bioprojects)


def _load_geo(path):
    out = {}
    with open(path, newline="") as fh:
        for row in csv.reader(fh, delimiter="\t"):
            if len(row) >= 3:
                out[row[0]] = (row[1], row[2])
    return out


def _load_biosample_cache(cache_dirs):
    parsed = {}
    paths = [p for d in cache_dirs for p in sorted(glob.glob(os.path.join(d, "batch_*.xml")))]
    for path in paths:
        try:
            with open(path, "rb") as fh:
                parsed.update(parse_biosample_set(fh.read()))
        except Exception as e:
            print(f"  WARN: {path}: {e}", flush=True)
    return parsed


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--dump", required=True)
    ap.add_argument("--geo", required=True)
    ap.add_argument("--cache-dir", required=True, action="append",
                    help="crawl_ncbi_biosample cache dir; repeat for several (batch numbering "
                         "restarts per crawl, so each crawl has its own dir)")
    ap.add_argument("--release-metadata", action="append", default=[],
                    help="GTDB release table (ar53_metadata_r232.tsv.gz): Tier 1 for accessions "
                         "the dump lacks -- the archaea, which the old atlas never loaded")
    ap.add_argument("--bioproject", required=True, help="accession<TAB>ncbi_bioproject TSV")
    ap.add_argument("--bp-cache-dir", required=True, help="dir of crawl_ncbi_bioproject bp_*.xml")
    ap.add_argument("--out", required=True)
    args = ap.parse_args()

    print(f"loading release geo {args.geo} ...", flush=True)
    geo = _load_geo(args.geo)
    print(f"  {len(geo)} accessions with geo", flush=True)
    print(f"parsing biosample cache {args.cache_dir} ...", flush=True)
    parsed = _load_biosample_cache(args.cache_dir)
    print(f"  {len(parsed)} biosamples with usable fields", flush=True)
    print("loading bioproject (biosample links + gtdb fallback) + titles ...", flush=True)
    acc_bp = load_acc_bioproject(args.bioproject)
    bs2bp = {}
    for cache_dir in args.cache_dir:
        bs2bp.update(load_biosample_bioprojects(cache_dir))
    bp_titles = load_titles(args.bp_cache_dir)
    print(f"  gtdb fallback acc->bp {len(acc_bp)}, biosample->bp {len(bs2bp)}, "
          f"{len(bp_titles)} titled", flush=True)

    def tier1():
        seen = set()
        for acc, md in iter_gtdb_dump(args.dump):
            seen.add(acc)
            yield acc, md
        for path in args.release_metadata:
            print(f"  release fallback {path} ...", flush=True)
            with gzip.open(path, "rt") as fh:
                for row in csv.DictReader(fh, delimiter="\t"):
                    if row["accession"] not in seen:
                        yield row["accession"], release_metadata(row)

    print(f"streaming dump {args.dump} -> {args.out} ...", flush=True)
    n = 0
    tmp = args.out + ".tmp"
    with open(tmp, "w", newline="") as out:
        w = csv.writer(out, delimiter="\t")
        for acc, md in tier1():
            md = dict(md)
            sf = {}
            if acc in geo:
                country, lat_lon = geo[acc]
                sf.update(geo_fields(country, lat_lon))
            # Tier 3 fills column gaps; extras go into metadata.
            bs = md.get("ncbi_biosample")
            bf = parsed.get(bs) if bs else None
            if bf:
                for c in _BS_COLS:
                    if bf.get(c) is not None and sf.get(c) is None:
                        sf[c] = bf[c]
                for k, v in (bf.get("_extras") or {}).items():
                    md[f"biosample_{k}"] = v
            # Biosample's own BioProject link first, GTDB ncbi_bioproject as fallback.
            bp = (bs2bp.get(bs) if bs else None) or acc_bp.get(acc, "")
            title = bp_titles.get(bp, "") if bp else ""
            w.writerow([acc, json.dumps(sf, separators=(",", ":")),
                        json.dumps(md, separators=(",", ":")), bp, title])
            n += 1
            if n % 50000 == 0:
                print(f"  wrote {n}", flush=True)
    os.replace(tmp, args.out)
    print(f"done: {n} genomes -> {args.out}", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
