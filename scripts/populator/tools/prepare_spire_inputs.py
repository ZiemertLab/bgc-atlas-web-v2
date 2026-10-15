"""Prepare (regenerate) the two committed TSV inputs for the SPIRE MAGs metadata backfill.

Output 1 -- ``data/spire/spire_accession_biosample.tsv``: SPIRE genome id ->
``derived_from_sample`` BioSample, for rows where that is a valid public accession.
The committed file covers only the loaded MAGs; a regenerated superset is harmless.

Output 2 -- ``data/spire/spire_biosample_metadata.tsv``: ENA sample attributes for
those BioSamples, with ``sample_accession`` renamed to ``biosample``.

Stdlib only. Both fetches refuse to overwrite the committed files from a truncated
HTTP 200.

Run:
    scripts/populator/.venv/bin/python -m scripts.populator.tools.prepare_spire_inputs
"""
from __future__ import annotations

import argparse
import csv
import gzip
import pathlib
import re
import sys
import urllib.parse
import urllib.request

_THIS = pathlib.Path(__file__).resolve()
REPO_ROOT = _THIS.parents[3]  # <repo>/scripts/populator/tools/prepare_spire_inputs.py
SPIRE_DIR = REPO_ROOT / "scripts" / "populator" / "data" / "spire"
ACCESSION_BIOSAMPLE_TSV = SPIRE_DIR / "spire_accession_biosample.tsv"
BIOSAMPLE_METADATA_TSV = SPIRE_DIR / "spire_biosample_metadata.tsv"

SPIRE_GENOME_METADATA_URL = (
    "https://black.embl.de/~fullam/spire/metadata/spire_v1_genome_metadata.tsv.gz"
)
_GENOME_ID_COL = "genome_id"
_DERIVED_FROM_SAMPLE_COL = "derived_from_sample"
# Anchored: ``derived_from_sample`` is one accession or junk.
_BIOSAMPLE_RE = re.compile(r"^SAM(?:N|EA|D)\d+$")
# The loaded SPIRE MAGs alone have ~88k accessions with a BioSample.
_GENOME_MIN_ACCESSIONS = 50000

_ENA_ENDPOINT = "https://www.ebi.ac.uk/ena/portal/api/search"
_ENA_FIELDS = (
    "sample_accession,lat,lon,location,collection_date,depth,temperature,"
    "country,environment_biome"
)
OUTPUT_COLUMNS = [
    "biosample", "lat", "lon", "location", "collection_date", "depth",
    "temperature", "country", "environment_biome",
]
_ENA_HEADER_FIELDS = ["sample_accession"] + OUTPUT_COLUMNS[1:]
_ENA_BATCH = 1000
_ENA_MIN_ROWS = 5000


def parse_genome_accession_biosample(
        text: str, min_accessions: int = _GENOME_MIN_ACCESSIONS) -> dict:
    """Parse the decompressed SPIRE genome_metadata TSV into ``{genome_id: biosample}``,
    first occurrence wins. Raises ``ValueError`` on a missing column or too few rows.
    """
    lines = text.splitlines()
    if not lines:
        raise ValueError("empty SPIRE genome_metadata response")
    header = lines[0].split("\t")
    idx = {name: i for i, name in enumerate(header)}
    for col in (_GENOME_ID_COL, _DERIVED_FROM_SAMPLE_COL):
        if col not in idx:
            raise ValueError(
                f"SPIRE genome_metadata: no {col!r} column in header {header[:12]}...")
    gi, si = idx[_GENOME_ID_COL], idx[_DERIVED_FROM_SAMPLE_COL]

    out: dict = {}
    for line in lines[1:]:
        if not line.strip():
            continue
        cells = line.split("\t")
        if gi >= len(cells) or si >= len(cells):
            continue
        genome_id = cells[gi]
        biosample = cells[si].strip()
        if not _BIOSAMPLE_RE.match(biosample):
            continue
        if genome_id in out:
            continue  # first-wins on a repeated genome id
        out[genome_id] = biosample
    if len(out) < min_accessions:
        raise ValueError(
            f"SPIRE genome_metadata parsed only {len(out)} accessions with a BioSample "
            f"(< sanity floor {min_accessions}); refusing to overwrite the committed map")
    return out


def fetch_genome_metadata_text(url: str = SPIRE_GENOME_METADATA_URL,
                               timeout: int = 900) -> str:
    with urllib.request.urlopen(url, timeout=timeout) as resp:
        raw = resp.read()
    return gzip.decompress(raw).decode("utf-8", errors="replace")


def parse_ena_tsv(text: str) -> list:
    """Parse one ENA TSV batch into ``OUTPUT_COLUMNS``-ordered rows, mapping by header
    name. Raises ``ValueError`` if ``sample_accession`` is missing (e.g. an HTML error).
    """
    lines = text.splitlines()
    if not lines:
        raise ValueError("empty ENA response batch")
    header = lines[0].split("\t")
    idx = {name: i for i, name in enumerate(header)}
    if "sample_accession" not in idx:
        raise ValueError(
            f"unexpected ENA response header: {lines[0]!r} "
            f"(expected a header containing 'sample_accession')")
    out = []
    for line in lines[1:]:
        if not line.strip():
            continue
        cells = line.split("\t")
        row = []
        for src in _ENA_HEADER_FIELDS:
            i = idx.get(src)
            row.append(cells[i] if (i is not None and i < len(cells)) else "")
        out.append(row)  # already in OUTPUT_COLUMNS order (sample_accession -> biosample)
    return out


def fetch_ena_metadata(biosamples, batch: int = _ENA_BATCH, timeout: int = 300,
                       min_rows: int = _ENA_MIN_ROWS) -> list:
    """Bulk-fetch ENA sample attributes in batches, sorted by biosample. Raises
    ``ValueError`` if fewer than ``min_rows`` rows parse."""
    accessions = sorted(set(biosamples))
    rows = []
    for start in range(0, len(accessions), batch):
        chunk = accessions[start:start + batch]
        data = urllib.parse.urlencode({
            "result": "sample",
            "includeAccessions": ",".join(chunk),
            "fields": _ENA_FIELDS,
            "format": "tsv",
        }).encode("utf-8")
        req = urllib.request.Request(_ENA_ENDPOINT, data=data)
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            text = resp.read().decode("utf-8")
        rows.extend(parse_ena_tsv(text))
    if len(rows) < min_rows:
        raise ValueError(
            f"ENA returned only {len(rows)} rows (< sanity floor {min_rows}); "
            "refusing to overwrite the committed biosample metadata")
    rows.sort(key=lambda r: r[0])  # by biosample
    return rows


def _write_tsv(out_path, header, rows) -> int:
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with open(out_path, "w", newline="", encoding="utf-8") as fh:
        w = csv.writer(fh, delimiter="\t", lineterminator="\n")
        w.writerow(header)
        w.writerows(rows)
    return len(rows)


def write_accession_biosample(accession_biosample: dict,
                              out_path=ACCESSION_BIOSAMPLE_TSV) -> int:
    rows = [[acc, accession_biosample[acc]] for acc in sorted(accession_biosample)]
    return _write_tsv(out_path, ["accession", "biosample"], rows)


def write_biosample_metadata(rows, out_path=BIOSAMPLE_METADATA_TSV) -> int:
    return _write_tsv(out_path, OUTPUT_COLUMNS, rows)


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description="Prepare the SPIRE backfill input TSVs.")
    parser.add_argument(
        "--skip-ena", action="store_true",
        help="Only regenerate the accession->biosample map (no ENA fetch).")
    args = parser.parse_args(argv)

    try:
        genome_meta = fetch_genome_metadata_text()
        accession_biosample = parse_genome_accession_biosample(genome_meta)
    except Exception as exc:  # noqa: BLE001 - surface any fetch/parse failure as exit 1
        print(f"ERROR: accession map not written (committed file left intact): {exc}",
              file=sys.stderr)
        return 1
    n_ab = write_accession_biosample(accession_biosample)
    print(f"wrote {ACCESSION_BIOSAMPLE_TSV} ({n_ab} accessions)")

    if args.skip_ena:
        print("skipping ENA fetch (--skip-ena); left existing metadata untouched")
        return 0

    try:
        rows = fetch_ena_metadata(set(accession_biosample.values()))
    except Exception as exc:  # noqa: BLE001
        print(f"ERROR: biosample metadata not written (committed file left intact): {exc}",
              file=sys.stderr)
        return 1
    n_meta = write_biosample_metadata(rows)
    print(f"wrote {BIOSAMPLE_METADATA_TSV} ({n_meta} data rows)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
