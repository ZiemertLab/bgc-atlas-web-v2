"""OWC (Old Woman Creek wetland) constant metadata enrichment.

Each MAG is a dereplicated representative spanning many samples and depths, and the
``OWC_NNNN`` accessions do not map to the paper's MAGs, so all get uniform site metadata.
"""
import json

from ..core.gold_normalize import normalize_gold_ecosystem_path

OWC_SOURCE_UUID = "8de83d44-79d4-5ba2-8e31-bdb0df92a858"
OWC_COLLECTION_SLUG = "owc"
OWC_SOURCE_URL = "https://doi.org/10.1128/msystems.00680-25"

_LATITUDE = 41.38
_LONGITUDE = -82.51
_GOLD = normalize_gold_ecosystem_path("Environmental:Terrestrial:Soil:Wetlands")
_GEOGRAPHIC_LOCATION = "USA: Ohio"
_ENVIRONMENT_BIOME = "freshwater wetland"
_ENVIRONMENT_FEATURE = "wetland soil"
_METADATA = json.dumps(
    {"owc": {"site": "Old Woman Creek wetland", "ameriflux": "US-OWC"}},
    separators=(",", ":"))


def sample_fields() -> dict:
    return {
        "latitude": _LATITUDE,
        "longitude": _LONGITUDE,
        "gold_ecosystem_path": _GOLD,
        "geographic_location": _GEOGRAPHIC_LOCATION,
        "environment_biome": _ENVIRONMENT_BIOME,
        "environment_feature": _ENVIRONMENT_FEATURE,
        "location_resolution": "point",
        "metadata": _METADATA,
    }


def enrichment_for(accession: str | None = None) -> dict:
    return sample_fields()
