"""Global Soil MAGs (SMAG) sample-metadata enrichment. No database access.

Two joins off ``samples.accession`` (the full MAG id, e.g. ``BL1bin.5``): genome QC on the
MAG id itself, geo/ecosystem on the sample key with the ``.<binnum>`` stripped. Every
SMAG genome is soil, so even a QC-only MAG gets the soil GOLD path.

Inputs (regenerate with ``tools/prepare_smag_inputs.py``):
  * ``data/smag/smag_sample_metadata.tsv``
  * ``data/smag/smag_genome_qc.tsv``
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Dict, Optional, Tuple

from ..core.gold_normalize import normalize_gold_ecosystem_path
from .gem_metadata import _read_named_rows, _finite_float, _none_if_empty

SMAG_SOURCE_UUID = "76515336-6be8-5622-9e97-0125b09bd407"
SMAG_COLLECTION_SLUG = "smag"
SMAG_SOURCE_URL = "https://microbma.github.io/project/SMAG.html"

# Validated against the GOLD ecosystem tree. Unlisted labels take the soil default.
ECOSYSTEM_TO_GOLD: Dict[str, str] = {
    "Agricultural Land": "Environmental:Terrestrial:Soil:Agricultural land",
    "Forest": "Environmental:Terrestrial:Soil:Forest soil",
    "Grassland": "Environmental:Terrestrial:Soil:Grasslands",
    "Wetland": "Environmental:Terrestrial:Soil:Wetlands",
    "Tundra": "Environmental:Terrestrial:Soil:Tundra",
    "Shrubland": "Environmental:Terrestrial:Soil:Shrubland",
    "Glacier": "Environmental:Terrestrial:Soil:Glacier",
    "Bare Land": "Environmental:Terrestrial:Soil",
    "Artificial Surfaces": "Environmental:Terrestrial:Soil",
    "Sea": "Environmental:Aquatic:Marine",
}
_SMAG_DEFAULT_GOLD = "Environmental:Terrestrial:Soil"

_ECOSYSTEM_TO_GOLD_CI: Dict[str, str] = {
    label.strip().lower(): path for label, path in ECOSYSTEM_TO_GOLD.items()
}

REPO_ROOT = Path(__file__).resolve().parents[3]
SMAG_DIR = REPO_ROOT / "scripts" / "populator" / "data" / "smag"
SAMPLE_METADATA_PATH = SMAG_DIR / "smag_sample_metadata.tsv"
GENOME_QC_PATH = SMAG_DIR / "smag_genome_qc.tsv"

# user_genome here is the sample key.
SAMPLE_COLUMNS: Tuple[str, ...] = (
    "user_genome", "latitude", "longitude", "ecosystem", "nation", "continent",
    "depth", "biosample", "bioproject", "source", "project",
)
# user_genome here is the full MAG id.
QC_COLUMNS: Tuple[str, ...] = (
    "user_genome", "completeness", "contamination", "length", "classification",
)
_SMAG_META_GEO_FIELDS: Tuple[str, ...] = (
    "biosample", "bioproject", "continent", "source", "project", "ecosystem", "depth",
)


def _gold_for_ecosystem(eco: Optional[str]) -> str:
    """Normalized like registry finalize(), so ingest and backfill agree. Never None."""
    path = _ECOSYSTEM_TO_GOLD_CI.get((eco or "").strip().lower(), _SMAG_DEFAULT_GOLD)
    return normalize_gold_ecosystem_path(path)


def _MIMAG(completeness, contamination) -> Optional[str]:
    """No "low" tier: every SMAG MAG is >= 50% complete / < 10% contaminated by construction."""
    compl = _finite_float(completeness)
    contam = _finite_float(contamination)
    if compl is None or contam is None:
        return None
    return "high" if compl >= 90 and contam <= 5 else "medium"


def load_sample_metadata(path: Path = SAMPLE_METADATA_PATH) -> Dict[str, dict]:
    out: Dict[str, dict] = {}
    for record in _read_named_rows(path, SAMPLE_COLUMNS):
        record = {c: record[c] for c in SAMPLE_COLUMNS}
        user_genome = record["user_genome"]
        if user_genome in out:
            raise ValueError(
                f"smag sample metadata: duplicate user_genome {user_genome!r}")
        out[user_genome] = record
    return out


def load_genome_qc(path: Path = GENOME_QC_PATH) -> Dict[str, dict]:
    out: Dict[str, dict] = {}
    for record in _read_named_rows(path, QC_COLUMNS):
        record = {c: record[c] for c in QC_COLUMNS}
        user_genome = record["user_genome"]
        if user_genome in out:
            raise ValueError(
                f"smag genome qc: duplicate user_genome {user_genome!r}")
        out[user_genome] = record
    return out


# Loaded once per emit run.
_LOADED: Optional[Tuple[Dict[str, dict], Dict[str, dict]]] = None


def _loaded() -> Tuple[Dict[str, dict], Dict[str, dict]]:
    global _LOADED
    if _LOADED is None:
        _LOADED = (load_sample_metadata(), load_genome_qc())
    return _LOADED


def enrichment_for(accession: str) -> Optional[dict]:
    """None only when both joins miss; otherwise only resolved keys, always including
    ``gold_ecosystem_path`` and ``metadata``."""
    sample_metadata, genome_qc = _loaded()
    qc = genome_qc.get(accession)
    geo = sample_metadata.get(accession.rsplit(".", 1)[0])
    if qc is None and geo is None:
        return None

    fields: dict = {}
    smag_meta: dict = {}

    if geo is not None:
        lat = _finite_float(geo["latitude"])
        lon = _finite_float(geo["longitude"])
        if lat is not None:
            fields["latitude"] = lat
        if lon is not None:
            fields["longitude"] = lon
        fields["gold_ecosystem_path"] = _gold_for_ecosystem(geo["ecosystem"])
        geoloc = _none_if_empty(geo["nation"])
        if geoloc is not None:
            fields["geographic_location"] = geoloc
        if lat is not None and lon is not None:
            fields["location_resolution"] = "point"
        for key in _SMAG_META_GEO_FIELDS:
            value = geo.get(key, "")
            if value != "":
                smag_meta[key] = value
    else:
        # QC-only MAG: still soil.
        fields["gold_ecosystem_path"] = _gold_for_ecosystem("")

    if qc is not None:
        compl = _finite_float(qc["completeness"])
        contam = _finite_float(qc["contamination"])
        if compl is not None:
            fields["checkm_completeness"] = compl
        if contam is not None:
            fields["checkm_contamination"] = contam
        length = _finite_float(qc["length"])
        if length is not None:
            fields["genome_size"] = int(length)
        quality = _MIMAG(qc["completeness"], qc["contamination"])
        if quality is not None:
            fields["genome_quality"] = quality
        taxonomy = qc.get("classification", "")
        if taxonomy != "":
            smag_meta["taxonomy"] = taxonomy

    fields["metadata"] = json.dumps({"smag": smag_meta}, separators=(",", ":"))
    return fields
