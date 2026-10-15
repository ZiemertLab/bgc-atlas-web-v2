#!/usr/bin/env python3
"""Fetch the completeness / contamination a MAG's submitters put in its ENA sample record.

Used for the Microflora Danica long-read MAGs missing from the MFD-LR catalogs_mags.tsv.
Uses the browser API (assembly XML -> sample XML) because the portal search API can
return HTTP 500 for days. Genomes already in <out.jsonl> are skipped on re-run.

Usage:  fetch_ena_mag_qc.py <accessions.txt> <out.jsonl>
        accessions.txt: one GCA accession per line (version optional)
"""
from __future__ import annotations

import json
import os
import re
import sys
import time
import urllib.request

BROWSER = "https://www.ebi.ac.uk/ena/browser/api/xml/"
TAGS = {"completeness score": "completeness", "contamination score": "contamination",
        "completeness software": "software"}


def get(accession: str) -> str:
    req = urllib.request.Request(
        BROWSER + accession,
        headers={"User-Agent": "bgc-atlas genome QC import (bgc-atlas.cs.uni-tuebingen.de)"})
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=120) as resp:
                return resp.read().decode()
        except Exception:
            if attempt == 3:
                raise
            time.sleep(10 * (attempt + 1))
    raise AssertionError("unreachable")


def attributes(xml: str) -> dict[str, str]:
    flat = re.sub(r"\s+", " ", xml)
    return dict(re.findall(r"<TAG>([^<]*)</TAG> ?<VALUE>([^<]*)</VALUE>", flat))


def main(argv: list[str]) -> int:
    if len(argv) != 2:
        print(__doc__, file=sys.stderr)
        return 2
    accessions = [line.strip() for line in open(argv[0]) if line.strip()]
    done = set()
    if os.path.exists(argv[1]):
        done = {json.loads(line)["accession"] for line in open(argv[1])}
    todo = [a for a in accessions if a not in done]
    with_qc = 0
    with open(argv[1], "a") as out:
        for i, accession in enumerate(todo, 1):
            sample = re.search(r"SAM[A-Z]+\d+", get(accession))
            row = {"accession": accession, "sample": sample.group() if sample else None}
            if sample:
                attrs = attributes(get(sample.group()))
                row.update({key: attrs.get(tag) for tag, key in TAGS.items()})
                with_qc += row.get("completeness") is not None
            out.write(json.dumps(row) + "\n")
            out.flush()
            if i % 50 == 0:
                print(f"{i:,}/{len(todo):,} ({with_qc:,} with QC)", flush=True)
            time.sleep(0.5)
    print(f"fetched {len(todo):,} ({with_qc:,} with QC); {len(done):,} were already in {argv[1]}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
