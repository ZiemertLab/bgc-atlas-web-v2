"""Ocean Microbiomics Database v2 (OMD-v2) sample-metadata enrichment. No database access.

``samples.accession`` is the BioSample, so lookup needs no resolution. Phase 1 is ENA geo
plus a constant marine-pelagic GOLD/ENVO triad with a depth-derived zone; Phase 2 adds
median PANGAEA physicochemistry for the Tara biosamples.

Inputs (regenerate with ``tools/prepare_omd_inputs.py``):
  * ``data/omd/omd_biosample_metadata.tsv``
  * ``data/omd/omd_sample_dataset_map.tsv``
"""
from __future__ import annotations

import csv
import json
import math
import re
from datetime import date as _date
from pathlib import Path
from typing import Dict, Optional, Tuple

OMD_SOURCE_UUID = "dc1091df-9475-5793-8d9a-a8d8ed6315d9"
OMD_COLLECTION_SLUG = "omd-v2"

# OMD-v2 is exclusively open-ocean sea water, so these are constants.
GOLD_ECOSYSTEM_PATH = "Environmental:Aquatic:Marine:Pelagic"
ENVIRONMENT_MATERIAL = "sea water"
ENVIRONMENT_BIOME = "marine pelagic biome"
ENVIRONMENTAL_PACKAGE = "water"

REPO_ROOT = Path(__file__).resolve().parents[3]
OMD_DIR = REPO_ROOT / "scripts" / "populator" / "data" / "omd"
BIOSAMPLE_METADATA_PATH = OMD_DIR / "omd_biosample_metadata.tsv"
DATASET_MAP_PATH = OMD_DIR / "omd_sample_dataset_map.tsv"
TARA_PHYSICOCHEM_PATH = OMD_DIR / "omd_tara_physicochem.tsv"

BIOSAMPLE_COLUMNS: Tuple[str, ...] = (
    "biosample", "lat", "lon", "location", "collection_date", "depth",
    "temperature", "salinity", "country", "environmental_medium",
)
DATASET_COLUMNS: Tuple[str, ...] = ("biosample", "dataset")

PHYSICOCHEM_COLUMNS: Tuple[str, ...] = (
    "biosample", "temperature", "salinity", "dissolved_oxygen", "conductivity",
    "nitrate", "nitrite", "phosphate", "silicate", "chlorophyll",
)
# (source, value column, unit column, unit). Fixed PANGAEA source units, no conversion;
# samples has no temperature_unit.
_PHYSICOCHEM_DIRECT: Tuple[Tuple[str, str, Optional[str], Optional[str]], ...] = (
    ("temperature",      "temperature",      None,                    None),
    ("salinity",         "salinity",         "salinity_unit",         "psu"),
    ("dissolved_oxygen", "dissolved_oxygen", "dissolved_oxygen_unit", "µmol/kg"),
    ("conductivity",     "conductivity",     "conductivity_unit",     "mS/cm"),
    ("nitrate",          "nitrate",          "nitrate_unit",          "µmol/L"),
    ("nitrite",          "nitrite",          "nitrite_unit",          "µmol/L"),
    ("phosphate",        "phosphate",        "phosphate_unit",        "µmol/L"),
)
# No dedicated column: stored under metadata.omd_physicochem (µmol/L, mg/m³).
_PHYSICOCHEM_METADATA: Tuple[str, ...] = ("silicate", "chlorophyll")

_ISO_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}")
# The sign is captured so negative depths are dropped.
_DEPTH_RE = re.compile(r"[-+]?\d*\.?\d+")
# Metres; also drops the '99999' sentinel.
_DEPTH_MIN, _DEPTH_MAX = 0.0, 11000.0


def _read_named_rows(path: Path, required_columns: Tuple[str, ...]):
    """Map cells by header name, not position, so a reordered writer can't transpose values."""
    with open(path, newline="", encoding="utf-8") as fh:
        reader = csv.reader(fh, delimiter="\t")
        header = next(reader)
        idx = {name: i for i, name in enumerate(header)}
        missing = [c for c in required_columns if c not in idx]
        if missing:
            raise ValueError(
                f"{path.name}: header missing column(s) {missing}; got header {header}"
            )
        for row in reader:
            if not row:
                continue
            if len(row) != len(header):
                raise ValueError(
                    f"{path.name}: ragged row has {len(row)} cells, expected "
                    f"{len(header)}: {row}"
                )
            yield {name: row[i] for name, i in idx.items()}


def load_biosample_metadata(path: Path = BIOSAMPLE_METADATA_PATH) -> Dict[str, dict]:
    out: Dict[str, dict] = {}
    for record in _read_named_rows(path, BIOSAMPLE_COLUMNS):
        record = {c: record[c] for c in BIOSAMPLE_COLUMNS}
        biosample = record["biosample"]
        if biosample in out:
            raise ValueError(f"biosample metadata: duplicate biosample {biosample!r}")
        out[biosample] = record
    return out


def load_dataset_map(path: Path = DATASET_MAP_PATH) -> Dict[str, str]:
    out: Dict[str, str] = {}
    for record in _read_named_rows(path, DATASET_COLUMNS):
        biosample, dataset = record["biosample"], record["dataset"]
        if biosample in out:
            raise ValueError(f"dataset map: duplicate biosample {biosample!r}")
        out[biosample] = dataset
    return out


def _none_if_empty(value: str) -> Optional[str]:
    return value if value != "" else None


def _finite_float(raw: str) -> Optional[float]:
    if raw is None or raw == "":
        return None
    try:
        value = float(raw)
    except ValueError:
        return None
    return value if math.isfinite(value) else None


def _parse_collection_date(raw: str) -> Optional[str]:
    """Partial dates are dropped rather than given fabricated day precision."""
    if not raw:
        return None
    m = _ISO_DATE_RE.match(raw)
    if not m:
        return None
    iso = m.group(0)
    try:
        _date.fromisoformat(iso)   # rejects e.g. 2020-13-40
    except ValueError:
        return None
    return iso


def _parse_depth(raw: str) -> Optional[float]:
    if not raw:
        return None
    m = _DEPTH_RE.search(raw)
    if not m:
        return None
    try:
        depth = float(m.group(0))
    except ValueError:
        return None
    if not math.isfinite(depth):
        return None
    return depth if _DEPTH_MIN <= depth <= _DEPTH_MAX else None


def _environment_feature(depth: Optional[float]) -> Optional[str]:
    if depth is None:
        return None
    if depth < 200:
        return "epipelagic zone (0-200 m)"
    if depth < 1000:
        return "mesopelagic zone (200-1000 m)"
    return "bathypelagic zone (>1000 m)"


def _metadata_json(biosample: str, dataset: Optional[str]) -> str:
    """``biosample`` stays top-level to match the omd-v2 capture in mag.py."""
    omd_inner: Dict[str, str] = {}
    if dataset:
        omd_inner["dataset"] = dataset
    return json.dumps({"biosample": biosample, "omd": omd_inner},
                      separators=(",", ":"))


def map_sample_fields(row: dict, dataset: Optional[str]) -> dict:
    """``salinity`` is always None here: ENA carries none for OMD (see physicochem_for)."""
    biosample = row["biosample"]
    lat = _finite_float(row["lat"])
    lon = _finite_float(row["lon"])
    depth = _parse_depth(row["depth"])

    return {
        "latitude": lat,
        "longitude": lon,
        "depth": depth,
        "temperature": _finite_float(row["temperature"]),
        "salinity": None,
        "collection_date": _parse_collection_date(row["collection_date"]),
        "geographic_location": _none_if_empty(row["country"]),
        "location_resolution": "point" if lat is not None and lon is not None else None,
        "environment_material": ENVIRONMENT_MATERIAL,
        "environment_biome": ENVIRONMENT_BIOME,
        "environment_feature": _environment_feature(depth),
        "environmental_package": ENVIRONMENTAL_PACKAGE,
        "gold_ecosystem_path": GOLD_ECOSYSTEM_PATH,
        "metadata": _metadata_json(biosample, dataset),
    }


# Loaded once per emit run.
_LOADED: Optional[Tuple[Dict[str, dict], Dict[str, str]]] = None


def _loaded() -> Tuple[Dict[str, dict], Dict[str, str]]:
    global _LOADED
    if _LOADED is None:
        _LOADED = (load_biosample_metadata(), load_dataset_map())
    return _LOADED


def enrichment_for(accession: str) -> Optional[dict]:
    """None when the BioSample is absent, so the caller emits its minimal record."""
    biosample_metadata, dataset_map = _loaded()
    row = biosample_metadata.get(accession)
    if row is None:
        return None
    return map_sample_fields(row, dataset_map.get(accession))


def load_tara_physicochem(path: Path = TARA_PHYSICOCHEM_PATH) -> Dict[str, dict]:
    out: Dict[str, dict] = {}
    for record in _read_named_rows(path, PHYSICOCHEM_COLUMNS):
        record = {c: record[c] for c in PHYSICOCHEM_COLUMNS}
        biosample = record["biosample"]
        if biosample in out:
            raise ValueError(
                f"tara physicochem: duplicate biosample {biosample!r}")
        out[biosample] = record
    return out


_PHYSICOCHEM_LOADED: Optional[Dict[str, dict]] = None


def _loaded_physicochem() -> Dict[str, dict]:
    global _PHYSICOCHEM_LOADED
    if _PHYSICOCHEM_LOADED is None:
        _PHYSICOCHEM_LOADED = load_tara_physicochem()
    return _PHYSICOCHEM_LOADED


def physicochem_for(accession: str) -> Optional[dict]:
    """None outside the ~963 Tara biosamples. Every target key is always present; a unit
    is set only when its value is.
    """
    row = _loaded_physicochem().get(accession)
    if row is None:
        return None

    fields: Dict[str, object] = {}
    for src, value_col, unit_col, unit in _PHYSICOCHEM_DIRECT:
        value = _finite_float(row[src])
        fields[value_col] = value
        if unit_col is not None:
            fields[unit_col] = unit if value is not None else None

    omd_physicochem: Dict[str, float] = {}
    for src in _PHYSICOCHEM_METADATA:
        value = _finite_float(row[src])
        if value is not None:
            omd_physicochem[src] = value
    fields["metadata"] = (
        json.dumps({"omd_physicochem": omd_physicochem}, separators=(",", ":"))
        if omd_physicochem else None
    )
    return fields
