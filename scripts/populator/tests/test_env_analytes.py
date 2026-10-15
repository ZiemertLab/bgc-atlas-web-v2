from scripts.populator.adapters.env_analytes import (
    consolidate,
    parse_numeric,
    detect_unit_in_value,
    ALL_SOURCE_KEYS,
)


def test_parse_numeric_plain_range_and_comparator():
    assert parse_numeric("5.2") == 5.2
    assert parse_numeric("5-10") == 7.5          # range -> midpoint
    assert parse_numeric("<0.1") == 0.1          # comparator stripped
    assert parse_numeric("36.34 psu") == 36.34   # embedded unit ignored for value
    assert parse_numeric("") is None
    assert parse_numeric(None) is None
    assert parse_numeric("n/a") is None


def test_salinity_priority_and_units():
    r = consolidate([("salinity", "20"), ("salinity_psu", "36.34")])
    assert r["salinity"] == 36.34
    assert r["salinity_unit"] == "psu"
    r2 = consolidate([("salinity_perc", "2.23")])
    assert r2["salinity"] == 2.23 and r2["salinity_unit"] == "%"
    r3 = consolidate([("salinity", "19")])
    assert r3["salinity"] == 19.0 and r3["salinity_unit"] is None


def test_dissolved_oxygen_excludes_demand_and_categorical():
    r = consolidate([
        ("chemical_oxygen_demand_mg_per_l", "100"),
        ("biological_oxygen_demand_mg_per_l", "5"),
        ("oxygenation_regime", "anaerobic"),
    ])
    assert "dissolved_oxygen" not in r
    r2 = consolidate([("oxygen_um", "230")])
    assert r2["dissolved_oxygen"] == 230.0 and r2["dissolved_oxygen_unit"] == "uM"


def test_phosphate_excludes_phosphorus():
    r = consolidate([("total_phosphorus", "0.5"), ("dissolved_phosphorus_ppm", "1.2")])
    assert "phosphate" not in r
    r2 = consolidate([("phosphate", "0.8")])
    assert r2["phosphate"] == 0.8 and r2["phosphate_unit"] is None


def test_doc_excludes_dic_toc_co2():
    r = consolidate([
        ("dissolved_inorganic_carbon_ppm", "10"),
        ("total_organic_carbon", "3"),
        ("dissolved_carbon_dioxide", "2"),
    ])
    assert "dissolved_organic_carbon" not in r
    r2 = consolidate([("dissolved_organic_carbon_ppm", "5.5")])
    assert r2["dissolved_organic_carbon"] == 5.5
    assert r2["dissolved_organic_carbon_unit"] == "ppm"


def test_nitrate_excludes_combined_and_nitrogen_basis():
    r = consolidate([("nitrate+nitrite", "9"), ("nitrate_nitrogen", "4")])
    assert "nitrate" not in r
    r2 = consolidate([("nitrate_um", "12"), ("nitrate_mg_kg", "3")])
    assert r2["nitrate"] == 12.0 and r2["nitrate_unit"] == "uM"   # uM priority over mg/kg


def test_filtration_single_columns_no_unit_col():
    r = consolidate([
        ("filtration_lower_threshold_um", "0.22"),
        ("filtration_upper_threshold_um", "5"),
        ("filtration_lower_threshold_kda", "30"),   # excluded (kDa)
    ])
    assert r["filtration_lower_threshold_um"] == 0.22
    assert r["filtration_upper_threshold_um"] == 5.0
    assert "filtration_lower_threshold_um_unit" not in r


def test_unit_detected_from_value_when_key_has_no_unit():
    r = consolidate([("oxygen", "6.2 mg/L")])
    assert r["dissolved_oxygen"] == 6.2 and r["dissolved_oxygen_unit"] == "mg/L"


def test_all_source_keys_covers_known_keys():
    assert "salinity_psu" in ALL_SOURCE_KEYS
    assert "oxygen_um" in ALL_SOURCE_KEYS
    assert "chemical_oxygen_demand_mg_per_l" not in ALL_SOURCE_KEYS


def test_detect_unit_in_value():
    assert detect_unit_in_value("230 uM") == "uM"
    assert detect_unit_in_value("5 mg/kg") == "mg/kg"
    assert detect_unit_in_value("no unit here") is None


def test_keys_match_case_insensitively():
    # metalog's newer layout spells the micromolar keys *_uM (was *_um)
    r = consolidate([("oxygen_uM", "210"), ("nitrate_uM", "3.1")])
    assert r["dissolved_oxygen"] == 210.0 and r["dissolved_oxygen_unit"] == "uM"
    assert r["nitrate"] == 3.1 and r["nitrate_unit"] == "uM"
    assert consolidate([("doc", "5")]) == consolidate([("DOC", "5")])


def test_case_folded_duplicate_keys_first_wins_and_priority_holds():
    r = consolidate([("oxygen_um", "1"), ("oxygen_uM", "2")])
    assert r["dissolved_oxygen"] == 1.0
    # a lower-priority key never beats an upper-cased higher-priority one
    r = consolidate([("oxygen_mg_l", "7"), ("OXYGEN_UM", "200")])
    assert r["dissolved_oxygen"] == 200.0 and r["dissolved_oxygen_unit"] == "uM"
