"""SPIRE MAGs sample-metadata enrichment. No database access.

Resolution is two-step: the SPIRE genome id (e.g. ``spire_mag_00000001``) maps to its
source BioSample (genome_metadata ``derived_from_sample``), then to ENA attributes
(Phase 1, geo only) or microntology tags (Phase 2, :func:`ecosystem_for`). The phases
are independent. Genomes with no BioSample (specI clusters) resolve to None.

Inputs (regenerate with ``tools/prepare_spire_inputs.py``):
  * ``data/spire/spire_accession_biosample.tsv``
  * ``data/spire/spire_biosample_metadata.tsv``
  * ``data/spire/microntology_terms.tsv``
  * ``data/spire/spire_biosample_microntology.tsv``
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Dict, List, Optional, Set, Tuple

from ..core.gold_normalize import normalize_gold_ecosystem_path
from .omd_metadata import (
    _read_named_rows,
    _none_if_empty,
    _finite_float,
    _parse_collection_date,
    _parse_depth,
)

SPIRE_SOURCE_UUID = "39d4c94c-a005-5f46-b75b-4003cce8c01b"
SPIRE_COLLECTION_SLUG = "spire"

REPO_ROOT = Path(__file__).resolve().parents[3]
SPIRE_DIR = REPO_ROOT / "scripts" / "populator" / "data" / "spire"
ACCESSION_BIOSAMPLE_PATH = SPIRE_DIR / "spire_accession_biosample.tsv"
BIOSAMPLE_METADATA_PATH = SPIRE_DIR / "spire_biosample_metadata.tsv"
MICRONTOLOGY_TERMS_PATH = SPIRE_DIR / "microntology_terms.tsv"
BIOSAMPLE_MICRONTOLOGY_PATH = SPIRE_DIR / "spire_biosample_microntology.tsv"

ACCESSION_COLUMNS: Tuple[str, ...] = ("accession", "biosample")
BIOSAMPLE_COLUMNS: Tuple[str, ...] = (
    "biosample", "lat", "lon", "location", "collection_date", "depth",
    "temperature", "country", "environment_biome",
)


def load_accession_biosample(
        path: Path = ACCESSION_BIOSAMPLE_PATH) -> Dict[str, str]:
    out: Dict[str, str] = {}
    for record in _read_named_rows(path, ACCESSION_COLUMNS):
        accession, biosample = record["accession"], record["biosample"]
        if accession in out:
            raise ValueError(
                f"accession->biosample map: duplicate accession {accession!r}")
        out[accession] = biosample
    return out


def load_biosample_metadata(path: Path = BIOSAMPLE_METADATA_PATH) -> Dict[str, dict]:
    out: Dict[str, dict] = {}
    for record in _read_named_rows(path, BIOSAMPLE_COLUMNS):
        record = {c: record[c] for c in BIOSAMPLE_COLUMNS}
        biosample = record["biosample"]
        if biosample in out:
            raise ValueError(f"biosample metadata: duplicate biosample {biosample!r}")
        out[biosample] = record
    return out


def _metadata_json(biosample: str) -> str:
    return json.dumps({"spire": {"biosample": biosample}}, separators=(",", ":"))


def map_sample_fields(ena_row: dict, biosample: str) -> dict:
    """Geo only; the ecosystem comes from ecosystem_for."""
    lat = _finite_float(ena_row["lat"])
    lon = _finite_float(ena_row["lon"])

    return {
        "latitude": lat,
        "longitude": lon,
        "depth": _parse_depth(ena_row["depth"]),
        "temperature": _finite_float(ena_row["temperature"]),
        "collection_date": _parse_collection_date(ena_row["collection_date"]),
        "geographic_location": _none_if_empty(ena_row["country"]),
        "environment_biome": _none_if_empty(ena_row["environment_biome"]),
        "location_resolution": "point" if lat is not None and lon is not None else None,
        "metadata": _metadata_json(biosample),
    }


# Loaded once per emit run.
_LOADED: Optional[Tuple[Dict[str, str], Dict[str, dict]]] = None


def _loaded() -> Tuple[Dict[str, str], Dict[str, dict]]:
    global _LOADED
    if _LOADED is None:
        _LOADED = (load_accession_biosample(), load_biosample_metadata())
    return _LOADED


def enrichment_for(accession: str) -> Optional[dict]:
    """None when there is no BioSample or no ENA row, so the caller emits its minimal record."""
    accession_biosample, biosample_metadata = _loaded()
    biosample = accession_biosample.get(accession)
    if biosample is None:
        return None
    row = biosample_metadata.get(biosample)
    if row is None:
        return None
    return map_sample_fields(row, biosample)


# Phase 2. These crosswalks are hand-validated against the GOLD tree; every value must be
# a real GOLD path. Host-associated terms use HOST_TAXON / HOST_SITE instead.
FLAT_CROSSWALK: Dict[str, str] = {
    'terrestrial': 'Environmental:Terrestrial',
    'terrestrial:soil': 'Environmental:Terrestrial:Soil',
    'terrestrial:arid': 'Environmental:Terrestrial:Desert',
    'terrestrial:grassland': 'Environmental:Terrestrial:Soil:Grasslands',
    'terrestrial:grassland:pasture': 'Environmental:Terrestrial:Soil:Grasslands',
    'terrestrial:cropland': 'Environmental:Terrestrial:Soil:Agricultural',
    'terrestrial:forest': 'Environmental:Terrestrial:Soil:Forest soil',
    'terrestrial:tundra': 'Environmental:Terrestrial:Soil',
    'terrestrial:permafrost': 'Environmental:Terrestrial:Soil:Permafrost',
    'terrestrial:wetland': 'Environmental:Terrestrial:Soil:Wetlands',
    'terrestrial:wetland:salt marsh': 'Environmental:Aquatic:Marine:Intertidal zone:Salt marsh',
    'terrestrial:wetland:mangrove': 'Environmental:Terrestrial:Soil:Wetlands',
    'terrestrial:wetland:peatland': 'Environmental:Terrestrial:Soil:Peat',
    'terrestrial:subsurface': 'Environmental:Terrestrial:Deep subsurface',
    'terrestrial:rock': 'Environmental:Terrestrial:Geologic',
    'aquatic': 'Environmental:Aquatic',
    'aquatic:fresh water': 'Environmental:Aquatic:Freshwater',
    'aquatic:fresh water:lacustrine': 'Environmental:Aquatic:Freshwater:Lake',
    'aquatic:fresh water:lacustrine:lake bed': 'Environmental:Aquatic:Freshwater:Lake:Sediment',
    'aquatic:fresh water:fluvial': 'Environmental:Aquatic:Freshwater:River',
    'aquatic:fresh water:fluvial:stream bed': 'Environmental:Aquatic:Freshwater:Sediment',
    'aquatic:marine': 'Environmental:Aquatic:Marine',
    'aquatic:marine:sea floor': 'Environmental:Aquatic:Marine:Sediment',
    'aquatic:spring': 'Environmental:Aquatic:Thermal springs',
    'aquatic:spring:hot spring': 'Environmental:Aquatic:Thermal springs:Hot (42-90C)',
    'aquatic:spring:hydrothermal vent': 'Environmental:Aquatic:Marine:Hydrothermal vents',
    'aquatic:spring:seep': 'Environmental:Aquatic:Marine:Cold seeps',
    'aquatic:brackish water': 'Environmental:Aquatic:Marine:Brackish',
    'aquatic:brackish water:estuary': 'Environmental:Aquatic:Marine:Intertidal zone:Estuary',
    'aquatic:saline water': 'Environmental:Aquatic:Non-marine Saline and Alkaline',
    'aquatic:briny water': 'Environmental:Aquatic:Non-marine Saline and Alkaline',
    'aquatic:ice': 'Environmental:Aquatic:Freshwater:Ice',
    'aquatic:lentic': 'Environmental:Aquatic:Freshwater:Lentic',
    'aquatic:lotic': 'Environmental:Aquatic:Freshwater:Lotic',
    'aquatic:groundwater': 'Environmental:Aquatic:Freshwater:Groundwater',
    'aquatic:sediment': 'Environmental:Aquatic:Sediment',
    'aquatic:littoral': 'Environmental:Aquatic:Marine:Intertidal zone',
    'aquatic:pelagic': 'Environmental:Aquatic:Marine:Pelagic',
    'aquatic:pelagic:epipelagic': 'Environmental:Aquatic:Marine:Oceanic:Photic zone',
    'aquatic:pelagic:mesopelagic': 'Environmental:Aquatic:Marine:Oceanic:Aphotic zone',
    'aquatic:pelagic:bathypelagic': 'Environmental:Aquatic:Marine:Oceanic:Aphotic zone',
    'aquatic:pelagic:abyssal': 'Environmental:Aquatic:Marine:Oceanic:Aphotic zone',
    'aquatic:pelagic:hadal': 'Environmental:Aquatic:Marine:Oceanic:Aphotic zone',
    'aquatic:benthic': 'Environmental:Aquatic:Marine:Sediment',
    'aquatic:paludal': 'Environmental:Terrestrial:Soil:Wetlands',
    'air': 'Environmental:Air',
    'anthropogenic': 'Engineered',
    'anthropogenic:artificial sample': 'Engineered:Lab enrichment',
    'anthropogenic:artificial sample:mock community': 'Engineered:Modeled:Simulated communities (microbial mixture)',
    'anthropogenic:artificial sample:negative control': 'Engineered:Lab enrichment',
    'anthropogenic:artificial sample:controlled environment': 'Engineered:Lab enrichment',
    'anthropogenic:built environment': 'Engineered:Built environment',
    'anthropogenic:built environment:hospital': 'Engineered:Built environment:Hospital',
    'anthropogenic:wastewater': 'Engineered:Wastewater',
    'anthropogenic:wastewater:sewage': 'Engineered:Wastewater',
    'anthropogenic:wastewater:sludge': 'Engineered:Wastewater:Sludge',
    'anthropogenic:agriculture': 'Environmental:Terrestrial:Soil:Agricultural',
    'anthropogenic:agriculture:crop farming': 'Environmental:Terrestrial:Soil:Agricultural',
    'anthropogenic:agriculture:manure': 'Engineered:Wastewater',
    # 'mine' is a generic mining code, not acid mine drainage.
    'anthropogenic:mine': 'Environmental:Terrestrial:Geologic:Mine',
    'anthropogenic:food': 'Engineered:Food production',
    'anthropogenic:food:fermented food': 'Engineered:Food production:Fermented beverages',
    'anthropogenic:food:dairy product': 'Engineered:Food production:Dairy products',
    'anthropogenic:food:dairy product:cheese': 'Engineered:Food production:Dairy products',
    'anthropogenic:food:meat product': 'Engineered:Food production',
    'anthropogenic:waste': 'Engineered:Solid waste',
    'anthropogenic:waste:compost': 'Engineered:Solid waste:Composting',
}

# Term leaf -> host taxon; the deepest matching term wins ('human host' over 'mammalian host').
HOST_TAXON: Dict[str, str] = {
    'human host': 'Human',
    'mammalian host': 'Mammals',
    'primate host': 'Mammals',
    'porcine host': 'Mammals',
    'ruminant host': 'Mammals',
    'bovine host': 'Mammals',
    'cervid host': 'Mammals',
    'ovine host': 'Mammals',
    'caprine host': 'Mammals',
    'carnivore host': 'Mammals',
    'canine host': 'Mammals',
    'feline host': 'Mammals',
    'ursine host': 'Mammals',
    'reptilian host': 'Reptilia',
    'avian host': 'Birds',
    'insect host': 'Insecta',
    'tick host': 'Arthropoda',
    'fish host': 'Fish',
    'mollusc host': 'Mollusca',
    'coral host': 'Cnidaria',
    'sponge host': 'Porifera',
    'amphibian host': 'Amphibia',
    'plant host': 'Plants',
}

# Term leaf -> body-site suffix; None means a host term with no usable site.
HOST_SITE: Dict[str, Optional[str]] = {
    'digestive tract': 'Digestive system',
    'mouth': 'Digestive system:Oral cavity',
    'saliva': 'Digestive system:Oral cavity:Saliva',
    'ancient dental calculus': 'Digestive system:Oral cavity',
    'stomach': 'Digestive system',
    'rumen': 'Digestive system',
    'intestine': 'Digestive system:Large intestine',
    'feces': 'Digestive system:Large intestine:Fecal',
    'urogenital tract': 'Reproductive system',
    'vagina': 'Reproductive system:Vagina',
    'airways': 'Respiratory system',
    'skin': 'Skin',
    'mucosa': 'Skin',
    'bodily fluid': 'Circulatory system',
    'blood': 'Circulatory system:Blood',
    'cerebrospinal fluid': 'Nervous system',
    'eye': None,
    'breast milk': None,
    'rhizosphere': None,
    'phyllosphere': None,
    'plant litter': None,
}

# Other top-level segments (salinity, ph, ...) are qualifiers, not biomes.
_BIOME_ROOTS = frozenset({"terrestrial", "aquatic", "host-associated", "anthropogenic", "air"})

MICRONTOLOGY_TERMS_COLUMNS: Tuple[str, ...] = ("id", "term", "category")
BIOSAMPLE_MICRONTOLOGY_COLUMNS: Tuple[str, ...] = ("biosample", "microntology")


def load_microntology_terms(
        path: Path = MICRONTOLOGY_TERMS_PATH) -> Tuple[Dict[str, str], Dict[str, str]]:
    code_term: Dict[str, str] = {}
    code_category: Dict[str, str] = {}
    for record in _read_named_rows(path, MICRONTOLOGY_TERMS_COLUMNS):
        code = record["id"]
        if code == "":
            continue  # separator row between sections
        if code in code_term:
            raise ValueError(f"microntology terms: duplicate id {code!r}")
        code_term[code] = record["term"]
        code_category[code] = record["category"]
    return code_term, code_category


def load_biosample_microntology(
        path: Path = BIOSAMPLE_MICRONTOLOGY_PATH) -> Dict[str, List[str]]:
    out: Dict[str, List[str]] = {}
    for record in _read_named_rows(path, BIOSAMPLE_MICRONTOLOGY_COLUMNS):
        biosample = record["biosample"]
        if biosample in out:
            raise ValueError(
                f"biosample microntology: duplicate biosample {biosample!r}")
        codes = [c for c in record["microntology"].split(";") if c.startswith("MICRONT:")]
        out[biosample] = codes
    return out


def _deepest(terms, key_ok) -> Optional[str]:
    """Ties are broken by the term string, for reproducibility."""
    cands = [t for t in terms if key_ok(t.rsplit(":", 1)[-1])]
    if not cands:
        return None
    return max(cands, key=lambda t: (t.count(":"), t))


def _host_gold(host_terms: Set[str]) -> str:
    """A body site with no named host is treated as mammalian."""
    taxon_term = _deepest(host_terms, lambda leaf: leaf in HOST_TAXON)
    site_term = _deepest(host_terms, lambda leaf: HOST_SITE.get(leaf) is not None)
    taxon = HOST_TAXON[taxon_term.rsplit(":", 1)[-1]] if taxon_term else None
    site = HOST_SITE[site_term.rsplit(":", 1)[-1]] if site_term else None
    if taxon and site:
        return f"Host-associated:{taxon}:{site}"
    if taxon:
        return f"Host-associated:{taxon}"
    if site:
        return f"Host-associated:Mammals:{site}"
    return "Host-associated"


def _deepest_flat_path(biome_terms) -> Optional[str]:
    mapped = [t for t in biome_terms if t in FLAT_CROSSWALK]
    if not mapped:
        return None
    return FLAT_CROSSWALK[max(mapped, key=lambda t: (t.count(":"), t))]


# ENVO triad: feature is the deepest biome term's display_term; biome and material come from
# the longest matching prefix.
_ENVO_RULES = [
    ("aquatic:marine:sea floor", "marine biome", "marine sediment"),
    ("aquatic:marine", "marine biome", "sea water"),
    ("aquatic:fresh water:lacustrine:lake bed", "freshwater biome", "freshwater sediment"),
    ("aquatic:fresh water:fluvial:stream bed", "freshwater biome", "freshwater sediment"),
    ("aquatic:fresh water", "freshwater biome", "fresh water"),
    ("aquatic:spring:hydrothermal vent", "marine biome", "hydrothermal vent fluid"),
    ("aquatic:spring:hot spring", "thermal spring biome", "hot spring water"),
    ("aquatic:spring", "aquatic biome", "spring water"),
    ("aquatic:brackish water", "brackish water biome", "brackish water"),
    ("aquatic:saline water", "saline water biome", "saline water"),
    ("aquatic:briny water", "saline water biome", "brine"),
    ("aquatic:ice", "aquatic biome", "ice"),
    ("aquatic:groundwater", "freshwater biome", "groundwater"),
    ("aquatic:sediment", "aquatic biome", "sediment"),
    ("aquatic:benthic", "marine biome", "marine sediment"),
    ("aquatic:littoral", "marine biome", "sea water"),
    ("aquatic:pelagic", "marine biome", "sea water"),
    ("aquatic:lentic", "freshwater biome", "fresh water"),
    ("aquatic:lotic", "freshwater biome", "fresh water"),
    ("aquatic:paludal", "wetland biome", "wetland water"),
    ("aquatic", "aquatic biome", "water"),
    ("terrestrial:soil", "terrestrial biome", "soil"),
    ("terrestrial:forest", "forest biome", "forest soil"),
    ("terrestrial:grassland", "grassland biome", "grassland soil"),
    ("terrestrial:cropland", "cropland biome", "agricultural soil"),
    ("terrestrial:tundra", "tundra biome", "tundra soil"),
    ("terrestrial:permafrost", "tundra biome", "permafrost"),
    ("terrestrial:arid", "desert biome", "desert soil"),
    ("terrestrial:wetland:peatland", "wetland biome", "peat"),
    ("terrestrial:wetland:mangrove", "mangrove biome", "mangrove soil"),
    ("terrestrial:wetland:salt marsh", "marsh biome", "salt marsh soil"),
    ("terrestrial:wetland", "wetland biome", "wetland soil"),
    ("terrestrial:subsurface", "terrestrial biome", "subsurface material"),
    ("terrestrial:rock", "terrestrial biome", "rock"),
    ("terrestrial", "terrestrial biome", "soil"),
    ("host-associated:plant host", "plant-associated habitat", "plant material"),
    ("host-associated:animal host:digestive tract:intestine:feces",
     "host-associated habitat", "feces"),
    ("host-associated:animal host:digestive tract:intestine",
     "host-associated habitat", "intestinal content"),
    ("host-associated:animal host:digestive tract:mouth", "host-associated habitat", "oral material"),
    ("host-associated:animal host:digestive tract", "host-associated habitat", "gut content"),
    ("host-associated:animal host:bodily fluid:blood", "host-associated habitat", "blood"),
    ("host-associated:animal host:bodily fluid", "host-associated habitat", "bodily fluid"),
    ("host-associated:animal host:skin", "host-associated habitat", "skin material"),
    ("host-associated:animal host:airways", "host-associated habitat", "respiratory material"),
    ("host-associated:animal host:urogenital tract",
     "host-associated habitat", "urogenital material"),
    ("host-associated:animal host:mucosa", "host-associated habitat", "mucosal material"),
    ("host-associated:animal host", "host-associated habitat", "host tissue"),
    ("host-associated", "host-associated habitat", "host material"),
    ("anthropogenic:wastewater:sludge", "anthropogenic biome", "sludge"),
    ("anthropogenic:wastewater", "anthropogenic biome", "wastewater"),
    ("anthropogenic:built environment", "urban biome", "surface material"),
    ("anthropogenic:agriculture", "agricultural biome", "agricultural soil"),
    ("anthropogenic:food", "anthropogenic biome", "food product"),
    ("anthropogenic:waste:compost", "anthropogenic biome", "compost"),
    ("anthropogenic:waste", "anthropogenic biome", "waste material"),
    ("anthropogenic:mine", "anthropogenic biome", "mine material"),
    ("anthropogenic:artificial sample", "anthropogenic biome", "laboratory material"),
    ("anthropogenic", "anthropogenic biome", "anthropogenic material"),
    ("air", "air", "air"),
]
_ENVO_RULES.sort(key=lambda r: -len(r[0]))

_DISPLAY_LOADED: Optional[Dict[str, str]] = None


def load_microntology_display(path: Path = MICRONTOLOGY_TERMS_PATH) -> Dict[str, str]:
    global _DISPLAY_LOADED
    if _DISPLAY_LOADED is None:
        import csv as _csv
        out: Dict[str, str] = {}
        with open(path, newline="", encoding="utf-8") as fh:
            for row in _csv.DictReader(fh, delimiter="\t"):
                term = (row.get("term") or "").strip()
                disp = (row.get("display_term") or "").strip()
                if term:
                    out[term] = disp or term.rsplit(":", 1)[-1]
        _DISPLAY_LOADED = out
    return _DISPLAY_LOADED


def _envo_for_term(term: str) -> Optional[dict]:
    for prefix, biome, material in _ENVO_RULES:
        if term == prefix or term.startswith(prefix + ":"):
            feature = load_microntology_display().get(term) or term.rsplit(":", 1)[-1]
            return {"environment_biome": biome, "environment_feature": feature,
                    "environment_material": material}
    return None


def envo_for(accession: str) -> Optional[dict]:
    biosample = _loaded()[0].get(accession)
    if not biosample:
        return None
    codes = _biosample_micront_loaded().get(biosample)
    if not codes:
        return None
    code_term, _ = _terms_loaded()
    terms = {code_term[c] for c in codes if c in code_term}
    biome_terms = [t for t in terms if t.split(":", 1)[0] in _BIOME_ROOTS]
    if not biome_terms:
        return None
    deepest = max(biome_terms, key=lambda t: (t.count(":"), t))
    return _envo_for_term(deepest)


def derive_gold(codes: List[str]) -> Optional[str]:
    """Any host term makes the sample host-associated, unless that yields a bare
    ``Host-associated`` and a specific environmental term exists. Normalized like registry
    finalize(), so ingest and backfill agree.
    """
    code_term, _ = _terms_loaded()
    terms = {code_term[c] for c in codes if c in code_term}
    biome_terms = {t for t in terms if t.split(":", 1)[0] in _BIOME_ROOTS}
    if not biome_terms:
        return None
    host = {t for t in biome_terms if t.startswith("host-associated")}
    if host:
        path = _host_gold(host)
        if path == "Host-associated":
            fallback = _deepest_flat_path(biome_terms)
            if fallback is not None:
                path = fallback
    else:
        path = _deepest_flat_path(biome_terms)
    return normalize_gold_ecosystem_path(path)


_TERMS_LOADED: Optional[Tuple[Dict[str, str], Dict[str, str]]] = None
_BIOSAMPLE_MICRONT_LOADED: Optional[Dict[str, List[str]]] = None


def _terms_loaded() -> Tuple[Dict[str, str], Dict[str, str]]:
    global _TERMS_LOADED
    if _TERMS_LOADED is None:
        _TERMS_LOADED = load_microntology_terms()
    return _TERMS_LOADED


def _biosample_micront_loaded() -> Dict[str, List[str]]:
    global _BIOSAMPLE_MICRONT_LOADED
    if _BIOSAMPLE_MICRONT_LOADED is None:
        _BIOSAMPLE_MICRONT_LOADED = load_biosample_microntology()
    return _BIOSAMPLE_MICRONT_LOADED


def ecosystem_for(accession: str) -> Optional[dict]:
    accession_biosample, _ = _loaded()
    biosample = accession_biosample.get(accession)
    if biosample is None:
        return None
    codes = _biosample_micront_loaded().get(biosample)
    if not codes:
        return None
    gold = derive_gold(codes)
    if gold is None:
        return None
    code_term, _ = _terms_loaded()
    micront_terms = sorted({code_term[c] for c in codes if c in code_term})
    return {
        "gold_ecosystem_path": gold,
        "metadata": json.dumps({"microntology": micront_terms}, separators=(",", ":")),
    }
