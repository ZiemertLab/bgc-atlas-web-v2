"""Crawl ENA BioSample attributes for SMAG samples with a generic ESA ecosystem (those left
at bare Environmental:Terrestrial:Soil), whose isolation_source may carry a finer habitat.

Caches ``biosample<TAB>isolation_source`` to data/smag/smag_biosample_isolation.tsv;
cached rows are not re-fetched.

Usage:
    scripts/populator/.venv/bin/python -m scripts.populator.tools.crawl_smag_biosample_isolation
"""
import csv
import sys
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from urllib.request import urlopen
from xml.etree import ElementTree as ET

SMAG_DIR = Path(__file__).resolve().parent.parent / "data" / "smag"
SAMPLE_TSV = SMAG_DIR / "smag_sample_metadata.tsv"
CACHE_TSV = SMAG_DIR / "smag_biosample_isolation.tsv"
GENERIC_ECO = {"Bare Land", "Artificial Surfaces", "NA", "Sea", ""}
ENA_XML = "https://www.ebi.ac.uk/ena/browser/api/xml/{}"
_ATTR_PRIORITY = ["isolation_source", "env_medium", "env_local_scale", "env_broad_scale"]


def _generic_biosamples():
    seen = {}
    with SAMPLE_TSV.open() as f:
        for r in csv.DictReader(f, delimiter="\t"):
            if (r.get("ecosystem", "").strip() in GENERIC_ECO):
                bs = (r.get("biosample", "") or "").strip()
                if bs and bs.upper() not in ("NA", "NAN", "NONE"):
                    seen[bs] = None
    return sorted(seen)


def _fetch(biosample):
    try:
        with urlopen(ENA_XML.format(biosample), timeout=30) as resp:
            root = ET.fromstring(resp.read())
    except Exception as e:  # noqa: BLE001 - network best-effort, record blank
        return biosample, ""
    attrs = {}
    for a in root.iter("SAMPLE_ATTRIBUTE"):
        tag = (a.findtext("TAG") or "").strip().lower()
        val = (a.findtext("VALUE") or "").strip()
        if tag and val:
            attrs[tag] = val
    for key in _ATTR_PRIORITY:
        if attrs.get(key):
            return biosample, attrs[key]
    return biosample, ""


def main() -> int:
    cache = {}
    if CACHE_TSV.exists():
        with CACHE_TSV.open() as f:
            for row in csv.reader(f, delimiter="\t"):
                if row:
                    cache[row[0]] = row[1] if len(row) > 1 else ""
    targets = _generic_biosamples()
    todo = [b for b in targets if b not in cache]
    print(f"{len(targets)} generic-ecosystem biosamples; {len(cache)} cached, {len(todo)} to fetch")

    if todo:
        done = 0
        with ThreadPoolExecutor(max_workers=8) as ex:
            for bs, iso in ex.map(_fetch, todo):
                cache[bs] = iso
                done += 1
                if done % 100 == 0:
                    print(f"  fetched {done}/{len(todo)}", flush=True)
        with CACHE_TSV.open("w", newline="") as f:
            w = csv.writer(f, delimiter="\t")
            for bs in sorted(cache):
                w.writerow([bs, cache[bs]])
        print(f"cached {len(cache)} rows -> {CACHE_TSV}")

    dist = Counter(cache[b].lower() or "(blank)" for b in targets if b in cache)
    print("\n=== isolation_source distribution (target biosamples) ===")
    for v, n in dist.most_common(40):
        print(f"  {n:5d}  {v!r}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
