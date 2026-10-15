"""Reproduce the committed OMD-v2 Phase-2 physicochem TSV
(``data/omd/omd_tara_physicochem.tsv``) from the two Tara Oceans PANGAEA datasets.

One row per BioSample with the median of each parameter, restricted to the biosamples
in the Phase-1 ENA table (``omd_biosample_metadata.tsv``).

  * PANGAEA 875576: plain-text tab file; the data header follows the ``*/`` that
    closes the metadata block.
  * PANGAEA 875575: a ZIP containing an ``.xlsx`` whose columns are labelled by
    parameter ID only (757 nitrite, 758 phosphate, 755 silicate). Read latin-1.

Each parameter is a 5-stat group (min/q25/median/q75/max). Header labels are pinned
from the 2026-07 datasets; PANGAEA can relabel, so check a fresh fetch.

Run:
    scripts/populator/.venv/bin/python -m scripts.populator.tools.prepare_omd_physicochem
"""
from __future__ import annotations

import argparse
import csv
import io
import pathlib
import re
import sys
import urllib.request
import xml.etree.ElementTree as ET
import zipfile

_THIS = pathlib.Path(__file__).resolve()
REPO_ROOT = _THIS.parents[3]  # <repo>/scripts/populator/tools/prepare_omd_physicochem.py
OMD_DIR = REPO_ROOT / "scripts" / "populator" / "data" / "omd"
BIOSAMPLE_METADATA_TSV = OMD_DIR / "omd_biosample_metadata.tsv"
PHYSICOCHEM_TSV = OMD_DIR / "omd_tara_physicochem.tsv"

# Must match the adapter's PHYSICOCHEM_COLUMNS.
OUTPUT_COLUMNS = [
    "biosample", "temperature", "salinity", "dissolved_oxygen", "conductivity",
    "nitrate", "nitrite", "phosphate", "silicate", "chlorophyll",
]

PANGAEA_875576_URL = "https://doi.pangaea.de/10.1594/PANGAEA.875576?format=textfile"
PANGAEA_875575_URL = "https://doi.pangaea.de/10.1594/PANGAEA.875575?format=textfile"

_TXT_PARAMS = {
    "temperature":      "Temp [°C]",
    "salinity":         "Sal",
    "dissolved_oxygen": "O2 [µmol/kg]",
    "conductivity":     "Cond [mS/cm]",
    "nitrate":          "[NO3]- [µmol/l]",
    "chlorophyll":      "Chl a",
}
# Columns are labelled by parameter ID only.
_XLSX_PARAMS = {
    "nitrite":   "757",
    "phosphate": "758",
    "silicate":  "755",
}

# BioSample accession token: SAMN (NCBI), SAMEA (EMBL-EBI), SAMD (DDBJ).
_BIOSAMPLE_RE = re.compile(r"SAM(?:N|EA|D)\d+")
_MIN_ROWS = 500


def _median_index(header, param: str) -> int:
    """Column index of the median stat for ``param``: a column whose label mentions
    'median', else the 3rd column of the 5-stat group.
    """
    exact = [i for i, h in enumerate(header) if _norm(h) == param]
    idxs = exact if exact else [i for i, h in enumerate(header)
                                if _norm(h).startswith(param)]
    if not idxs:
        raise ValueError(f"parameter {param!r} not found in header")
    labelled = [i for i in idxs if "median" in header[i].lower()]
    if labelled:
        return labelled[0]
    if len(idxs) < 3:
        raise ValueError(
            f"parameter {param!r} has only {len(idxs)} columns (expected a 5-stat group)")
    return idxs[2]  # 3rd of min/q25/MEDIAN/q75/max


def _norm(cell: str) -> str:
    """Trim a header cell and drop a trailing '.0' (some xlsx param-IDs read as floats)."""
    s = (cell or "").strip()
    if s.endswith(".0") and s[:-2].isdigit():
        s = s[:-2]
    return s


def _biosample(cell: str):
    m = _BIOSAMPLE_RE.search(cell or "")
    return m.group(0) if m else None


def _clean(cell: str) -> str:
    return (cell or "").strip()


def load_wanted_biosamples(path=BIOSAMPLE_METADATA_TSV) -> set:
    with open(path, newline="", encoding="utf-8") as fh:
        reader = csv.reader(fh, delimiter="\t")
        header = next(reader)
        try:
            bi = header.index("biosample")
        except ValueError:
            raise ValueError(f"{path.name}: no 'biosample' column in header {header}")
        return {row[bi] for row in reader if row}


def parse_875576_text(text: str) -> dict:
    """Parse the 875576 text into ``{biosample: {key: median_str}}`` for ``_TXT_PARAMS``."""
    lines = text.splitlines()
    start = None
    for i, line in enumerate(lines):
        if line.strip() == "*/":
            start = i + 1
            break
    if start is None:
        # Some PANGAEA textfiles have no metadata block.
        start = next((i for i, line in enumerate(lines)
                      if "BioSamples accession" in line), None)
        if start is None:
            raise ValueError("875576: could not locate the data header (no '*/' / BioSamples)")
    if start >= len(lines):
        raise ValueError("875576: metadata block with no data header")
    header = lines[start].split("\t")
    bio_idx = next((i for i, h in enumerate(header)
                    if "BioSamples accession" in h), None)
    if bio_idx is None:
        raise ValueError(f"875576: no 'BioSamples accession' column in header {header[:8]}...")
    med_idx = {key: _median_index(header, param) for key, param in _TXT_PARAMS.items()}

    out: dict = {}
    for line in lines[start + 1:]:
        if not line.strip():
            continue
        cells = line.split("\t")
        if bio_idx >= len(cells):
            continue
        bs = _biosample(cells[bio_idx])
        if bs is None:
            continue
        rec = out.setdefault(bs, {})
        for key, idx in med_idx.items():
            if idx < len(cells):
                val = _clean(cells[idx])
                if val:
                    rec[key] = val
    return out


def fetch_875576_text(url: str = PANGAEA_875576_URL, timeout: int = 900) -> str:
    with urllib.request.urlopen(url, timeout=timeout) as resp:
        raw = resp.read()
    return raw.decode("utf-8", errors="replace")


_NS = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}


def _col_index(cell_ref: str) -> int:
    """'B5' -> 1 (0-based column index) from an xlsx cell reference's letter part."""
    letters = re.match(r"[A-Z]+", cell_ref or "")
    if not letters:
        return 0
    idx = 0
    for ch in letters.group(0):
        idx = idx * 26 + (ord(ch) - ord("A") + 1)
    return idx - 1


def _read_xlsx_rows(xlsx_bytes: bytes):
    """Yield first-worksheet rows as cell strings, with missing cells filled with ''
    so column indices stay aligned.
    """
    with zipfile.ZipFile(io.BytesIO(xlsx_bytes)) as zf:
        shared: list = []
        if "xl/sharedStrings.xml" in zf.namelist():
            sroot = ET.fromstring(zf.read("xl/sharedStrings.xml"))
            for si in sroot.findall("m:si", _NS):
                shared.append("".join(t.text or "" for t in si.iter(
                    "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}t")))
        sheet_name = next((n for n in zf.namelist()
                           if n.startswith("xl/worksheets/") and n.endswith(".xml")), None)
        if sheet_name is None:
            raise ValueError("xlsx: no worksheet found")
        root = ET.fromstring(zf.read(sheet_name))
        for row in root.iter("{http://schemas.openxmlformats.org/spreadsheetml/2006/main}row"):
            cells: dict = {}
            width = 0
            for c in row.findall("m:c", _NS):
                idx = _col_index(c.get("r", ""))
                width = max(width, idx + 1)
                ctype = c.get("t")
                if ctype == "inlineStr":
                    is_el = c.find("m:is", _NS)
                    text = "".join(t.text or "" for t in is_el.iter(
                        "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}t")
                    ) if is_el is not None else ""
                else:
                    v = c.find("m:v", _NS)
                    text = v.text if (v is not None and v.text is not None) else ""
                    if ctype == "s":
                        try:
                            text = shared[int(text)]
                        except (ValueError, IndexError):
                            text = ""
                cells[idx] = text
            yield [cells.get(i, "") for i in range(width)]


def parse_875575_xlsx(xlsx_bytes: bytes) -> dict:
    """Parse the 875575 xlsx into ``{biosample: {key: median_str}}`` for ``_XLSX_PARAMS``.

    The header row is the first containing a 'BioSamples' cell.
    """
    rows = list(_read_xlsx_rows(xlsx_bytes))
    header_i = next((i for i, r in enumerate(rows)
                     if any("BioSamples" in (c or "") for c in r)), None)
    if header_i is None:
        raise ValueError("875575: no header row containing 'BioSamples'")
    header = rows[header_i]
    bio_idx = next(i for i, c in enumerate(header) if "BioSamples" in (c or ""))
    med_idx = {key: _median_index(header, pid) for key, pid in _XLSX_PARAMS.items()}

    out: dict = {}
    for r in rows[header_i + 1:]:
        if bio_idx >= len(r):
            continue
        bs = _biosample(r[bio_idx])
        if bs is None:
            continue
        rec = out.setdefault(bs, {})
        for key, idx in med_idx.items():
            if idx < len(r):
                val = _clean(r[idx])
                if val:
                    rec[key] = val
    return out


def fetch_875575_xlsx(url: str = PANGAEA_875575_URL, timeout: int = 600) -> bytes:
    with urllib.request.urlopen(url, timeout=timeout) as resp:
        raw = resp.read()
    with zipfile.ZipFile(io.BytesIO(raw)) as zf:
        member = next((n for n in zf.namelist() if n.lower().endswith(".xlsx")), None)
        if member is None:
            raise ValueError("875575: downloaded ZIP contains no .xlsx member")
        return zf.read(member)


def build_rows(txt: dict, xlsx: dict, wanted: set) -> list:
    """Merge both parameter maps for ``wanted`` biosamples into sorted output rows."""
    rows = []
    for bs in sorted(wanted):
        t = txt.get(bs, {})
        x = xlsx.get(bs, {})
        merged = {**t, **x}
        if not merged:
            continue  # a wanted biosample with no PANGAEA physicochem at all -> skip
        rows.append([bs] + [merged.get(col, "") for col in OUTPUT_COLUMNS[1:]])
    return rows


def _write_tsv(rows, out_path=PHYSICOCHEM_TSV) -> int:
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with open(out_path, "w", newline="", encoding="utf-8") as fh:
        w = csv.writer(fh, delimiter="\t", lineterminator="\n")
        w.writerow(OUTPUT_COLUMNS)
        w.writerows(rows)
    return len(rows)


def main(argv=None) -> int:
    argparse.ArgumentParser(
        description="Reproduce the OMD-v2 Tara physicochem TSV.").parse_args(argv)

    try:
        wanted = load_wanted_biosamples()
    except FileNotFoundError:
        print(f"ERROR: {BIOSAMPLE_METADATA_TSV} missing; run prepare_omd_inputs first.",
              file=sys.stderr)
        return 1

    try:
        txt = parse_875576_text(fetch_875576_text())
        xlsx = parse_875575_xlsx(fetch_875575_xlsx())
    except Exception as exc:  # noqa: BLE001 - surface any fetch/parse failure as exit 1
        print(f"ERROR: physicochem TSV not written (committed file left intact): {exc}",
              file=sys.stderr)
        return 1

    rows = build_rows(txt, xlsx, wanted)
    if len(rows) < _MIN_ROWS:
        print(f"ERROR: only {len(rows)} rows parsed (< sanity floor {_MIN_ROWS}); "
              "refusing to overwrite the committed physicochem TSV.", file=sys.stderr)
        return 1
    n = _write_tsv(rows)
    print(f"wrote {PHYSICOCHEM_TSV} ({n} data rows)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
