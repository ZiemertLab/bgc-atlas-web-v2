#!/usr/bin/env python3
"""Fetch per-genome CheckM values from the OMDB website's genome table API.
OMDB publishes no bulk QC file, so this pages through POST /api/genome-cols
(CheckM 1.1.3 for every genome). Pages can overlap, so rows are de-duplicated and
the run fails unless the distinct count equals the API's total_count.

Usage:  fetch_omdb_genome_qc.py <out.jsonl>     (stdlib only; ~1 min, 55 requests)
"""
from __future__ import annotations

import json
import sys
import time
import urllib.request

URL = "https://omdb.microbiomics.io/api/genome-cols"
FIELDS = ["genome", "checkm_completeness", "checkm_contamination", "checkm_version",
          "completeness", "contamination", "tool", "is_mag", "anvio_completion",
          "anvio_contamination"]
PAGE = 5000


def page(start: int) -> dict:
    body = {"repo_id": "ocean", "global_search_value": "", "search_value_pair": [],
            "start": start, "length": PAGE, "window": 0, "fetchall": 0, "order": [],
            "order_cols": []}
    req = urllib.request.Request(
        URL, data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json", "Accept": "application/json",
                 "User-Agent": "bgc-atlas genome QC import (bgc-atlas.cs.uni-tuebingen.de)"})
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=180) as resp:
                return json.load(resp)
        except Exception:
            if attempt == 3:
                raise
            time.sleep(10 * (attempt + 1))
    raise AssertionError("unreachable")


def main(argv: list[str]) -> int:
    if len(argv) != 1:
        print(__doc__, file=sys.stderr)
        return 2
    rows: dict[str, dict] = {}
    start, total = 0, None
    while total is None or start < total:
        d = page(start)
        total = d["total_count"]
        data = d.get("data") or []
        if not data:
            break
        for r in data:
            rows[r["genome"]] = {k: r.get(k) for k in FIELDS}
        start += PAGE
        time.sleep(1.5)  # be gentle with a lab's server
    if len(rows) != total:
        print(f"{len(rows):,} distinct genomes but the API reports {total:,}: pages "
              "shifted and skipped rows. Re-run.", file=sys.stderr)
        return 1
    with open(argv[0], "w") as fh:
        for genome in sorted(rows):
            fh.write(json.dumps(rows[genome]) + "\n")
    print(f"wrote {len(rows):,} genomes (API total {total:,}) to {argv[0]}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
