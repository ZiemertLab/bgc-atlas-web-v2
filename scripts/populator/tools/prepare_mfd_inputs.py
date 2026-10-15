"""Prepare two committed, diffable TSV inputs for the MFD metadata backfill.

Output 1 -- ``data/mfd/mfd_field_metadata.tsv``: a 13-column projection of sheet 1
of ``data/mfd/latest_mfd_db.xlsx``, one row per sample.

Output 2 -- ``data/mfd/mfd_lr_ena_assembly_map.tsv``: the long-read GCA->barcode map
from ENA (study PRJEB58634).

openpyxl/pandas are not in ``scripts/populator/.venv``; the xlsx is parsed with the
standard library only.

Run:
    scripts/populator/.venv/bin/python -m scripts.populator.tools.prepare_mfd_inputs
"""
from __future__ import annotations

import argparse
import csv
import pathlib
import re
import sys
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
import zipfile

_THIS = pathlib.Path(__file__).resolve()
REPO_ROOT = _THIS.parents[3]  # <repo>/scripts/populator/tools/prepare_mfd_inputs.py
MFD_DIR = REPO_ROOT / "scripts" / "populator" / "data" / "mfd"
XLSX_PATH = MFD_DIR / "latest_mfd_db.xlsx"
FIELD_METADATA_TSV = MFD_DIR / "mfd_field_metadata.tsv"
ENA_MAP_TSV = MFD_DIR / "mfd_lr_ena_assembly_map.tsv"

ENA_STUDY = "PRJEB58634"
_ENA_ENDPOINT = "https://www.ebi.ac.uk/ena/portal/api/search"
# Any other header means the body can't be trusted.
_ENA_HEADER = "accession\tassembly_name"
# The study has ~15,645 rows; fewer means a truncated HTTP 200.
_ENA_MIN_ROWS = 1000

SLIM_COLUMNS = [
    "fieldsample_barcode",
    "project_id",
    "sampling_date",
    "latitude",
    "longitude",
    "sitename",
    "coords_reliable",
    "mfd_sampletype",
    "mfd_areatype",
    "mfd_hab1",
    "mfd_hab2",
    "mfd_hab3",
    "habitat_typenumber",
]

_MISSING_SENTINELS = frozenset({"None", "NA", ""})


def _clean(v):
    """Map the empty-cell sentinels to ``None``; real values pass through verbatim."""
    if v is None:
        return None
    if v in _MISSING_SENTINELS:
        return None
    return v


def _slim_row(row: dict) -> list:
    """Project a workbook row dict onto ``SLIM_COLUMNS``, empty as ""."""
    out = []
    for col in SLIM_COLUMNS:
        val = _clean(row.get(col))
        out.append("" if val is None else val)
    return out


def _barcode_from_assembly_name(name: str) -> str:
    """``MFD10113.bin.2.41`` -> ``MFD10113``."""
    return name.split(".")[0].split("_")[0]


_NS = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
_REL = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}"


def _col_letter(cell_ref: str) -> str:
    # Every <c> must carry an "r" attr; a workbook without one fails loudly here.
    return re.match(r"[A-Z]+", cell_ref).group()


def read_xlsx(path):
    """Yield ``(sheet_name, list_of_row_dicts)`` for each sheet, keyed by header name.

    Row 1 is the header: blank header cells are dropped and duplicates collapse.
    Columns sort length-first ("AA" after "Z").
    """
    with zipfile.ZipFile(path) as z:
        shared = []
        if "xl/sharedStrings.xml" in z.namelist():
            root = ET.fromstring(z.read("xl/sharedStrings.xml"))
            for si in root.findall(f"{_NS}si"):
                shared.append("".join(t.text or "" for t in si.iter(f"{_NS}t")))

        wb = ET.fromstring(z.read("xl/workbook.xml"))
        sheets = [(s.get("name"), s.get(f"{_REL}id")) for s in wb.iter(f"{_NS}sheet")]
        rels = ET.fromstring(z.read("xl/_rels/workbook.xml.rels"))
        rid2target = {r.get("Id"): r.get("Target") for r in rels}

        def cell_val(c):
            t = c.get("t")
            v = c.find(f"{_NS}v")
            istr = c.find(f"{_NS}is")
            if t == "s" and v is not None:
                return shared[int(v.text)]
            if t == "inlineStr" and istr is not None:
                return "".join(x.text or "" for x in istr.iter(f"{_NS}t"))
            return v.text if v is not None else None

        for name, rid in sheets:
            target = rid2target[rid]
            path_in_zip = "xl/" + target if not target.startswith("/") else target[1:]
            root = ET.fromstring(z.read(path_in_zip))
            rows = []
            for row in root.iter(f"{_NS}row"):
                cells = {}
                for c in row.findall(f"{_NS}c"):
                    cells[_col_letter(c.get("r"))] = cell_val(c)
                rows.append(cells)
            if not rows:
                yield name, []
                continue
            header = rows[0]
            cols = sorted(header.keys(), key=lambda x: (len(x), x))
            col_names = [header[c] for c in cols]
            out = []
            for r in rows[1:]:
                out.append({col_names[i]: r.get(cols[i]) for i in range(len(cols))})
            yield name, out


def build_field_metadata_rows(xlsx_path=XLSX_PATH) -> list:
    _sheet_name, data_rows = next(iter(read_xlsx(xlsx_path)))
    return [_slim_row(r) for r in data_rows]


def _ena_url(study: str = ENA_STUDY) -> str:
    params = {
        "result": "assembly",
        "query": f'study_accession="{study}"',
        "fields": "accession,assembly_name",
        "format": "tsv",
        "limit": "0",
    }
    return _ENA_ENDPOINT + "?" + urllib.parse.urlencode(params, quote_via=urllib.parse.quote)


def _parse_ena_tsv(text: str, min_rows: int = _ENA_MIN_ROWS) -> list:
    """Parse the ENA assembly TSV into ``(accession, assembly_name, barcode)`` tuples.

    Raises ``ValueError`` on an unexpected header or fewer than ``min_rows`` rows.
    """
    lines = text.splitlines()
    header = lines[0] if lines else "<empty response>"
    if header != _ENA_HEADER:
        raise ValueError(
            f"unexpected ENA response header: {header!r} (expected {_ENA_HEADER!r})"
        )
    out = []
    for line in lines[1:]:
        if not line.strip():
            continue
        parts = line.split("\t")
        accession = parts[0]
        assembly_name = parts[1] if len(parts) > 1 else ""
        out.append((accession, assembly_name, _barcode_from_assembly_name(assembly_name)))
    if len(out) < min_rows:
        raise ValueError(
            f"ENA returned only {len(out)} data rows (< sanity floor {min_rows}); "
            "refusing to overwrite the committed map with a likely-truncated fetch"
        )
    return out


def fetch_ena_rows(study: str = ENA_STUDY, timeout: int = 300) -> list:
    """Fetch the long-read assembly map from ENA; raises on a bad response."""
    url = _ena_url(study)
    with urllib.request.urlopen(url, timeout=timeout) as resp:
        text = resp.read().decode("utf-8")
    return _parse_ena_tsv(text)


def write_field_metadata(xlsx_path=XLSX_PATH, out_path=FIELD_METADATA_TSV) -> int:
    rows = build_field_metadata_rows(xlsx_path)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with open(out_path, "w", newline="", encoding="utf-8") as fh:
        w = csv.writer(fh, delimiter="\t", lineterminator="\n")
        w.writerow(SLIM_COLUMNS)
        w.writerows(rows)
    return len(rows)


def write_ena_map(study: str = ENA_STUDY, out_path=ENA_MAP_TSV) -> int:
    rows = fetch_ena_rows(study)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with open(out_path, "w", newline="", encoding="utf-8") as fh:
        w = csv.writer(fh, delimiter="\t", lineterminator="\n")
        w.writerow(["accession", "assembly_name", "barcode"])
        w.writerows(rows)
    return len(rows)


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description="Prepare the MFD backfill input TSVs.")
    parser.add_argument(
        "--skip-ena",
        action="store_true",
        help="Only regenerate the field-metadata TSV (offline; no ENA fetch).",
    )
    args = parser.parse_args(argv)

    n_meta = write_field_metadata()
    print(f"wrote {FIELD_METADATA_TSV} ({n_meta} data rows)")

    if args.skip_ena:
        print("skipping ENA fetch (--skip-ena); left existing map untouched")
        return 0

    try:
        n_ena = write_ena_map()
    except Exception as exc:  # noqa: BLE001 - surface any fetch/validation failure as exit 1
        print(f"ERROR: ENA map not written (committed file left intact): {exc}", file=sys.stderr)
        return 1
    print(f"wrote {ENA_MAP_TSV} ({n_ena} data rows)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
