"""Tests for the shared SMAG (Global Soil MAGs) metadata adapter. Integration tests
read the real committed TSVs."""
import json

import pytest

from scripts.populator.adapters.smag_metadata import (
    SMAG_SOURCE_UUID,
    SMAG_COLLECTION_SLUG,
    ECOSYSTEM_TO_GOLD,
    _SMAG_DEFAULT_GOLD,
    SAMPLE_COLUMNS,
    QC_COLUMNS,
    load_sample_metadata,
    load_genome_qc,
    enrichment_for,
    _gold_for_ecosystem,
    _MIMAG,
)


def _write(path, lines):
    path.write_text("\n".join(lines) + "\n")
    return path


def test_provenance_constants():
    assert SMAG_SOURCE_UUID == "76515336-6be8-5622-9e97-0125b09bd407"
    assert SMAG_COLLECTION_SLUG == "smag"
    assert len(ECOSYSTEM_TO_GOLD) == 10
    assert _SMAG_DEFAULT_GOLD == "Environmental:Terrestrial:Soil"


def test_gold_for_ecosystem_mapped_labels():
    assert _gold_for_ecosystem("Forest") == "Environmental:Terrestrial:Soil:Forest soil"
    assert _gold_for_ecosystem("Grassland") == "Environmental:Terrestrial:Soil:Grasslands"
    assert _gold_for_ecosystem("Agricultural Land") == \
        "Environmental:Terrestrial:Soil:Agricultural land"


def test_gold_for_ecosystem_placeholder_labels_fall_to_bare_soil():
    assert _gold_for_ecosystem("Bare Land") == "Environmental:Terrestrial:Soil"
    assert _gold_for_ecosystem("Artificial Surfaces") == "Environmental:Terrestrial:Soil"


def test_gold_for_ecosystem_sea_is_marine():
    assert _gold_for_ecosystem("Sea") == "Environmental:Aquatic:Marine"


def test_gold_for_ecosystem_missing_or_unknown_defaults_to_soil():
    # SMAG is all soil, so anything unmapped gets the soil default
    assert _gold_for_ecosystem("") == "Environmental:Terrestrial:Soil"
    assert _gold_for_ecosystem("NA") == "Environmental:Terrestrial:Soil"
    assert _gold_for_ecosystem("weird") == "Environmental:Terrestrial:Soil"
    assert _gold_for_ecosystem(None) == "Environmental:Terrestrial:Soil"


def test_gold_for_ecosystem_is_never_none():
    for label in list(ECOSYSTEM_TO_GOLD) + ["", "NA", "??", None]:
        assert _gold_for_ecosystem(label) is not None


def test_gold_for_ecosystem_is_case_insensitive():
    assert _gold_for_ecosystem("forest") == "Environmental:Terrestrial:Soil:Forest soil"
    assert _gold_for_ecosystem("FOREST") == "Environmental:Terrestrial:Soil:Forest soil"
    assert _gold_for_ecosystem("  Forest  ") == "Environmental:Terrestrial:Soil:Forest soil"
    assert _gold_for_ecosystem("agricultural land") == \
        "Environmental:Terrestrial:Soil:Agricultural land"


def test_mimag_high():
    assert _MIMAG("95", "3") == "high"
    assert _MIMAG(95, 3) == "high"


def test_mimag_medium():
    assert _MIMAG("70", "8") == "medium"
    assert _MIMAG("95", "6") == "medium"


def test_mimag_boundaries():
    assert _MIMAG("90", "5") == "high"
    assert _MIMAG("89.99", "5") == "medium"


def test_mimag_unparseable_is_none():
    assert _MIMAG("", "3") is None
    assert _MIMAG("95", "weird") is None
    assert _MIMAG(None, None) is None


def test_enrichment_for_sample_and_qc_both_present():
    # BL1bin.1: sample BL1bin (Forest / Belgium, SAMN35729406) + QC (66.73/5.71).
    out = enrichment_for("BL1bin.1")
    assert out is not None
    assert out["latitude"] == pytest.approx(50.86)
    assert out["longitude"] == pytest.approx(4.72)
    assert out["gold_ecosystem_path"] == "Environmental:Terrestrial:Soil:Forest soil"
    assert out["geographic_location"] == "Belgium"
    assert out["location_resolution"] == "point"
    assert isinstance(out["checkm_completeness"], float)
    assert out["checkm_completeness"] == pytest.approx(66.73)
    assert isinstance(out["checkm_contamination"], float)
    assert out["checkm_contamination"] == pytest.approx(5.71)
    assert out["genome_quality"] == "medium"
    assert out["genome_size"] == 4276629
    assert isinstance(out["genome_size"], int)
    meta = json.loads(out["metadata"])["smag"]
    assert meta["biosample"] == "SAMN35729406"
    assert meta["ecosystem"] == "Forest"
    assert meta["taxonomy"].startswith("d__Bacteria")


def test_enrichment_for_qc_only_still_gets_soil_gold():
    # DRR101463bin.1: sample key absent from the geo table but the MAG is in QC
    out = enrichment_for("DRR101463bin.1")
    assert out is not None
    assert out["gold_ecosystem_path"] == "Environmental:Terrestrial:Soil"
    assert out["checkm_completeness"] is not None
    assert "latitude" not in out
    assert "longitude" not in out
    assert "geographic_location" not in out
    assert "location_resolution" not in out
    meta = json.loads(out["metadata"])["smag"]
    assert "taxonomy" in meta
    assert "biosample" not in meta


def test_enrichment_for_absent_accession_is_none():
    assert enrichment_for("not-a-genome") is None
    assert enrichment_for("SAMN00000000.1") is None


def test_enrichment_for_zero_contamination_preserved():
    # BL1bin.11 has contamination 0
    out = enrichment_for("BL1bin.11")
    assert out is not None
    assert out["checkm_contamination"] == pytest.approx(0.0)


def test_enrichment_for_caches_loaded_tables(monkeypatch):
    import scripts.populator.adapters.smag_metadata as smag
    enrichment_for("BL1bin.1")
    boom = lambda *a, **k: (_ for _ in ()).throw(
        AssertionError("loader re-invoked after cache prime"))
    monkeypatch.setattr(smag, "load_sample_metadata", boom)
    monkeypatch.setattr(smag, "load_genome_qc", boom)
    assert enrichment_for("BL1bin.1") is not None


def test_load_sample_duplicate_raises(tmp_path):
    header = "\t".join(SAMPLE_COLUMNS)
    row = "\t".join(["G1"] + ["x"] * (len(SAMPLE_COLUMNS) - 1))
    p = _write(tmp_path / "s.tsv", [header, row, row])
    with pytest.raises(ValueError):
        load_sample_metadata(p)


def test_load_sample_header_mismatch_raises(tmp_path):
    header = "\t".join(c for c in SAMPLE_COLUMNS if c != "ecosystem")
    row = "\t".join(["x"] * (len(SAMPLE_COLUMNS) - 1))
    p = _write(tmp_path / "s.tsv", [header, row])
    with pytest.raises(ValueError):
        load_sample_metadata(p)


def test_load_qc_ragged_raises(tmp_path):
    header = "\t".join(QC_COLUMNS)
    short = "\t".join(["x"] * (len(QC_COLUMNS) - 1))
    p = _write(tmp_path / "q.tsv", [header, short])
    with pytest.raises(ValueError):
        load_genome_qc(p)


def test_load_qc_duplicate_raises(tmp_path):
    header = "\t".join(QC_COLUMNS)
    row = "\t".join(["M1"] + ["1"] * (len(QC_COLUMNS) - 1))
    p = _write(tmp_path / "q.tsv", [header, row, row])
    with pytest.raises(ValueError):
        load_genome_qc(p)


def test_integration_row_counts():
    assert len(load_sample_metadata()) == 3304
    assert len(load_genome_qc()) == 40039


def test_integration_every_qc_mag_resolves_to_valid_soil_path():
    """Every QC MAG resolves to a valid GOLD soil path with a valid genome_quality."""
    allowed_quality = {"high", "medium", None}
    valid_prefixes = ("Environmental", "Host-associated", "Engineered")
    qc = load_genome_qc()
    for accession in qc:
        out = enrichment_for(accession)
        assert out is not None, accession
        assert out["gold_ecosystem_path"].startswith(valid_prefixes), accession
        assert out["genome_quality"] in allowed_quality, accession
        assert "smag" in json.loads(out["metadata"])
