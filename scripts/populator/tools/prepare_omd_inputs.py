"""Prepare the two committed TSV inputs for the OMD-v2 metadata backfill.

Output 1 -- ``data/omd/omd_sample_dataset_map.tsv``: biosample -> OMD dataset code,
from the OMD-v2 catalog's SAMPLE column (``<DATASET>_<BIOSAMPLE>_METAG``).

Output 2 -- ``data/omd/omd_biosample_metadata.tsv``: ENA sample attributes for those
biosamples, with ``sample_accession`` renamed to ``biosample``.

Stdlib only. Both fetches refuse to overwrite the committed files from a truncated
HTTP 200.

Run:
    scripts/populator/.venv/bin/python -m scripts.populator.tools.prepare_omd_inputs
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
REPO_ROOT = _THIS.parents[3]  # <repo>/scripts/populator/tools/prepare_omd_inputs.py
OMD_DIR = REPO_ROOT / "scripts" / "populator" / "data" / "omd"
DATASET_MAP_TSV = OMD_DIR / "omd_sample_dataset_map.tsv"
BIOSAMPLE_METADATA_TSV = OMD_DIR / "omd_biosample_metadata.tsv"

OMD_CATALOG_URL = (
    "https://sunagawalab.ethz.ch/share/microbiomics/ocean/db/2.0/data/"
    "catalogs/OMDBv2.0_data.tsv.gz"
)
# BioSample accession token: SAMN (NCBI), SAMEA (EMBL-EBI), SAMD (DDBJ).
_BIOSAMPLE_RE = re.compile(r"SAM(?:N|EA|D)\d+")
# The catalog has ~9,214 distinct biosamples; fewer means a truncated fetch.
_CATALOG_MIN_BIOSAMPLES = 1000

_ENA_ENDPOINT = "https://www.ebi.ac.uk/ena/portal/api/search"
_ENA_FIELDS = (
    "sample_accession,lat,lon,location,collection_date,depth,temperature,"
    "salinity,country,environmental_medium"
)
OUTPUT_COLUMNS = [
    "biosample", "lat", "lon", "location", "collection_date", "depth",
    "temperature", "salinity", "country", "environmental_medium",
]
_ENA_HEADER_FIELDS = ["sample_accession"] + OUTPUT_COLUMNS[1:]
_ENA_BATCH = 1000
_ENA_MIN_ROWS = 1000


def parse_catalog_dataset_map(text: str,
                              min_biosamples: int = _CATALOG_MIN_BIOSAMPLES) -> dict:
    """Parse the decompressed OMD catalog TSV into ``{biosample: dataset}``; first
    occurrence wins. Raises ``ValueError`` on a missing SAMPLE column or too few rows.
    """
    lines = text.splitlines()
    if not lines:
        raise ValueError("empty OMD catalog response")
    header = lines[0].split("\t")
    try:
        sample_idx = header.index("SAMPLE")
    except ValueError:
        ci = [i for i, h in enumerate(header) if h.strip().upper() == "SAMPLE"]
        if not ci:
            raise ValueError(
                f"OMD catalog: no SAMPLE column in header {header[:12]}...")
        sample_idx = ci[0]

    out: dict = {}
    for line in lines[1:]:
        if not line.strip():
            continue
        cells = line.split("\t")
        if sample_idx >= len(cells):
            continue
        sample = cells[sample_idx]
        m = _BIOSAMPLE_RE.search(sample)
        if not m:
            continue
        biosample = m.group(0)
        if biosample in out:
            continue  # first-wins dedup across the biosample's MAG rows
        out[biosample] = sample[:m.start()].rstrip("_")
    if len(out) < min_biosamples:
        raise ValueError(
            f"OMD catalog parsed only {len(out)} distinct biosamples "
            f"(< sanity floor {min_biosamples}); refusing to overwrite the committed map")
    return out


def fetch_catalog_text(url: str = OMD_CATALOG_URL, timeout: int = 600) -> str:
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


def write_dataset_map(dataset_map: dict, out_path=DATASET_MAP_TSV) -> int:
    rows = [[bs, dataset_map[bs]] for bs in sorted(dataset_map)]
    return _write_tsv(out_path, ["biosample", "dataset"], rows)


def write_biosample_metadata(rows, out_path=BIOSAMPLE_METADATA_TSV) -> int:
    return _write_tsv(out_path, OUTPUT_COLUMNS, rows)


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description="Prepare the OMD-v2 backfill input TSVs.")
    parser.add_argument(
        "--skip-ena", action="store_true",
        help="Only regenerate the dataset map from the catalog (no ENA fetch).")
    args = parser.parse_args(argv)

    try:
        catalog = fetch_catalog_text()
        dataset_map = parse_catalog_dataset_map(catalog)
    except Exception as exc:  # noqa: BLE001 - surface any fetch/parse failure as exit 1
        print(f"ERROR: dataset map not written (committed file left intact): {exc}",
              file=sys.stderr)
        return 1
    n_ds = write_dataset_map(dataset_map)
    print(f"wrote {DATASET_MAP_TSV} ({n_ds} biosamples)")

    if args.skip_ena:
        print("skipping ENA fetch (--skip-ena); left existing metadata untouched")
        return 0

    try:
        rows = fetch_ena_metadata(dataset_map.keys())
    except Exception as exc:  # noqa: BLE001
        print(f"ERROR: biosample metadata not written (committed file left intact): {exc}",
              file=sys.stderr)
        return 1
    n_meta = write_biosample_metadata(rows)
    print(f"wrote {BIOSAMPLE_METADATA_TSV} ({n_meta} data rows)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
