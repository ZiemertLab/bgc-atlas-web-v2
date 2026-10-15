"""Tests for the small custom-source enrichments (deep-sea, FRAM, ocean-surface, ziemert)."""
import json

from scripts.populator.adapters import customs_metadata as cm


def test_deep_sea_per_sample_from_table_s1():
    f = cm.enrichment_for("custom_deep_sea_hydrothermal", "299-1b")  # Kairei, CIR
    assert f["gold_ecosystem_path"] == "Environmental:Aquatic:Marine:Hydrothermal vents"
    assert f["latitude"] == -25.3205 and f["longitude"] == 70.0403
    assert f["depth"] == 2400.0 and f["location_resolution"] == "point"
    assert json.loads(f["metadata"])["dsv70"]["vent_field"] == "Kairei"


def test_deep_sea_unknown_accession_is_none():
    assert cm.enrichment_for("custom_deep_sea_hydrothermal", "nope") is None


def test_fram_uniform_f4_with_year_from_accession():
    f = cm.enrichment_for("custom_fram_ras", "FRAM_RAS_F4_04_1819_2")
    assert f["latitude"] == 79.01 and f["longitude"] == 6.96 and f["depth"] == 21.0
    assert f["gold_ecosystem_path"] == "Environmental:Aquatic:Marine"
    assert json.loads(f["metadata"])["fram_ras"]["deployment_year"] == 2018


def test_fram_plain_year_code():
    assert cm._fram_year("FRAM_RAS_F4_11_2016") == 2016
    assert cm._fram_year("FRAM_RAS_F4_01_1718") == 2017


def test_ocean_surface_site_coords():
    hp1 = cm.enrichment_for("custom_ocean_surface", "xHP1-SR-COASSEMBLY")
    sto1 = cm.enrichment_for("custom_ocean_surface", "STO1-LR-COASSEMBLY")
    assert hp1["latitude"] == 21.43 and sto1["latitude"] == 21.47
    assert hp1["gold_ecosystem_path"] == "Environmental:Aquatic:Marine"
    assert json.loads(hp1["metadata"])["ocean_surface"]["site"] == "HP1"
    assert json.loads(sto1["metadata"])["ocean_surface"]["read_type"] == "long-read"


def test_ziemert_adds_paper_provenance_only():
    f = cm.enrichment_for("custom_ziemert_lab", "zl_schoenbuch_2021")
    assert set(f) == {"metadata"}  # only metadata (already has gold/coords)
    assert "msystems" in json.loads(f["metadata"])["ziemert"]["paper"]


def test_all_gold_paths_canonical():
    from scripts.populator.core.gold_normalize import normalize_gold_ecosystem_path
    for acc, src in [("299-1b", "custom_deep_sea_hydrothermal"),
                     ("FRAM_RAS_F4_01_1718", "custom_fram_ras"),
                     ("STO1-SR-COASSEMBLY", "custom_ocean_surface")]:
        g = cm.enrichment_for(src, acc)["gold_ecosystem_path"]
        assert normalize_gold_ecosystem_path(g) == g


def test_gbr_and_helgoland_ids_are_their_data_source_ids():
    from scripts.populator.ids import entity_id
    assert cm.GBR_UUID == str(entity_id("data_sources", "custom_great_barrier_reef"))
    assert cm.HELGOLAND_UUID == str(entity_id("data_sources", "custom_helgoland_2020"))


def test_gbr_sample_from_biosample_table():
    f = cm.enrichment_for("custom_great_barrier_reef", "ERZ28548055")
    assert f["accession"] == "SAMEA120372103" and f["sample_alias"] == "11-049-vs"
    assert f["gold_ecosystem_path"] == "Environmental:Aquatic:Marine:Intertidal zone:Coral reef"
    assert (f["latitude"], f["longitude"], f["depth"]) == (-11.35312, 143.32346, 3.1)
    assert f["collection_date"] == "2019-11-25" and f["geographic_location"] == "Australia"
    assert f["environment_material"] == "seawater" and "environment_feature" not in f  # not in the BioSample
    meta = json.loads(f["metadata"])["biosample"]
    assert meta["Reef sector"] == "Cape Grenville" and "platform" not in meta
    assert json.loads(f["metadata"])["sequencing_platform"] == "ONT+Illumina hybrid"
    assert meta["sample composed of"].startswith("ERS25322853,")


def test_helgoland_sample_strips_envo_ids_and_keeps_platform():
    f = cm.enrichment_for("custom_helgoland_2020", "ERZ10645735")
    assert f["accession"] == "SAMEA14431080"
    assert f["gold_ecosystem_path"] == "Environmental:Aquatic:Marine:Coastal"
    assert f["environment_biome"] == "marine biome" and f["environment_material"] == "coastal sea water"
    assert f["depth"] == 1.0 and f["geographic_location"] == "North Sea"
    assert json.loads(f["metadata"])["sequencing_platform"] == "PacBio HiFi"


def test_every_gbr_and_helgoland_row_is_complete():
    for table, n in (("great_barrier_reef", 27), ("helgoland_2020", 34)):
        rows = cm._biosample_table(table)
        assert len(rows) == n
        for acc, r in rows.items():
            assert acc.startswith("ERZ") and r["biosample"].startswith("SAMEA")
            assert r["latitude"] and r["longitude"] and r["collection_date"] and r["platform"]


def test_emit_enrichment_only_for_emit_sources():
    assert cm.emit_enrichment("custom_fram_ras", "FRAM_RAS_F4_01_1718") is None
    fields, url = cm.emit_enrichment("custom_helgoland_2020", "ERZ10645735")
    assert url == cm.HELGOLAND_URL and fields["accession"] == "SAMEA14431080"
    import pytest
    with pytest.raises(KeyError, match="ERZ0"):
        cm.emit_enrichment("custom_great_barrier_reef", "ERZ0")



def test_backfill_tool_skips_emit_sources():
    import inspect
    from scripts.populator.tools import backfill_customs_metadata as b
    src = inspect.getsource(b.main)
    assert "if src in customs_metadata.EMIT_SOURCES:" in src and "continue" in src
