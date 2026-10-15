import pathlib

from scripts.populator.tools.parse_biosample import (
    parse_biosample_set, parse_collection_date, parse_depth, clean_attr,
)

FIX = pathlib.Path(__file__).parent / "fixtures" / "biosample_small.xml"


def test_clean_attr_drops_missing_tokens():
    assert clean_attr("missing") is None
    assert clean_attr("Not Applicable") is None
    assert clean_attr("  ") is None
    assert clean_attr("soil") == "soil"


def test_collection_date_full_vs_partial():
    assert parse_collection_date("1996-09-12") == ("1996-09-12", None)
    assert parse_collection_date("12-Sep-1996") == ("1996-09-12", None)
    assert parse_collection_date("2010-03-05/2010-04-10") == ("2010-03-05", None)
    # year- or month-only stays raw; no fabricated day
    assert parse_collection_date("2010") == (None, "2010")
    assert parse_collection_date("2010-01/2010-12") == (None, "2010-01/2010-12")
    assert parse_collection_date("missing") == (None, None)


def test_depth_single_and_range():
    assert parse_depth("10 m") == {"depth": 10.0}
    assert parse_depth("0-5 m") == {"depth_min_meters": 0.0, "depth_max_meters": 5.0}
    assert parse_depth("surface") == {}


def test_isolate_biosample_date_and_geo():
    d = parse_biosample_set(FIX.read_text())
    s1 = d["SAMN33940546"]
    assert s1["collection_date"] == "1996-09-12"
    assert s1["geographic_location"] == "USA"
    assert s1["_extras"]["isolation_source"] == "soil"


def test_environmental_biosample_all_fields():
    d = parse_biosample_set(FIX.read_text())
    s2 = d["SAMN00000002"]
    assert round(s2["latitude"], 1) == -12.3 and round(s2["longitude"], 1) == -45.6
    assert s2["environment_biome"] == "marine biome"
    assert s2["environment_feature"] == "coastal water"
    assert s2["environment_material"] == "sea water"
    assert s2["host_scientific_name"] == "Homo sapiens"
    assert s2["depth"] == 10.0
    assert "collection_date" not in s2
    assert s2["_extras"]["collection_date_raw"] == "2010"


def test_missing_values_drop_field_and_empty_biosample_omitted():
    d = parse_biosample_set(FIX.read_text())
    # SAMN00000003: geo_loc 'missing' dropped, depth range kept -> present
    assert "geographic_location" not in d["SAMN00000003"]
    assert d["SAMN00000003"]["depth_min_meters"] == 0.0
    # SAMN00000004: only strain + a 'not applicable' geo -> nothing usable -> omitted
    assert "SAMN00000004" not in d


def test_bioproject_links():
    from scripts.populator.tools.parse_biosample import parse_biosample_bioprojects
    d = parse_biosample_bioprojects(FIX.read_text())
    assert d["SAMN33940546"] == "PRJNA544527"
    assert d["SAMN00000002"] == "PRJNA999999"     # prefers non-umbrella over PRJNA224116
    assert "SAMN00000003" not in d
