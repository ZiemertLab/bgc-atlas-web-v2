"""Tests for the shared TPMC (Tibetan Plateau Microbial Catalog) metadata adapter.
Integration tests read the real committed TSV; no DB."""
import json

import pytest

from scripts.populator.adapters.tpmc_metadata import (
    TPMC_SOURCE_UUID,
    TPMC_COLLECTION_SLUG,
    TPMC_SOURCE_URL,
    BIOME_TO_GOLD,
    SAMPLE_COLUMNS,
    load_sample_metadata,
    map_sample_fields,
    enrichment_for,
    _gold_for_biome,
)


def _row(**overrides):
    """A TPMC metadata row; defaults mirror committed row 2019_TBCBL-01 (Wetland,
    empty salinity)."""
    row = {c: "" for c in SAMPLE_COLUMNS}
    row.update({
        "sample_id": "2019_TBCBL-01",
        "biosample": "SAMC2804852",
        "location": "Lhasa",
        "region": "Tibet",
        "biome": "Wetland",
        "latitude": "29.380759000000001",
        "longitude": "90.834495000000004",
        "altitude": "3552.7",
        "ph": "7.62",
        "temperature_c": "14.9",
        "do_mg_l": "2.39",
        "no3_mg_l": "3.3595791999999999E-2",
        "nh4_mg_l": "0.68846103999999997",
        "tp_mg_l": "3.6479923999999997E-2",
        "tn_mg_l": "0.53713164999999996",
        "toc_mg_l": "5.6852954100000002",
        "turbidity_ntu": "2.27",
        "cl_mg_l": "5.0679999999999996",
        "so4_mg_l": "22.135000000000002",
    })
    row.update(overrides)
    return row


def _write(path, lines):
    path.write_text("\n".join(lines) + "\n")
    return path


def test_provenance_constants():
    assert TPMC_SOURCE_UUID == "ef649825-b2ff-52d9-bc55-bf92078a6a5d"
    assert TPMC_COLLECTION_SLUG == "tpmc"
    assert TPMC_SOURCE_URL == "https://ngdc.cncb.ac.cn/tpmc"
    assert len(BIOME_TO_GOLD) == 6


def test_gold_for_biome_all_six_biomes():
    assert _gold_for_biome("Wetland") == "Environmental:Aquatic:Freshwater:Wetlands"
    assert _gold_for_biome("River") == "Environmental:Aquatic:Freshwater:River"
    assert _gold_for_biome("Saline lake") == \
        "Environmental:Aquatic:Non-marine Saline and Alkaline:Saline lake"
    assert _gold_for_biome("Hotspring") == \
        "Environmental:Aquatic:Thermal springs:Hot (42-90C)"
    assert _gold_for_biome("Freshwater lake") == "Environmental:Aquatic:Freshwater:Lake"
    assert _gold_for_biome("Glacier") == "Environmental:Aquatic:Freshwater:Glacier"


def test_gold_for_biome_case_insensitive():
    assert _gold_for_biome("freshwater lake") == "Environmental:Aquatic:Freshwater:Lake"
    assert _gold_for_biome("  WETLAND ") == "Environmental:Aquatic:Freshwater:Wetlands"


def test_gold_for_biome_blank_or_unknown_falls_back_to_aquatic():
    assert _gold_for_biome("") == "Environmental:Aquatic"
    assert _gold_for_biome("weird") == "Environmental:Aquatic"
    assert _gold_for_biome(None) == "Environmental:Aquatic"


def test_gold_for_biome_never_none():
    for biome in list(BIOME_TO_GOLD) + ["", "NA", "junk", None]:
        got = _gold_for_biome(biome)
        assert got and got.startswith("Environmental:Aquatic")


def test_map_real_committed_wetland_row_no_salinity():
    out = map_sample_fields(_row())
    assert out["latitude"] == pytest.approx(29.380759)
    assert out["longitude"] == pytest.approx(90.834495)
    assert out["location_resolution"] == "point"
    assert out["gold_ecosystem_path"] == "Environmental:Aquatic:Freshwater:Wetlands"
    assert out["geographic_location"] == "Lhasa"
    assert out["ph"] == pytest.approx(7.62)
    assert out["temperature"] == pytest.approx(14.9)
    assert out["dissolved_oxygen"] == pytest.approx(2.39)
    assert out["dissolved_oxygen_unit"] == "mg/L"
    assert out["nitrate"] == pytest.approx(0.033595792)
    assert out["nitrate_unit"] == "mg/L"
    assert out["ammonium"] == pytest.approx(0.68846104)
    assert "salinity" not in out
    assert "salinity_unit" not in out
    assert "depth" not in out
    meta = json.loads(out["metadata"])
    assert meta["tpmc"]["biosample"] == "SAMC2804852"
    assert meta["tpmc"]["biome"] == "Wetland"
    assert meta["tpmc"]["region"] == "Tibet"
    assert meta["tpmc"]["altitude"] == "3552.7"
    phys = meta["tpmc"]["physicochem"]
    assert phys["total_phosphorus"] == pytest.approx(0.036479924)
    assert phys["toc"] == pytest.approx(5.68529541)
    assert phys["chloride"] == pytest.approx(5.068)
    assert phys["sulfate"] == pytest.approx(22.135)
    assert "tds" not in phys and "chlorophyll" not in phys and "sodium" not in phys
    assert ", " not in out["metadata"] and '": ' not in out["metadata"]


def test_map_salinity_present_attaches_lowercase_psu_unit():
    out = map_sample_fields(_row(salinity_psu="0.35"))
    assert out["salinity"] == pytest.approx(0.35)
    assert out["salinity_unit"] == "psu"


def test_map_zero_temperature_preserved():
    """A temperature of 0.0 is present, not dropped to None."""
    out = map_sample_fields(_row(temperature_c="0"))
    assert out["temperature"] == pytest.approx(0.0)
    assert "temperature" in out


def test_map_zero_salinity_keeps_unit():
    out = map_sample_fields(_row(salinity_psu="0.0"))
    assert out["salinity"] == pytest.approx(0.0)
    assert out["salinity_unit"] == "psu"


def test_map_geographic_location_falls_back_to_region():
    out = map_sample_fields(_row(location="", region="Qilian"))
    assert out["geographic_location"] == "Qilian"
    out2 = map_sample_fields(_row(location="", region=""))
    assert "geographic_location" not in out2


def test_map_missing_coord_no_point():
    out = map_sample_fields(_row(latitude="", longitude="90.0"))
    assert "latitude" not in out
    assert "location_resolution" not in out


def test_map_out_of_range_latitude_drops_all_three_coord_keys():
    # lat 99.85 is a lat/lon-swapped source error
    out = map_sample_fields(_row(latitude="99.85", longitude="91.42"))
    assert "latitude" not in out
    assert "longitude" not in out
    assert "location_resolution" not in out


def test_map_out_of_range_longitude_drops_coords():
    out = map_sample_fields(_row(latitude="30.0", longitude="200.0"))
    assert "latitude" not in out
    assert "longitude" not in out
    assert "location_resolution" not in out


def test_map_valid_coords_set_all_three():
    out = map_sample_fields(_row(latitude="30.0", longitude="91.0"))
    assert out["latitude"] == pytest.approx(30.0)
    assert out["longitude"] == pytest.approx(91.0)
    assert out["location_resolution"] == "point"


def test_map_out_of_range_ph_dropped():
    assert "ph" not in map_sample_fields(_row(ph="17.45"))
    assert "ph" not in map_sample_fields(_row(ph="-1"))
    assert map_sample_fields(_row(ph="0"))["ph"] == pytest.approx(0.0)
    assert map_sample_fields(_row(ph="14"))["ph"] == pytest.approx(14.0)


def test_map_negative_depth_dropped():
    assert "depth" not in map_sample_fields(_row(depth_m="-0.6"))
    assert map_sample_fields(_row(depth_m="0"))["depth"] == pytest.approx(0.0)
    assert map_sample_fields(_row(depth_m="12.5"))["depth"] == pytest.approx(12.5)


def test_map_always_carries_gold_and_metadata():
    blank = {c: "" for c in SAMPLE_COLUMNS}
    blank["sample_id"] = "S1"
    out = map_sample_fields(blank)
    assert out["gold_ecosystem_path"] == "Environmental:Aquatic"
    assert json.loads(out["metadata"]) == {"tpmc": {}}


def test_map_saline_lake_and_hotspring_and_glacier_biomes():
    assert map_sample_fields(_row(biome="Saline lake"))["gold_ecosystem_path"] == \
        "Environmental:Aquatic:Non-marine Saline and Alkaline:Saline lake"
    assert map_sample_fields(_row(biome="Hotspring"))["gold_ecosystem_path"] == \
        "Environmental:Aquatic:Thermal springs:Hot (42-90C)"
    assert map_sample_fields(_row(biome="Glacier"))["gold_ecosystem_path"] == \
        "Environmental:Aquatic:Freshwater:Glacier"


def test_load_duplicate_sample_id_raises(tmp_path):
    header = "\t".join(SAMPLE_COLUMNS)
    row = "\t".join(["S1"] + ["x"] * (len(SAMPLE_COLUMNS) - 1))
    p = _write(tmp_path / "t.tsv", [header, row, row])
    with pytest.raises(ValueError):
        load_sample_metadata(p)


def test_load_header_mismatch_raises(tmp_path):
    header = "\t".join(c for c in SAMPLE_COLUMNS if c != "biome")
    row = "\t".join(["x"] * (len(SAMPLE_COLUMNS) - 1))
    p = _write(tmp_path / "t.tsv", [header, row])
    with pytest.raises(ValueError):
        load_sample_metadata(p)


def test_load_ragged_raises(tmp_path):
    header = "\t".join(SAMPLE_COLUMNS)
    short = "\t".join(["x"] * (len(SAMPLE_COLUMNS) - 1))
    p = _write(tmp_path / "t.tsv", [header, short])
    with pytest.raises(ValueError):
        load_sample_metadata(p)


def test_enrichment_for_real_accession_resolves():
    out = enrichment_for("2019_TBCBL-01_bin.9")
    assert out is not None
    assert out["gold_ecosystem_path"] == "Environmental:Aquatic:Freshwater:Wetlands"
    assert out["geographic_location"] == "Lhasa"
    assert json.loads(out["metadata"])["tpmc"]["biosample"] == "SAMC2804852"


def test_enrichment_for_salinity_accession():
    # 2020_BBH1-W1 (River) carries salinity 0.35 -> unit attached
    out = enrichment_for("2020_BBH1-W1_bin.3")
    assert out is not None
    assert out["salinity"] == pytest.approx(0.35)
    assert out["salinity_unit"] == "psu"
    assert out["gold_ecosystem_path"] == "Environmental:Aquatic:Freshwater:River"


def test_enrichment_for_absent_sample_returns_none():
    assert enrichment_for("NOT_A_SAMPLE_bin.1") is None
    assert enrichment_for("TOTALLY_ABSENT_ACCESSION") is None


def test_enrichment_for_caches_loaded_table(monkeypatch):
    import scripts.populator.adapters.tpmc_metadata as tpmc
    enrichment_for("2019_TBCBL-01_bin.1")
    boom = lambda *a, **k: (_ for _ in ()).throw(
        AssertionError("loader re-invoked after cache prime"))
    monkeypatch.setattr(tpmc, "load_sample_metadata", boom)
    assert enrichment_for("2019_TBCBL-01_bin.1") is not None


def test_integration_sample_count_is_498():
    assert len(load_sample_metadata()) == 498


def test_integration_every_sample_resolves_to_aquatic_gold():
    """Every committed sample maps to an Environmental:Aquatic path and its
    <sample_id>_bin.<n> accession resolves."""
    table = load_sample_metadata()
    for sample_id, row in table.items():
        out = map_sample_fields(row)
        assert out["gold_ecosystem_path"].startswith("Environmental:Aquatic"), sample_id
        assert "tpmc" in json.loads(out["metadata"])
        got = enrichment_for(f"{sample_id}_bin.1")
        assert got is not None and got["gold_ecosystem_path"].startswith(
            "Environmental:Aquatic")
