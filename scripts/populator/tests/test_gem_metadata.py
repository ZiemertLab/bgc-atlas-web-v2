"""Tests for the shared GEM (Genomes from Earth's Microbiomes) metadata adapter.
Integration tests read the real committed TSV."""
import json

import pytest

from scripts.populator.adapters.gem_metadata import (
    GEM_SOURCE_UUID,
    GEM_COLLECTION_SLUG,
    GEM_CATEGORY_TO_ECOSYSTEM,
    MIMAG_TO_QUALITY,
    GEM_COLUMNS,
    load_gem_metadata,
    map_sample_fields,
    enrichment_for,
    _gold_path,
)


def _row(**overrides):
    row = {c: "" for c in GEM_COLUMNS}
    row.update({
        "genome_id": "2061766007_144",
        "metagenome_id": "2061766007",
        "latitude": "40.096",
        "longitude": "-88.2315",
        "ecosystem_category": "Mammals",
        "ecosystem_type": "Digestive system",
        "habitat": "Bovine rumen",
        "completeness": "94.38",
        "contamination": "1.31",
        "mimag_quality": "HQ",
        "genome_length": "1398911",
        "otu_id": "OTU-14569",
        "taxonomy": "d__Bacteria;p__Elusimicrobiota;c__Elusimicrobia",
    })
    row.update(overrides)
    return row


def _write(path, lines):
    path.write_text("\n".join(lines) + "\n")
    return path


def test_provenance_constants():
    assert GEM_SOURCE_UUID == "9eedc1b2-5007-5481-a684-550f9b3892f7"
    assert GEM_COLLECTION_SLUG == "gem"
    assert len(GEM_CATEGORY_TO_ECOSYSTEM) == 30
    assert MIMAG_TO_QUALITY == {"HQ": "high", "MQ": "medium", "LQ": "low"}


def test_gold_path_three_level_paths():
    assert _gold_path("Aquatic", "Marine") == "Environmental:Aquatic:Marine"
    assert _gold_path("Human", "Digestive system") == \
        "Host-associated:Human:Digestive system"
    assert _gold_path("Wastewater", "Anaerobic digestor") == \
        "Engineered:Wastewater:Anaerobic digestor"


def test_gold_path_unclassified_type_stops_at_two_levels():
    assert _gold_path("Bioreactor", "Unclassified") == "Engineered:Bioreactor"


def test_gold_path_empty_type_stops_at_two_levels():
    assert _gold_path("Bioreactor", "") == "Engineered:Bioreactor"


def test_gold_path_unknown_category_is_none():
    assert _gold_path("Unclassified", "Marine") is None
    assert _gold_path("not-a-category", "Marine") is None


def test_map_real_committed_row():
    out = map_sample_fields(_row())
    assert out["gold_ecosystem_path"] == "Host-associated:Mammals:Digestive system"
    assert out["environment_feature"] == "Bovine rumen"
    assert out["latitude"] == pytest.approx(40.096)
    assert out["longitude"] == pytest.approx(-88.2315)
    assert out["location_resolution"] == "point"
    assert isinstance(out["checkm_completeness"], float)
    assert out["checkm_completeness"] == pytest.approx(94.38)
    assert isinstance(out["checkm_contamination"], float)
    assert out["checkm_contamination"] == pytest.approx(1.31)
    assert out["genome_quality"] == "high"
    assert out["genome_size"] == 1398911
    assert isinstance(out["genome_size"], int)
    meta = json.loads(out["metadata"])
    assert meta["gem"]["genome_id"] == "2061766007_144"
    assert meta["gem"]["taxonomy"].startswith("d__Bacteria")


def test_map_empty_habitat_feature_none():
    assert map_sample_fields(_row(habitat=""))["environment_feature"] is None
    assert map_sample_fields(_row(habitat="Unclassified"))["environment_feature"] is None


def test_map_mimag_codes():
    assert map_sample_fields(_row(mimag_quality="MQ"))["genome_quality"] == "medium"
    assert map_sample_fields(_row(mimag_quality="LQ"))["genome_quality"] == "low"
    assert map_sample_fields(_row(mimag_quality="??"))["genome_quality"] is None


def test_map_zero_contamination_preserved():
    out = map_sample_fields(_row(contamination="0.0"))
    assert out["checkm_contamination"] == pytest.approx(0.0)


def test_map_missing_coord_no_point():
    assert map_sample_fields(_row(latitude="", longitude="-88.2"))["location_resolution"] is None
    out = map_sample_fields(_row(latitude="", longitude=""))
    assert out["latitude"] is None and out["longitude"] is None
    assert out["location_resolution"] is None


def test_map_metadata_omits_empty_provenance_fields():
    out = map_sample_fields(_row(otu_id="", taxonomy=""))
    meta = json.loads(out["metadata"])
    assert set(meta["gem"]) == {"genome_id", "metagenome_id"}
    assert ", " not in out["metadata"] and '": ' not in out["metadata"]


def test_load_duplicate_genome_id_raises(tmp_path):
    header = "\t".join(GEM_COLUMNS)
    row = "\t".join(["G1"] + ["x"] * (len(GEM_COLUMNS) - 1))
    p = _write(tmp_path / "g.tsv", [header, row, row])
    with pytest.raises(ValueError):
        load_gem_metadata(p)


def test_load_header_mismatch_raises(tmp_path):
    header = "\t".join(c for c in GEM_COLUMNS if c != "habitat")
    row = "\t".join(["x"] * (len(GEM_COLUMNS) - 1))
    p = _write(tmp_path / "g.tsv", [header, row])
    with pytest.raises(ValueError):
        load_gem_metadata(p)


def test_load_ragged_raises(tmp_path):
    header = "\t".join(GEM_COLUMNS)
    short = "\t".join(["x"] * (len(GEM_COLUMNS) - 1))
    p = _write(tmp_path / "g.tsv", [header, short])
    with pytest.raises(ValueError):
        load_gem_metadata(p)


def test_integration_genome_count_is_52515():
    assert len(load_gem_metadata()) == 52515


def test_integration_every_row_survives_mapping():
    """Every GEM row maps without raising, with an allowed genome_quality."""
    allowed_quality = {"high", "medium", "low", None}
    table = load_gem_metadata()
    for genome_id, row in table.items():
        out = map_sample_fields(row)
        assert out["genome_quality"] in allowed_quality, genome_id
        assert json.loads(out["metadata"])["gem"]["genome_id"] == genome_id


def test_enrichment_for_known_genome_resolves():
    # 2061766007_144: Mammals / Digestive system, HQ, Bovine rumen
    out = enrichment_for("2061766007_144")
    assert out is not None
    assert out["gold_ecosystem_path"] == "Host-associated:Mammals:Digestive system"
    assert out["environment_feature"] == "Bovine rumen"
    assert out["genome_quality"] == "high"
    assert out["checkm_completeness"] == pytest.approx(94.38)
    meta = json.loads(out["metadata"])
    assert meta["gem"]["genome_id"] == "2061766007_144"
    assert meta["gem"]["taxonomy"].startswith("d__")


def test_enrichment_for_unknown_accession_returns_none():
    assert enrichment_for("not-a-genome") is None
    assert enrichment_for("SAMN00000000") is None


def test_enrichment_for_caches_loaded_table(monkeypatch):
    import scripts.populator.adapters.gem_metadata as gem
    enrichment_for("2061766007_144")
    boom = lambda *a, **k: (_ for _ in ()).throw(
        AssertionError("loader re-invoked after cache prime"))
    monkeypatch.setattr(gem, "load_gem_metadata", boom)
    assert enrichment_for("2061766007_144") is not None
