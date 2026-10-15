"""Metadata enrichment for the small custom MAG sources."""
import csv
import json
import os

from ..core.gold_normalize import normalize_gold_ecosystem_path

_DATA = os.path.join(os.path.dirname(__file__), "..", "data", "customs")

# custom_deep_sea_hydrothermal: DSV70. Per-sample geo from Table S1
# (dsv70_sample_metadata.tsv; accession == Metagenome ID).
DEEP_SEA_UUID = "9c50ad07-5b16-54b9-ad3e-a0a3463c19ad"
DEEP_SEA_URL = "https://doi.org/10.1038/s41597-026-06612-w"
_DSV70_GOLD = normalize_gold_ecosystem_path("Environmental:Aquatic:Marine:Hydrothermal vents")
_dsv70 = None


def _load_dsv70():
    global _dsv70
    if _dsv70 is None:
        with open(os.path.join(_DATA, "dsv70_sample_metadata.tsv"), newline="") as fh:
            _dsv70 = {r["accession"]: r for r in csv.DictReader(fh, delimiter="\t")}
    return _dsv70


def _num(x):
    try:
        return float(x)
    except (TypeError, ValueError):
        return None


def _deep_sea(accession):
    r = _load_dsv70().get(accession)
    if not r:
        return None
    lat, lon = _num(r.get("latitude")), _num(r.get("longitude"))
    depth = _num(r.get("depth_mbsl"))
    meta = {"dsv70": {k: r[k] for k in ("site", "vent_field", "biosample", "year")
                      if r.get(k)}}
    f = {"gold_ecosystem_path": _DSV70_GOLD,
         "environment_biome": "marine",
         "environment_feature": "hydrothermal vent",
         "environment_material": "hydrothermal deposit",
         "geographic_location": r.get("site") or None,
         "metadata": json.dumps(meta, separators=(",", ":"))}
    if lat is not None and -90 <= lat <= 90 and lon is not None and -180 <= lon <= 180:
        f["latitude"], f["longitude"], f["location_resolution"] = lat, lon, "point"
    if depth is not None and depth >= 0:
        f["depth"] = depth
    return f


# custom_fram_ras: single station F4, RAS nominal depth 21 m. Accession is
# FRAM_RAS_F4_<n>_<yearcode>[_<m>]; yearcode is 1718 (=2017/18) etc., or a plain year.
FRAM_UUID = "0b5d57bb-54ed-597f-a634-141f781c3d84"
FRAM_URL = "https://doi.org/10.1594/PANGAEA.946508"
_FRAM_GOLD = normalize_gold_ecosystem_path("Environmental:Aquatic:Marine")


def _fram_year(accession):
    parts = accession.split("_")
    if len(parts) < 5:
        return None
    code = parts[4]
    if not code.isdigit():
        return None
    n = int(code)
    if 2000 <= n <= 2100:
        return n
    if len(code) == 4:              # 1718 -> 2017
        return 2000 + int(code[:2])
    return None


def _fram(accession):
    year = _fram_year(accession)
    meta = {"fram_ras": {"station": "F4", "observatory": "FRAM/HAUSGARTEN"}}
    if year:
        meta["fram_ras"]["deployment_year"] = year
    return {"latitude": 79.01, "longitude": 6.96, "depth": 21.0,
            "gold_ecosystem_path": _FRAM_GOLD, "location_resolution": "point",
            "geographic_location": "Arctic Ocean: Fram Strait",
            "environment_biome": "marine", "environment_feature": "pelagic",
            "metadata": json.dumps(meta, separators=(",", ":"))}


# custom_ocean_surface: HaDS, Kane'ohe Bay. HP1/xHP1 = coastal; STO1 = adjacent offshore.
OCEAN_UUID = "d5d37074-511c-5f72-9603-b2952eaf2856"
OCEAN_URL = "https://doi.org/10.1093/ismejo/wraf133"
_OCEAN_GOLD = normalize_gold_ecosystem_path("Environmental:Aquatic:Marine")
_OCEAN_SITES = {
    "HP1": (21.43, -157.79), "STO1": (21.47, -157.81),
}


def _ocean(accession):
    site = accession.lstrip("x").split("-")[0]  # xHP1-SR-COASSEMBLY -> HP1
    latlon = _OCEAN_SITES.get(site)
    if not latlon:
        return None
    read = "long-read" if "-LR-" in accession else "short-read"
    meta = {"ocean_surface": {"site": site, "location": "Kaneohe Bay, Oahu, Hawaii",
                              "read_type": read, "study": "HaDS"}}
    return {"latitude": latlon[0], "longitude": latlon[1], "depth": 0.25,
            "gold_ecosystem_path": _OCEAN_GOLD, "location_resolution": "point",
            "geographic_location": "USA: Hawaii", "collection_date": "2021-08-19",
            "environment_biome": "marine", "environment_feature": "sea surface water",
            "metadata": json.dumps(meta, separators=(",", ":"))}


# custom_ziemert_lab samples already carry gold+coords; only paper provenance is added.
ZIEMERT_UUID = "91226091-503f-5832-ad29-bbf3006be0f1"
ZIEMERT_URL = "https://doi.org/10.1093/gigascience/giaf135"
_ZIEMERT_PAPER = {
    "zl_schoenbuch_2021": "https://doi.org/10.1128/msystems.01018-21",
    "ZL-schoenbuch-ultra-deep": "https://doi.org/10.1093/gigascience/giaf135",
}


def _ziemert(accession):
    paper = _ZIEMERT_PAPER.get(accession)
    if not paper:
        return None
    return {"metadata": json.dumps({"ziemert": {"paper": paper}}, separators=(",", ":"))}


# custom_great_barrier_reef (27) and custom_helgoland_2020 (34) -- long-read assemblies of public
# ENA BioSamples. Per-sample values copied from the BioSample XML into TSVs
# (tools/build_custom_biosample_tsv.py), joined on the assembly accession. Unlike the four above,
# these are applied AT EMIT (EMIT_SOURCES): the custom adapter merges them into the samples rows
# and the data source.
#   GBR: Robbins et al., Nature 2026; reef-associated seawater, ONT+Illumina hybrid; the BioSamples
#        are virtual, each pooling several physical samples (kept in metadata).
#   Helgoland: Helgoland Roads spring bloom 2020, 30 PacBio HiFi + 4 Illumina; Orellana et al.
#        2023 Microbiome.
GBR_UUID = "1e2aaac6-667b-5ecd-936b-90628ffd04f6"
GBR_URL = "https://doi.org/10.1038/s41586-026-10778-z"
_GBR_GOLD = normalize_gold_ecosystem_path("Environmental:Aquatic:Marine:Intertidal zone:Coral reef")
HELGOLAND_UUID = "286bd069-300c-5a12-8b9a-e23548277aa4"
HELGOLAND_URL = "https://doi.org/10.1186/s40168-023-01557-3"
_HELGOLAND_GOLD = normalize_gold_ecosystem_path("Environmental:Aquatic:Marine:Coastal")
_biosample_tables = {}


def _biosample_table(name):
    if name not in _biosample_tables:
        with open(os.path.join(_DATA, f"{name}_sample_metadata.tsv"), newline="", encoding="utf-8") as fh:
            _biosample_tables[name] = {r["assembly"]: r for r in csv.DictReader(fh, delimiter="\t")}
    return _biosample_tables[name]


def _from_biosample(table, gold, accession):
    r = _biosample_table(table).get(accession)
    if not r:
        return None
    meta = {"biosample": {"project_name": r["project_name"]} if r.get("project_name") else {}}
    for k, v in (json.loads(r["extra"]) if r.get("extra") else {}).items():
        meta["biosample"].setdefault(k, v)
    # the platform is from the load request (ENA run/assembly records), not the BioSample
    if r.get("platform"):
        meta["sequencing_platform"] = r["platform"]
    f = {"accession": r["biosample"], "sample_alias": r.get("title") or None,
         "gold_ecosystem_path": gold,
         "geographic_location": r.get("country") or None,
         "collection_date": r.get("collection_date") or None,
         "environment_biome": r.get("environment_biome") or None,
         "environment_feature": r.get("environment_feature") or None,
         "environment_material": r.get("environment_material") or None,
         "metadata": json.dumps(meta, separators=(",", ":"), ensure_ascii=False)}
    lat, lon, depth = _num(r.get("latitude")), _num(r.get("longitude")), _num(r.get("depth_m"))
    if lat is not None and -90 <= lat <= 90 and lon is not None and -180 <= lon <= 180:
        f["latitude"], f["longitude"], f["location_resolution"] = lat, lon, "point"
    if depth is not None and depth >= 0:
        f["depth"] = depth
    return {k: v for k, v in f.items() if v is not None}


def _gbr(accession):
    return _from_biosample("great_barrier_reef", _GBR_GOLD, accession)


def _helgoland(accession):
    return _from_biosample("helgoland_2020", _HELGOLAND_GOLD, accession)


SOURCES = {
    "custom_deep_sea_hydrothermal": (DEEP_SEA_UUID, DEEP_SEA_URL, _deep_sea),
    "custom_fram_ras": (FRAM_UUID, FRAM_URL, _fram),
    "custom_ocean_surface": (OCEAN_UUID, OCEAN_URL, _ocean),
    "custom_ziemert_lab": (ZIEMERT_UUID, ZIEMERT_URL, _ziemert),
    "custom_great_barrier_reef": (GBR_UUID, GBR_URL, _gbr),
    "custom_helgoland_2020": (HELGOLAND_UUID, HELGOLAND_URL, _helgoland),
}
# Sources whose enrichment the custom adapter applies at emit time. Every archive of one of these
# must have a metadata row: a missing one raises, which populate.py records as a failed archive
# (the run exits non-zero unless --allow-partial; load_cohort's --expect then still stops a short emit).
EMIT_SOURCES = frozenset({"custom_great_barrier_reef", "custom_helgoland_2020"})


def enrichment_for(source_name: str, accession: str):
    entry = SOURCES.get(source_name)
    if not entry:
        return None
    return entry[2](accession)


def emit_enrichment(source_name: str, accession: str):
    """(sample fields, source_url) for an EMIT_SOURCES archive; None for every other source.
    Raises KeyError when an EMIT_SOURCES archive has no metadata row."""
    if source_name not in EMIT_SOURCES:
        return None
    fields = enrichment_for(source_name, accession)
    if fields is None:
        raise KeyError(f"{source_name}: no metadata row for {accession!r}")
    return fields, SOURCES[source_name][1]
