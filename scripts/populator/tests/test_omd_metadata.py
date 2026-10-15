"""Tests for the shared OMD-v2 (Ocean Microbiomics Database) metadata adapter.
Integration tests read the real committed TSVs."""
import json

import pytest

from scripts.populator.adapters.omd_metadata import (
    OMD_SOURCE_UUID,
    OMD_COLLECTION_SLUG,
    GOLD_ECOSYSTEM_PATH,
    BIOSAMPLE_COLUMNS,
    PHYSICOCHEM_COLUMNS,
    load_biosample_metadata,
    load_dataset_map,
    load_tara_physicochem,
    map_sample_fields,
    enrichment_for,
    physicochem_for,
)

_PHYSICOCHEM_KEYS = {
    "temperature",
    "salinity", "salinity_unit",
    "dissolved_oxygen", "dissolved_oxygen_unit",
    "conductivity", "conductivity_unit",
    "nitrate", "nitrate_unit",
    "nitrite", "nitrite_unit",
    "phosphate", "phosphate_unit",
    "metadata",
}


def _row(**overrides):
    row = {c: "" for c in BIOSAMPLE_COLUMNS}
    row.update({
        "biosample": "SAMN05422122",
        "lat": "38.0022",
        "lon": "147.15",
        "location": "38.0022 N 147.15 E",
        "collection_date": "2009-10-04T08:30:00Z",
        "depth": "1500m",
        "temperature": "3.4",
        "salinity": "",
        "country": "Pacific Ocean",
        "environmental_medium": "water [ENVO:00002006]",
    })
    row.update(overrides)
    return row


def _write(path, lines):
    path.write_text("\n".join(lines) + "\n")
    return path


def test_provenance_constants():
    assert OMD_SOURCE_UUID == "dc1091df-9475-5793-8d9a-a8d8ed6315d9"
    assert OMD_COLLECTION_SLUG == "omd-v2"
    assert GOLD_ECOSYSTEM_PATH == "Environmental:Aquatic:Marine:Pelagic"


def test_map_deep_row_bathypelagic_and_constants():
    out = map_sample_fields(_row(depth="1500m", temperature="3.4"), "STATION-1")
    assert out["gold_ecosystem_path"] == "Environmental:Aquatic:Marine:Pelagic"
    assert out["environment_feature"] == "bathypelagic zone (>1000 m)"
    assert out["environment_material"] == "sea water"
    assert out["environment_biome"] == "marine pelagic biome"
    assert out["environmental_package"] == "water"
    assert out["depth"] == pytest.approx(1500.0)
    assert isinstance(out["temperature"], float)
    assert out["temperature"] == pytest.approx(3.4)


def test_map_shallow_row_epipelagic():
    out = map_sample_fields(_row(depth="10m"), "STATION-1")
    assert out["environment_feature"] == "epipelagic zone (0-200 m)"
    assert out["depth"] == pytest.approx(10.0)


def test_map_mesopelagic_zone():
    out = map_sample_fields(_row(depth="550 m"), None)
    assert out["environment_feature"] == "mesopelagic zone (200-1000 m)"
    assert out["depth"] == pytest.approx(550.0)


def test_map_no_depth_feature_none():
    out = map_sample_fields(_row(depth=""), "STATION-1")
    assert out["depth"] is None
    assert out["environment_feature"] is None
    assert out["gold_ecosystem_path"] == "Environmental:Aquatic:Marine:Pelagic"


def test_map_junk_depth_feature_none():
    for junk in ("surface", "na", "missing", "not provided", "miliQ"):
        out = map_sample_fields(_row(depth=junk), None)
        assert out["depth"] is None, junk
        assert out["environment_feature"] is None, junk


def test_map_sentinel_and_negative_depth_dropped():
    assert map_sample_fields(_row(depth="99999"), None)["depth"] is None
    assert map_sample_fields(_row(depth="-50 m"), None)["depth"] is None
    assert map_sample_fields(_row(depth="-100 m"), None)["depth"] is None


def test_map_salinity_always_none():
    out = map_sample_fields(_row(salinity="35"), None)
    assert out["salinity"] is None


def test_map_coords_present_location_resolution_point():
    out = map_sample_fields(_row(lat="38.0022", lon="147.15"), None)
    assert out["latitude"] == pytest.approx(38.0022)
    assert out["longitude"] == pytest.approx(147.15)
    assert out["location_resolution"] == "point"


def test_map_missing_coord_no_point():
    assert map_sample_fields(_row(lat="", lon="147.15"), None)["location_resolution"] is None
    assert map_sample_fields(_row(lat="38.0", lon=""), None)["location_resolution"] is None
    out = map_sample_fields(_row(lat="", lon=""), None)
    assert out["latitude"] is None and out["longitude"] is None
    assert out["location_resolution"] is None


def test_map_scientific_notation_coord_parses():
    out = map_sample_fields(_row(lat="1.0E-4", lon="-3.0E-4"), None)
    assert out["latitude"] == pytest.approx(0.0001)
    assert out["longitude"] == pytest.approx(-0.0003)


def test_map_collection_date_iso_datetime_truncates():
    out = map_sample_fields(_row(collection_date="2009-10-04T08:30:00Z"), None)
    assert out["collection_date"] == "2009-10-04"


def test_map_collection_date_partial_and_junk_dropped():
    for partial in ("2008", "2008-09", "01/01/09", "04-Oct-2015", ""):
        out = map_sample_fields(_row(collection_date=partial), None)
        assert out["collection_date"] is None, partial


def test_map_geographic_location_from_country():
    assert map_sample_fields(_row(country="Japan:Tohoku"), None)["geographic_location"] == "Japan:Tohoku"
    assert map_sample_fields(_row(country=""), None)["geographic_location"] is None


def test_map_non_numeric_temperature_none():
    out = map_sample_fields(_row(temperature="14.0;13.95"), None)
    assert out["temperature"] is None


def test_map_metadata_parses_with_biosample_and_dataset():
    out = map_sample_fields(_row(biosample="SAMN05422122"), "ACIN21-1")
    parsed = json.loads(out["metadata"])
    assert parsed["biosample"] == "SAMN05422122"
    assert parsed["omd"]["dataset"] == "ACIN21-1"


def test_map_metadata_omits_empty_dataset():
    out = map_sample_fields(_row(biosample="SAMN05422122"), None)
    parsed = json.loads(out["metadata"])
    assert parsed["biosample"] == "SAMN05422122"
    assert parsed["omd"] == {}
    assert ", " not in out["metadata"] and '": ' not in out["metadata"]


def test_load_biosample_metadata_duplicate_raises(tmp_path):
    header = "\t".join(BIOSAMPLE_COLUMNS)
    row = "SAMN1\t1\t2\tloc\t2020-01-01\t10m\t3\t\tSea\twater"
    p = _write(tmp_path / "bs.tsv", [header, row, row])
    with pytest.raises(ValueError):
        load_biosample_metadata(p)


def test_load_biosample_metadata_header_mismatch_raises(tmp_path):
    header = "\t".join(c for c in BIOSAMPLE_COLUMNS if c != "depth")
    row = "\t".join(["x"] * (len(BIOSAMPLE_COLUMNS) - 1))
    p = _write(tmp_path / "bs.tsv", [header, row])
    with pytest.raises(ValueError):
        load_biosample_metadata(p)


def test_load_biosample_metadata_ragged_raises(tmp_path):
    header = "\t".join(BIOSAMPLE_COLUMNS)
    short = "\t".join(["x"] * (len(BIOSAMPLE_COLUMNS) - 1))
    p = _write(tmp_path / "bs.tsv", [header, short])
    with pytest.raises(ValueError):
        load_biosample_metadata(p)


def test_load_dataset_map_reads_and_dedupes_header(tmp_path):
    p = _write(tmp_path / "ds.tsv", [
        "biosample\tdataset",
        "SAMN1\tACIN21-1",
        "SAMN2\tYOSH21-1",
    ])
    assert load_dataset_map(p) == {"SAMN1": "ACIN21-1", "SAMN2": "YOSH21-1"}


def test_load_dataset_map_duplicate_raises(tmp_path):
    p = _write(tmp_path / "ds.tsv", [
        "biosample\tdataset",
        "SAMN1\tACIN21-1",
        "SAMN1\tOTHER",
    ])
    with pytest.raises(ValueError):
        load_dataset_map(p)


def test_integration_biosample_count_is_9214():
    assert len(load_biosample_metadata()) == 9214


def test_integration_every_row_survives_mapping():
    """Every ENA-attribute row maps without raising and gets the constant ocean triad."""
    meta = load_biosample_metadata()
    ds = load_dataset_map()
    for biosample, row in meta.items():
        out = map_sample_fields(row, ds.get(biosample))
        assert out["gold_ecosystem_path"] == "Environmental:Aquatic:Marine:Pelagic"
        assert out["environment_material"] == "sea water"
        assert json.loads(out["metadata"])["biosample"] == biosample


def test_integration_dataset_map_count_is_9214():
    assert len(load_dataset_map()) == 9214


def test_enrichment_for_known_biosample_resolves():
    # SAMD00070310: country 'Japan:Tohoku, A-line', depth 10m -> epipelagic
    out = enrichment_for("SAMD00070310")
    assert out is not None
    assert out["geographic_location"] == "Japan:Tohoku, A-line"
    assert out["gold_ecosystem_path"] == "Environmental:Aquatic:Marine:Pelagic"
    assert out["environment_feature"] == "epipelagic zone (0-200 m)"
    parsed = json.loads(out["metadata"])
    assert parsed["biosample"] == "SAMD00070310"
    assert parsed["omd"]["dataset"]


def test_enrichment_for_unknown_accession_returns_none():
    assert enrichment_for("SAMN00000000") is None
    assert enrichment_for("not-a-biosample") is None


def test_enrichment_for_caches_loaded_tables(monkeypatch):
    import scripts.populator.adapters.omd_metadata as omd
    enrichment_for("SAMD00070310")
    boom = lambda *a, **k: (_ for _ in ()).throw(
        AssertionError("loader re-invoked after cache prime"))
    monkeypatch.setattr(omd, "load_biosample_metadata", boom)
    monkeypatch.setattr(omd, "load_dataset_map", boom)
    assert enrichment_for("SAMD00070310") is not None


# Phase 2: Tara Oceans physicochemistry (median PANGAEA values)
def _pc_row(**overrides):
    row = {c: "" for c in PHYSICOCHEM_COLUMNS}
    row.update({
        "biosample": "SAMEA0000001",
        "temperature": "20.44",
        "salinity": "39.42",
        "dissolved_oxygen": "207.6",
        "conductivity": "53.76",
        "nitrate": "0.188",
        "nitrite": "0.0012",
        "phosphate": "0.00025",
        "silicate": "0.816",
        "chlorophyll": "0.0148",
    })
    row.update(overrides)
    return row


def test_load_physicochem_duplicate_raises(tmp_path):
    header = "\t".join(PHYSICOCHEM_COLUMNS)
    row = "\t".join(["SAMEA1"] + ["1"] * (len(PHYSICOCHEM_COLUMNS) - 1))
    p = _write(tmp_path / "pc.tsv", [header, row, row])
    with pytest.raises(ValueError):
        load_tara_physicochem(p)


def test_load_physicochem_header_mismatch_raises(tmp_path):
    header = "\t".join(c for c in PHYSICOCHEM_COLUMNS if c != "silicate")
    row = "\t".join(["x"] * (len(PHYSICOCHEM_COLUMNS) - 1))
    p = _write(tmp_path / "pc.tsv", [header, row])
    with pytest.raises(ValueError):
        load_tara_physicochem(p)


def test_load_physicochem_ragged_raises(tmp_path):
    header = "\t".join(PHYSICOCHEM_COLUMNS)
    short = "\t".join(["x"] * (len(PHYSICOCHEM_COLUMNS) - 1))
    p = _write(tmp_path / "pc.tsv", [header, short])
    with pytest.raises(ValueError):
        load_tara_physicochem(p)


def _patch_physicochem(monkeypatch, rows):
    import scripts.populator.adapters.omd_metadata as omd
    monkeypatch.setattr(omd, "_PHYSICOCHEM_LOADED",
                        {r["biosample"]: r for r in rows}, raising=False)


def test_physicochem_for_full_row_maps_columns_units_and_metadata(monkeypatch):
    _patch_physicochem(monkeypatch, [_pc_row(biosample="SAMEA0000001")])
    out = physicochem_for("SAMEA0000001")
    assert out is not None
    assert set(out) == _PHYSICOCHEM_KEYS
    assert out["salinity"] == pytest.approx(39.42)
    assert out["nitrate"] == pytest.approx(0.188)
    assert out["temperature"] == pytest.approx(20.44)
    # temperature has no unit column
    assert out["salinity_unit"] == "psu"
    assert out["nitrate_unit"] == "µmol/L"
    assert out["dissolved_oxygen_unit"] == "µmol/kg"
    assert out["conductivity_unit"] == "mS/cm"
    assert "temperature_unit" not in out
    # silicate + chlorophyll land in metadata.omd_physicochem, not as columns
    meta = json.loads(out["metadata"])
    assert set(meta) == {"omd_physicochem"}
    assert meta["omd_physicochem"]["silicate"] == pytest.approx(0.816)
    assert meta["omd_physicochem"]["chlorophyll"] == pytest.approx(0.0148)


def test_physicochem_for_absent_biosample_returns_none(monkeypatch):
    _patch_physicochem(monkeypatch, [_pc_row(biosample="SAMEA0000001")])
    assert physicochem_for("SAMN99999999") is None


def test_physicochem_for_only_some_fields_sets_only_those(monkeypatch):
    row = _pc_row(biosample="SAMEA0000002", nitrate="", dissolved_oxygen="", silicate="")
    _patch_physicochem(monkeypatch, [row])
    out = physicochem_for("SAMEA0000002")
    assert out["salinity"] == pytest.approx(39.42)
    assert out["salinity_unit"] == "psu"
    assert out["nitrate"] is None and out["nitrate_unit"] is None
    assert out["dissolved_oxygen"] is None and out["dissolved_oxygen_unit"] is None
    meta = json.loads(out["metadata"])
    assert set(meta["omd_physicochem"]) == {"chlorophyll"}


def test_physicochem_for_no_metadata_when_silicate_and_chlorophyll_absent(monkeypatch):
    row = _pc_row(biosample="SAMEA0000003", silicate="", chlorophyll="")
    _patch_physicochem(monkeypatch, [row])
    out = physicochem_for("SAMEA0000003")
    assert out["metadata"] is None
    assert out["salinity"] == pytest.approx(39.42)


def test_physicochem_for_non_numeric_value_dropped(monkeypatch):
    row = _pc_row(biosample="SAMEA0000004", salinity="n/a")
    _patch_physicochem(monkeypatch, [row])
    out = physicochem_for("SAMEA0000004")
    assert out["salinity"] is None and out["salinity_unit"] is None


def test_integration_physicochem_count_is_963():
    assert len(load_tara_physicochem()) == 963


def test_integration_every_physicochem_row_survives(monkeypatch):
    """Every committed row maps without raising and sets a *_unit iff its value is present."""
    import scripts.populator.adapters.omd_metadata as omd
    table = load_tara_physicochem()
    monkeypatch.setattr(omd, "_PHYSICOCHEM_LOADED", table, raising=False)
    seen_salinity = 0
    for biosample in table:
        out = physicochem_for(biosample)
        assert set(out) == _PHYSICOCHEM_KEYS, biosample
        for value_col, unit_col in (("salinity", "salinity_unit"),
                                    ("nitrate", "nitrate_unit"),
                                    ("nitrite", "nitrite_unit"),
                                    ("phosphate", "phosphate_unit"),
                                    ("dissolved_oxygen", "dissolved_oxygen_unit"),
                                    ("conductivity", "conductivity_unit")):
            if out[value_col] is None:
                assert out[unit_col] is None, (biosample, unit_col)
            else:
                assert out[unit_col], (biosample, unit_col)
        if out["salinity"] is not None:
            seen_salinity += 1
        if out["metadata"] is not None:
            assert "omd_physicochem" in json.loads(out["metadata"])
    assert seen_salinity > 900


def test_integration_known_biosample_salinity_and_nutrients():
    # SAMEA2591108 (dataset TOPC): salinity + nitrate present, silicate/chlorophyll nested
    out = physicochem_for("SAMEA2591108")
    assert out is not None
    assert out["salinity"] == pytest.approx(39.4231)
    assert out["salinity_unit"] == "psu"
    assert out["nitrate"] == pytest.approx(0.188705)
    assert out["nitrate_unit"] == "µmol/L"
    meta = json.loads(out["metadata"])
    assert meta["omd_physicochem"]["silicate"] == pytest.approx(0.816)
    assert meta["omd_physicochem"]["chlorophyll"] == pytest.approx(0.01488)
