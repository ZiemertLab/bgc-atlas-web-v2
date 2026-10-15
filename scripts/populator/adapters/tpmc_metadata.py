"""Tibetan Plateau Microbial Catalog (TPMC) sample-metadata enrichment. No database access.

TPMC is entirely aquatic, so an unknown biome falls back to ``Environmental:Aquatic``.
``samples.accession`` is ``<sample_id>_bin.<n>``; metadata is per sample, joined on the
sample_id with the ``_bin.<n>`` suffix stripped.

Input (regenerate with ``tools/prepare_tpmc_inputs.py``):
  * ``data/tpmc/tpmc_sample_metadata.tsv``
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Dict, Optional

from ..core.gold_normalize import normalize_gold_ecosystem_path
from .omd_metadata import _read_named_rows, _finite_float

TPMC_SOURCE_UUID = "ef649825-b2ff-52d9-bc55-bf92078a6a5d"
TPMC_COLLECTION_SLUG = "tpmc"
TPMC_SOURCE_URL = "https://ngdc.cncb.ac.cn/tpmc"

# Validated against the GOLD ecosystem tree. Unlisted labels take the aquatic default.
BIOME_TO_GOLD: Dict[str, str] = {
    "Wetland": "Environmental:Aquatic:Freshwater:Wetlands",
    "River": "Environmental:Aquatic:Freshwater:River",
    "Saline lake": "Environmental:Aquatic:Non-marine Saline and Alkaline:Saline lake",
    "Hotspring": "Environmental:Aquatic:Thermal springs:Hot (42-90C)",
    "Freshwater lake": "Environmental:Aquatic:Freshwater:Lake",
    "Glacier": "Environmental:Aquatic:Freshwater:Glacier",
}
_TPMC_DEFAULT_GOLD = "Environmental:Aquatic"

_BIOME_TO_GOLD_CI: Dict[str, str] = {
    label.strip().lower(): path for label, path in BIOME_TO_GOLD.items()
}

REPO_ROOT = Path(__file__).resolve().parents[3]
TPMC_DIR = REPO_ROOT / "scripts" / "populator" / "data" / "tpmc"
SAMPLE_METADATA_PATH = TPMC_DIR / "tpmc_sample_metadata.tsv"

SAMPLE_COLUMNS = (
    "sample_id", "biosample", "location", "region", "biome", "latitude", "longitude",
    "altitude", "depth_m", "ph", "temperature_c", "salinity_psu", "do_mg_l", "do_pct",
    "no3_mg_l", "no2_mg_l", "nh4_mg_l", "dip_mg_l", "tp_mg_l", "tn_mg_l", "toc_mg_l",
    "turbidity_ntu", "tds_mg_l", "chlorophyll_ug_l", "cl_mg_l", "so4_mg_l", "na_mg_l",
)

_TPMC_META_FIELDS = ("biosample", "region", "location", "biome", "altitude")

# No dedicated samples column: stored under metadata.tpmc.physicochem as (key, source column).
_TPMC_META_PHYSICOCHEM = (
    ("total_phosphorus", "tp_mg_l"),
    ("total_nitrogen", "tn_mg_l"),
    ("toc", "toc_mg_l"),
    ("turbidity", "turbidity_ntu"),
    ("tds", "tds_mg_l"),
    ("chlorophyll", "chlorophyll_ug_l"),
    ("chloride", "cl_mg_l"),
    ("sulfate", "so4_mg_l"),
    ("sodium", "na_mg_l"),
    ("do_pct", "do_pct"),
)


def _valid_latlon(lat: Optional[float], lon: Optional[float]) -> bool:
    """Guards against lat/lon-swapped source rows (e.g. a 99.85 'latitude')."""
    return (lat is not None and lon is not None
            and -90.0 <= lat <= 90.0 and -180.0 <= lon <= 180.0)


def _gold_for_biome(biome: Optional[str]) -> str:
    """Normalized like registry finalize(), so ingest and backfill agree. Never None."""
    path = _BIOME_TO_GOLD_CI.get((biome or "").strip().lower(), _TPMC_DEFAULT_GOLD)
    return normalize_gold_ecosystem_path(path)


def load_sample_metadata(path: Path = SAMPLE_METADATA_PATH) -> Dict[str, dict]:
    out: Dict[str, dict] = {}
    for record in _read_named_rows(path, SAMPLE_COLUMNS):
        record = {c: record[c] for c in SAMPLE_COLUMNS}
        sample_id = record["sample_id"]
        if sample_id in out:
            raise ValueError(f"tpmc sample metadata: duplicate sample_id {sample_id!r}")
        out[sample_id] = record
    return out


def _metadata_json(row: dict) -> str:
    """Always valid JSON (``{"tpmc":{}}`` at worst): samples.metadata is NOT NULL."""
    tpmc_inner: Dict[str, object] = {}
    for key in _TPMC_META_FIELDS:
        value = row.get(key, "")
        if value != "":
            tpmc_inner[key] = value

    physicochem: Dict[str, float] = {}
    for key, col in _TPMC_META_PHYSICOCHEM:
        value = _finite_float(row[col])
        if value is not None:
            physicochem[key] = value
    if physicochem:
        tpmc_inner["physicochem"] = physicochem

    return json.dumps({"tpmc": tpmc_inner}, separators=(",", ":"))


def map_sample_fields(row: dict) -> dict:
    """Only resolved keys are returned (always ``gold_ecosystem_path`` and ``metadata``), so
    the backfill's COALESCE keeps any existing value for the rest.
    """
    fields: dict = {}

    lat = _finite_float(row["latitude"])
    lon = _finite_float(row["longitude"])
    if _valid_latlon(lat, lon):
        fields["latitude"] = lat
        fields["longitude"] = lon
        fields["location_resolution"] = "point"

    fields["gold_ecosystem_path"] = _gold_for_biome(row["biome"])

    geoloc = row["location"] or row["region"] or None
    if geoloc is not None:
        fields["geographic_location"] = geoloc

    # The source has negative depths and pH > 14.
    depth = _finite_float(row["depth_m"])
    if depth is not None and depth >= 0.0:
        fields["depth"] = depth
    ph = _finite_float(row["ph"])
    if ph is not None and 0.0 <= ph <= 14.0:
        fields["ph"] = ph
    temperature = _finite_float(row["temperature_c"])
    if temperature is not None:
        fields["temperature"] = temperature

    # samples_salinity_unit_check requires lowercase 'psu'.
    salinity = _finite_float(row["salinity_psu"])
    if salinity is not None:
        fields["salinity"] = salinity
        fields["salinity_unit"] = "psu"
    dissolved_oxygen = _finite_float(row["do_mg_l"])
    if dissolved_oxygen is not None:
        fields["dissolved_oxygen"] = dissolved_oxygen
        fields["dissolved_oxygen_unit"] = "mg/L"
    nitrate = _finite_float(row["no3_mg_l"])
    if nitrate is not None:
        fields["nitrate"] = nitrate
        fields["nitrate_unit"] = "mg/L"

    nitrite = _finite_float(row["no2_mg_l"])
    if nitrite is not None:
        fields["nitrite"] = nitrite
    ammonium = _finite_float(row["nh4_mg_l"])
    if ammonium is not None:
        fields["ammonium"] = ammonium
    phosphate = _finite_float(row["dip_mg_l"])
    if phosphate is not None:
        fields["phosphate"] = phosphate

    fields["metadata"] = _metadata_json(row)
    return fields


# Loaded once per emit run.
_LOADED: Optional[Dict[str, dict]] = None


def _loaded() -> Dict[str, dict]:
    global _LOADED
    if _LOADED is None:
        _LOADED = load_sample_metadata()
    return _LOADED


def enrichment_for(accession: str) -> Optional[dict]:
    """None when the sample_id is absent, so the caller emits its minimal record."""
    sample = _loaded().get(accession.rsplit("_bin.", 1)[0])
    if sample is None:
        return None
    return map_sample_fields(sample)
