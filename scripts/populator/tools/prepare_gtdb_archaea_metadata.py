#!/usr/bin/env python3
"""Write Tier 1 metadata for the GTDB genomes whose metadata is empty (the archaea).

Reads a GTDB release table (ar53_metadata_r232.tsv.gz) and our accessions, and writes
<accession> TAB <metadata json> for every accession found, via gtdb_release_metadata.
Applied by backfill_gtdb_archaea_metadata.sql, which only touches GTDB samples whose
metadata has no gtdb_taxonomy yet.

Usage:
  prepare_gtdb_archaea_metadata.py <release.tsv.gz> <accessions.txt> <out.tsv.gz>

  accessions.txt: GTDB accessions (RS_GCF_... / GB_GCA_...) with empty metadata:
    psql -At -c "select substr(external_id, 6) from samples
                  where external_id like 'gtdb|%' and coalesce(metadata, '{}') = '{}'"
"""
from __future__ import annotations

import csv
import gzip
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from gtdb_release_metadata import release_metadata  # noqa: E402


def main(argv: list[str]) -> int:
    if len(argv) != 3:
        print(__doc__, file=sys.stderr)
        return 2
    release, accessions_path, out_path = argv
    wanted = {line.strip() for line in open(accessions_path) if line.strip()}
    rows = []
    with gzip.open(release, "rt") as fh:
        for row in csv.DictReader(fh, delimiter="\t"):
            if row["accession"] in wanted:
                rows.append((row["accession"], json.dumps(release_metadata(row), sort_keys=True)))
    with gzip.open(out_path, "wt", newline="") as out:
        # CSV quoting, loaded with COPY (FORMAT csv): the text format would read the
        # backslashes in JSON escapes as its own.
        w = csv.writer(out, delimiter="\t", lineterminator="\n")
        w.writerow(["accession", "metadata"])
        w.writerows(sorted(rows))
    print(f"{len(rows):,} of {len(wanted):,} accessions found in {os.path.basename(release)}"
          f" -> {out_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
