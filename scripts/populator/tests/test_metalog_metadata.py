import json, pathlib
from scripts.populator.adapters.metalog_metadata import (
    load_env_metadata, _coerce_float, _coerce_int, _row_to_sample_fields,
)
FIX = pathlib.Path(__file__).parent / "fixtures" / "metalog_env_small.tsv"

def test_alias_match_maps_fields():
    lk = load_env_metadata(FIX)
    f = lk.fields_for("StudyA.sampleX")          # exact sample_alias
    assert f["latitude"] == 30.25 and f["longitude"] == -88.11
    assert f["environment_biome"].startswith("aquatic biome")
    assert f["ph"] == 7.2 and f["temperature"] == 18.0
    assert f["collection_date"] == "2016-01-01"
    assert f["sample_alias"] == "StudyA.sampleX"
    meta = json.loads(f["metadata"])
    assert meta["study_code"] == "StudyA" and meta["doi"] == "10.1/x"

def test_spire_fallback_and_ambiguity_picks_sorted_alias(caplog):
    import logging
    lk = load_env_metadata(FIX)
    with caplog.at_level(logging.WARNING):
        f = lk.fields_for("5O_Y1.1")             # not an alias -> spire, 2 rows
    assert f["latitude"] == 33.65
    assert f["environment_biome"].startswith("terrestrial biome")
    assert f["depth"] == 0.0
    assert any("spire_sample_name" in r.message for r in caplog.records)  # warned on ambiguity
    # picked the lexicographically smallest sample_alias
    assert json.loads(f["metadata"])["study_code"] == "StudyB"

def test_unmatched_returns_none():
    assert load_env_metadata(FIX).fields_for("NOPE") is None

def test_coerce_float():
    assert _coerce_float("") is None and _coerce_float("x") is None and _coerce_float("3.5") == 3.5

def test_empty_fields_not_emitted():
    f = load_env_metadata(FIX).fields_for("5O_Y1.1")
    assert "pH" not in f and "ph" not in f       # pH empty in the ambiguous rows
    assert "collection_date_end" not in f         # empty

def test_depth_range_splits_to_min_max():
    f = load_env_metadata(FIX).fields_for("SPIRE_RANGE")
    assert f["depth_min_meters"] == 0.0 and f["depth_max_meters"] == 0.2
    assert "depth" not in f

def test_non_numeric_float_preserved_as_raw():
    f = load_env_metadata(FIX).fields_for("SPIRE_RANGE")
    import json
    assert json.loads(f["metadata"])["pH_raw"] == "approx 8"   # not dropped

def test_divergent_ambiguity_warns_differently(caplog):
    import logging
    with caplog.at_level(logging.WARNING):
        f = load_env_metadata(FIX).fields_for("DIVERGE")
    assert any("DIFFERING env values" in r.message for r in caplog.records)
    assert f["latitude"] == 1.0   # picked StudyD.a (smallest alias)

def test_coerce_int():
    assert _coerce_int("") is None and _coerce_int(None) is None
    assert _coerce_int("x") is None
    assert _coerce_int("4577") == 4577 and _coerce_int("4577.0") == 4577

def test_host_columns_mapped():
    f = _row_to_sample_fields({"host_tax_id": "4577", "host_scientific_name": "Zea mays"})
    assert f["host_taxid"] == 4577          # int-coerced
    assert f["host_scientific_name"] == "Zea mays"

def test_host_taxid_float_coerced():
    f = _row_to_sample_fields({"host_tax_id": "4577.0"})
    assert f["host_taxid"] == 4577

def test_host_columns_empty_not_emitted():
    f = _row_to_sample_fields({"host_tax_id": "", "host_scientific_name": ""})
    assert "host_taxid" not in f and "host_scientific_name" not in f

def test_host_taxid_non_numeric_preserved_as_raw():
    f = _row_to_sample_fields({"host_tax_id": "unknown"})
    assert "host_taxid" not in f
    assert json.loads(f["metadata"])["host_tax_id_raw"] == "unknown"
