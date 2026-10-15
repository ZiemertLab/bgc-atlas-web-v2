"""Tests for the OWC (Old Woman Creek) single-site constant enrichment."""
import json

from scripts.populator.adapters import owc_metadata


def test_sample_fields_are_the_owc_wetland_constants():
    f = owc_metadata.sample_fields()
    assert f["gold_ecosystem_path"] == "Environmental:Terrestrial:Soil:Wetlands"
    assert f["latitude"] == 41.38 and f["longitude"] == -82.51
    assert f["location_resolution"] == "point"
    assert f["geographic_location"] == "USA: Ohio"
    assert f["environment_biome"] == "freshwater wetland"
    assert f["environment_feature"] == "wetland soil"


def test_metadata_is_valid_json_with_owc_site():
    meta = json.loads(owc_metadata.sample_fields()["metadata"])
    assert meta["owc"]["ameriflux"] == "US-OWC"


def test_enrichment_for_is_site_uniform_regardless_of_accession():
    assert owc_metadata.enrichment_for("OWC_0001") == owc_metadata.enrichment_for("OWC_2507")
    assert owc_metadata.enrichment_for("OWC_0001") == owc_metadata.sample_fields()


def test_gold_path_is_canonical():
    # normalize_gold_ecosystem_path must be a no-op on the chosen path (already canonical).
    from scripts.populator.core.gold_normalize import normalize_gold_ecosystem_path
    g = owc_metadata.sample_fields()["gold_ecosystem_path"]
    assert normalize_gold_ecosystem_path(g) == g


def test_constants_present():
    assert owc_metadata.OWC_COLLECTION_SLUG == "owc"
    assert owc_metadata.OWC_SOURCE_UUID == "8de83d44-79d4-5ba2-8e31-bdb0df92a858"
    assert owc_metadata.OWC_SOURCE_URL.startswith("https://doi.org/10.1128/msystems.00680-25")
