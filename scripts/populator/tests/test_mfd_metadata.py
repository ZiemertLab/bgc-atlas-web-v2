"""Tests for the shared MFD metadata adapter. Integration tests read the real
committed TSVs."""
import json

import pytest

from scripts.populator.adapters.mfd_metadata import (
    SOURCE_UUID_TO_SLUG,
    MAG_COLLECTION_SLUGS,
    CUSTOM_SOURCE_NAME,
    MFD_SOURCE_URL,
    MFD_SOURCE_NAMES,
    resolve_barcode,
    load_ena_map,
    load_field_metadata,
    load_crosswalk,
    map_sample_fields,
    enrichment_for,
    mfd_study,
)
from scripts.populator.ids import entity_id


FIELD_COLUMNS = [
    "fieldsample_barcode", "project_id", "sampling_date", "latitude", "longitude",
    "sitename", "coords_reliable", "mfd_sampletype", "mfd_areatype", "mfd_hab1",
    "mfd_hab2", "mfd_hab3", "habitat_typenumber",
]


def _meta(**overrides):
    row = {c: "" for c in FIELD_COLUMNS}
    row.update({
        "fieldsample_barcode": "MFD00001",
        "project_id": "P08_1",
        "sampling_date": "2019-08-29",
        "latitude": "55.6771",
        "longitude": "9.27783",
        "sitename": "Junges Plantage",
        "coords_reliable": "Yes",
        "mfd_sampletype": "Soil",
        "mfd_areatype": "Natural",
        "mfd_hab1": "Forests",
        "mfd_hab2": "Temperate forests",
        "mfd_hab3": "Alluvial woodland",
        "habitat_typenumber": "91E0",
    })
    row.update(overrides)
    return row


def _cw_entry(**overrides):
    entry = {
        "gold_ecosystem_path": "Environmental:Terrestrial:Soil:Forest soil",
        "environment_biome": "forest biome",
        "environment_feature": "forest soil",
        "environment_material": "soil",
        "environmental_package": "soil",
    }
    entry.update(overrides)
    return entry


def _crosswalk_for(meta_row, entry=None):
    key = (
        meta_row["mfd_sampletype"], meta_row["mfd_areatype"], meta_row["mfd_hab1"],
        meta_row["mfd_hab2"], meta_row["mfd_hab3"],
    )
    return {key: entry if entry is not None else _cw_entry()}


def test_source_uuid_to_slug_mapping():
    assert SOURCE_UUID_TO_SLUG == {
        "e05519ea-b3f0-5d54-b90e-bfd0b282ded2": "custom",
        "0a9a4724-f924-54d9-b5bb-553f962eda00": "mfd-sr",
        "dfcd709d-0911-5d74-9696-f148b86ab799": "mfd-lr",
    }


def test_resolve_barcode_custom_is_identity_when_valid():
    assert resolve_barcode("MFD00008", "custom", {}) == "MFD00008"


def test_resolve_barcode_custom_rejects_non_barcode():
    assert resolve_barcode("SRR123456", "custom", {}) is None
    assert resolve_barcode("MFD00008.bin.2", "custom", {}) is None


def test_resolve_barcode_short_read_strips_bin_suffix():
    assert resolve_barcode("MFD00002_ilm_asm_bin10", "mfd-sr", {}) == "MFD00002"
    assert resolve_barcode("MFD00005", "mfd-sr", {}) == "MFD00005"


def test_resolve_barcode_short_read_drops_unknown():
    assert resolve_barcode("unknown_ilm_asm_bin3", "mfd-sr", {}) is None


def test_resolve_barcode_long_read_uses_ena_map():
    ena_map = {"GCA_963695025": "MFD10113"}
    assert resolve_barcode("GCA_963695025", "mfd-lr", ena_map) == "MFD10113"
    assert resolve_barcode("GCA_000000000", "mfd-lr", ena_map) is None


def test_resolve_barcode_bad_slug_raises():
    with pytest.raises(ValueError):
        resolve_barcode("MFD00001", "not-a-slug", {})


def _write(path, lines):
    path.write_text("\n".join(lines) + "\n")
    return path


def test_load_ena_map_dedupes_identical_repeats(tmp_path):
    p = _write(tmp_path / "ena.tsv", [
        "accession\tassembly_name\tbarcode",
        "GCA_1\tMFD01.bin.1\tMFD01",
        "GCA_1\tMFD01.bin.2\tMFD01",   # same accession + barcode -> keep one
        "GCA_2\tMFD02.bin.1\tMFD02",
    ])
    m = load_ena_map(p)
    assert m == {"GCA_1": "MFD01", "GCA_2": "MFD02"}


def test_load_ena_map_conflicting_barcode_raises(tmp_path):
    p = _write(tmp_path / "ena.tsv", [
        "accession\tassembly_name\tbarcode",
        "GCA_1\tMFD01.bin.1\tMFD01",
        "GCA_1\tMFD99.bin.1\tMFD99",   # same accession, DIFFERENT barcode -> error
    ])
    with pytest.raises(ValueError):
        load_ena_map(p)


def test_load_field_metadata_duplicate_barcode_raises(tmp_path):
    header = "\t".join(FIELD_COLUMNS)
    row = "MFD00001\tP\t2019-01-01\t1\t2\tsite\tYes\tSoil\tNatural\tForests\t\t\t91E0"
    p = _write(tmp_path / "field.tsv", [header, row, row])
    with pytest.raises(ValueError):
        load_field_metadata(p)


def test_load_crosswalk_duplicate_key_raises(tmp_path):
    header = ("mfd_sampletype\tmfd_areatype\tmfd_hab1\tmfd_hab2\tmfd_hab3\tn_samples\t"
              "gold_ecosystem_path\tenvironment_biome\tenvironment_feature\t"
              "environment_material\tenvironmental_package\tconfidence\tnotes")
    row = ("Soil\tNatural\tForests\t\t\t10\tEnvironmental:Terrestrial:Soil\tforest biome\t"
           "forest soil\tsoil\tsoil\thigh\t")
    p = _write(tmp_path / "cw.tsv", [header, row, row])
    with pytest.raises(ValueError):
        load_crosswalk(p)


def test_load_crosswalk_keys_and_values(tmp_path):
    header = ("mfd_sampletype\tmfd_areatype\tmfd_hab1\tmfd_hab2\tmfd_hab3\tn_samples\t"
              "gold_ecosystem_path\tenvironment_biome\tenvironment_feature\t"
              "environment_material\tenvironmental_package\tconfidence\tnotes")
    row = ("Soil\tNatural\tForests\t\t\t10\tEnvironmental:Terrestrial:Soil:Forest soil\t"
           "forest biome\tforest soil\tsoil\tsoil\thigh\tnote text")
    p = _write(tmp_path / "cw.tsv", [header, row])
    cw = load_crosswalk(p)
    assert list(cw.keys()) == [("Soil", "Natural", "Forests", "", "")]
    val = cw[("Soil", "Natural", "Forests", "", "")]
    assert val == {
        "gold_ecosystem_path": "Environmental:Terrestrial:Soil:Forest soil",
        "environment_biome": "forest biome",
        "environment_feature": "forest soil",
        "environment_material": "soil",
        "environmental_package": "soil",
    }


def test_load_crosswalk_is_name_based_not_positional(tmp_path):
    # a positional reader would transpose these swapped columns
    header = ("mfd_sampletype\tmfd_areatype\tmfd_hab1\tmfd_hab2\tmfd_hab3\tn_samples\t"
              "gold_ecosystem_path\tenvironment_biome\tenvironment_material\t"
              "environment_feature\tenvironmental_package\tconfidence\tnotes")
    row = ("Soil\tNatural\tForests\t\t\t10\tEnvironmental:Terrestrial:Soil:Forest soil\t"
           "forest biome\tsoil\tforest soil\tsoil\thigh\t")
    p = _write(tmp_path / "cw.tsv", [header, row])
    val = load_crosswalk(p)[("Soil", "Natural", "Forests", "", "")]
    assert val["environment_feature"] == "forest soil"
    assert val["environment_material"] == "soil"


def test_load_crosswalk_header_missing_column_raises(tmp_path):
    # drop the environment_feature column entirely
    header = ("mfd_sampletype\tmfd_areatype\tmfd_hab1\tmfd_hab2\tmfd_hab3\tn_samples\t"
              "gold_ecosystem_path\tenvironment_biome\t"
              "environment_material\tenvironmental_package\tconfidence\tnotes")
    row = ("Soil\tNatural\tForests\t\t\t10\tEnvironmental:Terrestrial:Soil\tforest biome\t"
           "soil\tsoil\thigh\t")
    p = _write(tmp_path / "cw.tsv", [header, row])
    with pytest.raises(ValueError):
        load_crosswalk(p)


def test_load_field_metadata_header_mismatch_raises(tmp_path):
    header = "\t".join(c for c in FIELD_COLUMNS if c != "coords_reliable")
    row = "\t".join(["x"] * (len(FIELD_COLUMNS) - 1))
    p = _write(tmp_path / "field.tsv", [header, row])
    with pytest.raises(ValueError):
        load_field_metadata(p)


def test_load_field_metadata_ragged_row_raises(tmp_path):
    header = "\t".join(FIELD_COLUMNS)
    short = "\t".join(["x"] * (len(FIELD_COLUMNS) - 1))  # one cell short
    p = _write(tmp_path / "field.tsv", [header, short])
    with pytest.raises(ValueError):
        load_field_metadata(p)

    long_row = "\t".join(["x"] * (len(FIELD_COLUMNS) + 1))  # one cell extra
    p2 = _write(tmp_path / "field2.tsv", [header, long_row])
    with pytest.raises(ValueError):
        load_field_metadata(p2)


def test_load_ena_map_header_mismatch_raises(tmp_path):
    p = _write(tmp_path / "ena.tsv", [
        "accession\twrong_name\tbarcode",   # 'assembly_name' renamed
        "GCA_1\tMFD01.bin.1\tMFD01",
    ])
    with pytest.raises(ValueError):
        load_ena_map(p)


def test_map_sample_fields_location_resolution_variants():
    for raw, expected in [("Masked", "masked"), ("No", "unreliable"),
                          ("Yes", "point"), ("", None)]:
        row = _meta(coords_reliable=raw)
        out = map_sample_fields(row, _crosswalk_for(row))
        assert out["location_resolution"] == expected


def test_map_sample_fields_masked_row():
    row = _meta(coords_reliable="Masked")
    out = map_sample_fields(row, _crosswalk_for(row))
    assert out["location_resolution"] == "masked"


def test_map_sample_fields_empty_lat_is_none():
    row = _meta(latitude="", longitude="")
    out = map_sample_fields(row, _crosswalk_for(row))
    assert out["latitude"] is None
    assert out["longitude"] is None


def test_map_sample_fields_numeric_coords():
    row = _meta(latitude="55.6771", longitude="9.27783")
    out = map_sample_fields(row, _crosswalk_for(row))
    assert out["latitude"] == pytest.approx(55.6771)
    assert out["longitude"] == pytest.approx(9.27783)


def test_map_sample_fields_constants_and_passthroughs():
    row = _meta(sampling_date="2019-08-29", sitename="Junges Plantage")
    out = map_sample_fields(row, _crosswalk_for(row))
    assert out["geographic_location"] == "Denmark"
    assert out["collection_date"] == "2019-08-29"
    assert out["geolocation_name"] == "Junges Plantage"


def test_map_sample_fields_empty_optional_fields_none():
    row = _meta(sampling_date="", sitename="")
    out = map_sample_fields(row, _crosswalk_for(row))
    assert out["collection_date"] is None
    assert out["geolocation_name"] is None


def test_map_sample_fields_crosswalk_values_flow_through():
    row = _meta()
    entry = _cw_entry(
        gold_ecosystem_path="Environmental:Terrestrial:Soil:Forest soil",
        environment_biome="forest biome",
        environment_feature="forest soil",
        environment_material="soil",
        environmental_package="soil",
    )
    out = map_sample_fields(row, _crosswalk_for(row, entry))
    assert out["gold_ecosystem_path"] == "Environmental:Terrestrial:Soil:Forest soil"
    assert out["environment_biome"] == "forest biome"
    assert out["environment_feature"] == "forest soil"
    assert out["environment_material"] == "soil"
    assert out["environmental_package"] == "soil"


def test_map_sample_fields_empty_crosswalk_value_becomes_none():
    row = _meta()
    entry = _cw_entry(environment_feature="")
    out = map_sample_fields(row, _crosswalk_for(row, entry))
    assert out["environment_feature"] is None


def test_map_sample_fields_missing_crosswalk_tuple_raises():
    row = _meta(mfd_hab1="Forests")
    other = _meta(mfd_hab1="Grassland formations")
    with pytest.raises(KeyError):
        map_sample_fields(row, _crosswalk_for(other))


def test_map_sample_fields_metadata_json_omits_empty_keys():
    row = _meta(
        fieldsample_barcode="MFD00042",
        project_id="P08_1",
        mfd_sampletype="Soil",
        mfd_areatype="Natural",
        mfd_hab1="Forests",
        mfd_hab2="",          # empty -> omitted
        mfd_hab3="",          # empty -> omitted
        habitat_typenumber="91E0",
    )
    out = map_sample_fields(row, _crosswalk_for(row))
    assert isinstance(out["metadata"], str)
    parsed = json.loads(out["metadata"])
    assert parsed["mfd"]["barcode"] == "MFD00042"
    assert parsed["mfd"]["project_id"] == "P08_1"
    assert parsed["mfd"]["sampletype"] == "Soil"
    assert parsed["mfd"]["areatype"] == "Natural"
    assert parsed["mfd"]["hab1"] == "Forests"
    assert parsed["mfd"]["habitat_typenumber"] == "91E0"
    assert "hab2" not in parsed["mfd"]
    assert "hab3" not in parsed["mfd"]


def test_map_sample_fields_metadata_json_is_compact():
    row = _meta()
    out = map_sample_fields(row, _crosswalk_for(row))
    assert ", " not in out["metadata"]
    assert '": ' not in out["metadata"]


def test_integration_crosswalk_covers_all_field_combos():
    """Every habitat 5-tuple in the field metadata is covered by the crosswalk."""
    field = load_field_metadata()
    crosswalk = load_crosswalk()
    for barcode, row in field.items():
        out = map_sample_fields(row, crosswalk)
        assert out["geographic_location"] == "Denmark"


def test_integration_row_and_barcode_counts():
    field = load_field_metadata()
    assert len(field) == 10875

    ena = load_ena_map()
    # 15,645 rows; 2 accessions repeat with the same barcode and dedupe.
    assert len(ena) == 15643
    assert len(set(ena.values())) == 153


def test_enrichment_constants():
    assert MAG_COLLECTION_SLUGS == frozenset({"mfd-sr", "mfd-lr"})
    assert CUSTOM_SOURCE_NAME == "custom_microflora_danica"


def test_enrichment_for_custom_barcode_resolves():
    out = enrichment_for("MFD00008", "custom")
    assert out is not None
    assert out["geographic_location"] == "Denmark"
    assert out["gold_ecosystem_path"]


def test_enrichment_for_short_read_strips_bin_suffix():
    out = enrichment_for("MFD00001_ilm_asm_bin4", "mfd-sr")   # -> barcode MFD00001
    assert out is not None
    ref = enrichment_for("MFD00001", "custom")               # same underlying barcode
    assert out == ref
    assert out["latitude"] == pytest.approx(55.6771)


def test_enrichment_for_long_read_via_ena_map():
    out = enrichment_for("GCA_963695025", "mfd-lr")           # ENA map -> MFD10113
    assert out is not None
    assert out == enrichment_for("MFD10113", "custom")


def test_enrichment_for_unknown_short_read_returns_none():
    assert enrichment_for("unknown_ilm_asm_bin3", "mfd-sr") is None


def test_enrichment_for_non_mfd_custom_accession_returns_none():
    assert enrichment_for("5O_Y1.1", "custom") is None


def test_enrichment_for_coordless_barcode_still_enriches():
    out = enrichment_for("MFD04008", "custom")
    assert out is not None
    assert out["latitude"] is None
    assert out["gold_ecosystem_path"]


def test_enrichment_for_caches_loaded_tables(monkeypatch):
    # the 3 TSVs load once (module singleton)
    import scripts.populator.adapters.mfd_metadata as mfd
    enrichment_for("MFD00008", "custom")
    boom = lambda *a, **k: (_ for _ in ()).throw(
        AssertionError("loader re-invoked after cache prime"))
    monkeypatch.setattr(mfd, "load_field_metadata", boom)
    monkeypatch.setattr(mfd, "load_ena_map", boom)
    monkeypatch.setattr(mfd, "load_crosswalk", boom)
    assert enrichment_for("MFD00001", "custom") is not None


def test_mfd_source_url_is_the_nature_paper():
    assert MFD_SOURCE_URL == "https://www.nature.com/articles/s41586-025-09794-2"


def test_mfd_source_names_uuid5_match_source_uuid_to_slug():
    # so the source_url UPDATE and the sample->study map can't drift
    ids = {str(entity_id("data_sources", n)) for n in MFD_SOURCE_NAMES}
    assert ids == set(SOURCE_UUID_TO_SLUG.keys())


def test_mfd_study_short_read_payload():
    nk, payload = mfd_study("mfd-sr")
    assert nk == "PRJNA1071982"
    assert payload["external_id"] == "PRJNA1071982"
    assert payload["accession"] == "PRJNA1071982"
    assert payload["bioproject"] == "PRJNA1071982"
    assert payload["secondary_accession"] == "SRP489326"
    assert payload["study_name"] == "Microflora Danica (short-read)"
    assert payload["study_type"] == "metagenomics"
    assert payload["data_source_ids"] == [
        str(entity_id("data_sources", "Microflora Danica (short-read)"))]


def test_mfd_study_custom_and_long_read_share_one_prjeb_study():
    c_nk, c = mfd_study("custom")
    lr_nk, lr = mfd_study("mfd-lr")
    assert c_nk == lr_nk == "PRJEB58634"
    assert c == lr
    assert c["study_name"] == "Microflora Danica (long-read)"
    assert c["secondary_accession"] == "ERP143702"


def test_mfd_study_prjeb_data_source_ids_are_custom_plus_long_read():
    _, payload = mfd_study("custom")
    expected = [str(entity_id("data_sources", "custom_microflora_danica")),
                str(entity_id("data_sources", "Microflora Danica (long-read)"))]
    assert payload["data_source_ids"] == expected
    # anchors the deterministic derivation to the known DB uuid
    assert payload["data_source_ids"][0] == "e05519ea-b3f0-5d54-b90e-bfd0b282ded2"


def test_mfd_study_metadata_json_per_study():
    _, a = mfd_study("mfd-lr")     # PRJEB58634 (long-read)
    _, b = mfd_study("mfd-sr")     # PRJNA1071982 (short-read)
    ma, mb = json.loads(a["metadata"]), json.loads(b["metadata"])
    assert ma["doi"] == "10.1038/s41586-025-09794-2"
    assert ma["journal"] == "Nature" and ma["year"] == 2026
    assert ma["sequencing"] == "Nanopore long-read"
    assert ma["cross_bioproject"] == "PRJNA1071982"
    assert ma["first_public"] == "2024-12-25"
    assert mb["sequencing"] == "Illumina short-read"
    assert mb["cross_bioproject"] == "PRJEB58634"
    assert mb["first_public"] == "2024-06-29"


def test_mfd_study_shared_title_center_abstract():
    _, p = mfd_study("mfd-sr")
    assert p["title"] == "The Microflora Danica atlas of Danish environmental microbiomes"
    assert p["center_name"] == "Center for Microbial Communities, Aalborg University"
    assert p["abstract"].startswith("Over the past 20 years")
    assert "Microflora Danica—an atlas" in p["abstract"]
    assert p["abstract"].rstrip().endswith("distribution and function.")
    assert "N2O emissions" in p["abstract"]


def test_mfd_study_non_mfd_slug_returns_none():
    assert mfd_study("gtdb") is None
    assert mfd_study("owc") is None
    assert mfd_study("not-a-slug") is None


def test_mfd_study_returns_fresh_copy_not_shared_template():
    _, p1 = mfd_study("custom")
    p1["study_name"] = "MUTATED"
    _, p2 = mfd_study("custom")
    assert p2["study_name"] == "Microflora Danica (long-read)"
