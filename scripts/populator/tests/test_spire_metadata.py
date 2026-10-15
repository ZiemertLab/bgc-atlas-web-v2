"""Tests for the SPIRE MAGs metadata adapter: ENA geo backbone (Phase 1) and
microntology -> GOLD ecosystem (Phase 2). Integration tests read the real committed TSVs.
"""
import json

import pytest

from scripts.populator.adapters.spire_metadata import (
    SPIRE_SOURCE_UUID,
    SPIRE_COLLECTION_SLUG,
    BIOSAMPLE_COLUMNS,
    FLAT_CROSSWALK,
    HOST_TAXON,
    HOST_SITE,
    load_accession_biosample,
    load_biosample_metadata,
    load_microntology_terms,
    load_biosample_microntology,
    map_sample_fields,
    enrichment_for,
    derive_gold,
    ecosystem_for,
    _host_gold,
)

CODE_SEA_FLOOR = "MICRONT:02020100"        # aquatic:marine:sea floor
CODE_HUMAN = "MICRONT:03020111"            # ...:primate host:human host
CODE_FECES = "MICRONT:03030141"            # ...:digestive tract:intestine:feces
CODE_ANIMAL_HOST = "MICRONT:03020000"      # host-associated:animal host
CODE_DIGESTIVE = "MICRONT:03030100"        # ...:animal host:digestive tract
CODE_SALINITY = "MICRONT:09010101"         # salinity:low salinity
CODE_TEMPERATURE = "MICRONT:09010201"      # temperature:very low temperature

TERM_HUMAN = "host-associated:animal host:mammalian host:primate host:human host"
TERM_FECES = "host-associated:animal host:digestive tract:intestine:feces"


def _row(**overrides):
    row = {c: "" for c in BIOSAMPLE_COLUMNS}
    row.update({
        "biosample": "SAMEA104408696",
        "lat": "57.32277778",
        "lon": "20.06055556",
        "location": "57.32277778 N 20.06055556 E",
        "collection_date": "2014-10-18T10:34:00",
        "depth": "100",
        "temperature": "5.18",
        "country": "Baltic Sea",
        "environment_biome": "Brackish water",
    })
    row.update(overrides)
    return row


def _write(path, lines):
    path.write_text("\n".join(lines) + "\n")
    return path


def test_provenance_constants():
    assert SPIRE_SOURCE_UUID == "39d4c94c-a005-5f46-b75b-4003cce8c01b"
    assert SPIRE_COLLECTION_SLUG == "spire"


def test_map_row_with_coords_gives_floats_point_and_metadata():
    out = map_sample_fields(_row(), "SAMEA104408696")
    assert out["latitude"] == pytest.approx(57.32277778)
    assert out["longitude"] == pytest.approx(20.06055556)
    assert out["location_resolution"] == "point"
    assert out["geographic_location"] == "Baltic Sea"
    assert out["environment_biome"] == "Brackish water"
    assert out["depth"] == pytest.approx(100.0)
    assert out["temperature"] == pytest.approx(5.18)
    assert out["collection_date"] == "2014-10-18"
    meta = json.loads(out["metadata"])
    assert meta["spire"]["biosample"] == "SAMEA104408696"
    assert ", " not in out["metadata"] and '": ' not in out["metadata"]


def test_map_empty_coords_gives_none_and_no_point():
    out = map_sample_fields(_row(lat="", lon=""), "SAMEA104408696")
    assert out["latitude"] is None and out["longitude"] is None
    assert out["location_resolution"] is None


def test_map_missing_one_coord_no_point():
    assert map_sample_fields(_row(lat="", lon="20.0"), "BS")["location_resolution"] is None
    assert map_sample_fields(_row(lat="57.0", lon=""), "BS")["location_resolution"] is None


def test_map_sentinel_depth_dropped():
    assert map_sample_fields(_row(depth="99999"), "BS")["depth"] is None
    assert map_sample_fields(_row(depth="-50 m"), "BS")["depth"] is None


def test_map_partial_and_invalid_date_dropped():
    for bad in ("2014", "2014-10", "2020-13-40", "01/01/09", ""):
        out = map_sample_fields(_row(collection_date=bad), "BS")
        assert out["collection_date"] is None, bad


def test_map_no_gold_or_environment_material_keys():
    out = map_sample_fields(_row(), "SAMEA104408696")
    for absent in ("gold_ecosystem_path", "environment_material",
                   "environment_feature", "environmental_package", "salinity"):
        assert absent not in out, absent


def test_map_empty_country_and_biome_none():
    out = map_sample_fields(_row(country="", environment_biome=""), "BS")
    assert out["geographic_location"] is None
    assert out["environment_biome"] is None


def test_map_non_numeric_temperature_none():
    assert map_sample_fields(_row(temperature="14.0;13.95"), "BS")["temperature"] is None


def test_load_accession_biosample_reads(tmp_path):
    p = _write(tmp_path / "ab.tsv", [
        "accession\tbiosample",
        "spire_mag_1\tSAMEA1",
        "specI_v4_2\tSAMN2",
    ])
    assert load_accession_biosample(p) == {"spire_mag_1": "SAMEA1", "specI_v4_2": "SAMN2"}


def test_load_accession_biosample_duplicate_raises(tmp_path):
    p = _write(tmp_path / "ab.tsv", [
        "accession\tbiosample",
        "spire_mag_1\tSAMEA1",
        "spire_mag_1\tSAMN2",
    ])
    with pytest.raises(ValueError):
        load_accession_biosample(p)


def test_load_accession_biosample_header_mismatch_raises(tmp_path):
    p = _write(tmp_path / "ab.tsv", ["accession\twrong", "spire_mag_1\tSAMEA1"])
    with pytest.raises(ValueError):
        load_accession_biosample(p)


def test_load_biosample_metadata_duplicate_raises(tmp_path):
    header = "\t".join(BIOSAMPLE_COLUMNS)
    row = "SAMEA1\t1\t2\tloc\t2020-01-01\t10\t3\tSea\tbiome"
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


def test_enrichment_for_known_accession_with_geo_resolves():
    # spire_mag_00000001 -> SAMEA104408696 (Baltic Sea, lat 57.32...)
    out = enrichment_for("spire_mag_00000001")
    assert out is not None
    assert out["latitude"] == pytest.approx(57.32277778)
    assert out["longitude"] == pytest.approx(20.06055556)
    assert out["location_resolution"] == "point"
    assert out["geographic_location"] == "Baltic Sea"
    assert json.loads(out["metadata"])["spire"]["biosample"] == "SAMEA104408696"
    assert "gold_ecosystem_path" not in out


def test_enrichment_for_accession_not_in_map_returns_none():
    assert enrichment_for("spire_mag_99999999") is None
    assert enrichment_for("specI_v4_00000") is None
    assert enrichment_for("not-a-spire-genome") is None


def test_enrichment_for_mapped_but_biosample_absent_from_metadata_returns_none():
    # spire_mag_02708129 -> SAMN15295319, which has NO row in the biosample metadata TSV
    assert enrichment_for("spire_mag_02708129") is None


def test_enrichment_for_caches_loaded_tables(monkeypatch):
    import scripts.populator.adapters.spire_metadata as spire
    enrichment_for("spire_mag_00000001")
    boom = lambda *a, **k: (_ for _ in ()).throw(
        AssertionError("loader re-invoked after cache prime"))
    monkeypatch.setattr(spire, "load_accession_biosample", boom)
    monkeypatch.setattr(spire, "load_biosample_metadata", boom)
    assert enrichment_for("spire_mag_00000001") is not None


def test_integration_accession_biosample_count_is_88351():
    assert len(load_accession_biosample()) == 88351


def test_integration_biosample_metadata_count_is_18904():
    assert len(load_biosample_metadata()) == 18904


def test_integration_every_biosample_row_survives_mapping():
    """Every ENA-attribute row maps without raising and keeps the biosample under spire."""
    meta = load_biosample_metadata()
    for biosample, row in meta.items():
        out = map_sample_fields(row, biosample)
        assert json.loads(out["metadata"])["spire"]["biosample"] == biosample
        assert "gold_ecosystem_path" not in out
        assert "environment_material" not in out


# Snapshot of every distinct GOLD path derive_gold produces over all 18,670 committed
# BioSamples; regenerate when the crosswalk or the tag file changes.
DERIVED_GOLD_PATHS = {
    'Engineered',
    'Engineered:Built environment',
    'Engineered:Built environment:Hospital',
    'Engineered:Food production:Dairy products',
    'Engineered:Food production:Fermented beverages',
    'Engineered:Lab enrichment',
    'Engineered:Solid waste',
    'Engineered:Solid waste:Composting',
    'Engineered:Wastewater',
    'Engineered:Wastewater:Sludge',
    'Environmental:Aquatic',
    'Environmental:Aquatic:Freshwater',
    'Environmental:Aquatic:Freshwater:Ice',
    'Environmental:Aquatic:Freshwater:Lake',
    'Environmental:Aquatic:Freshwater:Lake:Sediment',
    'Environmental:Aquatic:Freshwater:Lentic',
    'Environmental:Aquatic:Freshwater:River',
    'Environmental:Aquatic:Freshwater:Sediment',
    'Environmental:Aquatic:Marine',
    'Environmental:Aquatic:Marine:Hydrothermal vents',
    'Environmental:Aquatic:Marine:Intertidal zone',
    'Environmental:Aquatic:Marine:Intertidal zone:Estuary',
    'Environmental:Aquatic:Marine:Intertidal zone:Salt marsh',
    'Environmental:Aquatic:Marine:Oceanic:Aphotic zone',
    'Environmental:Aquatic:Marine:Oceanic:Photic zone',
    'Environmental:Aquatic:Marine:Pelagic zone',
    'Environmental:Aquatic:Marine:Sediment',
    'Environmental:Aquatic:Non-marine Saline and Alkaline',
    'Environmental:Aquatic:Sediment',
    'Environmental:Aquatic:Thermal springs',
    'Environmental:Aquatic:Thermal springs:Hot (42-90C)',
    'Environmental:Terrestrial',
    'Environmental:Terrestrial:Deep subsurface',
    'Environmental:Terrestrial:Geologic',
    # 'anthropogenic:mine' is generic mining, mostly not Acid Mine Drainage.
    'Environmental:Terrestrial:Geologic:Mine',
    'Environmental:Terrestrial:Soil',
    'Environmental:Terrestrial:Soil:Agricultural land',
    'Environmental:Terrestrial:Soil:Grasslands',
    'Environmental:Terrestrial:Soil:Peat',
    'Environmental:Terrestrial:Soil:Permafrost',
    'Environmental:Terrestrial:Soil:Wetlands',
    'Host-associated:Amphibia:Digestive system:Intestine:Fecal',
    'Host-associated:Birds:Digestive system',
    'Host-associated:Birds:Digestive system:Large intestine',
    'Host-associated:Birds:Digestive system:Large intestine:Fecal',
    'Host-associated:Birds:Integumentary system',
    'Host-associated:Fish:Digestive system:Intestine',
    'Host-associated:Fish:Digestive system:Intestine:Fecal',
    'Host-associated:Human',
    'Host-associated:Human:Circulatory system',
    'Host-associated:Human:Digestive system',
    'Host-associated:Human:Digestive system:Large intestine',
    'Host-associated:Human:Digestive system:Large intestine:Fecal',
    'Host-associated:Human:Digestive system:Oral cavity',
    'Host-associated:Human:Digestive system:Oral cavity:Saliva',
    'Host-associated:Human:Reproductive system',
    'Host-associated:Human:Reproductive system:Vagina',
    'Host-associated:Human:Respiratory system',
    'Host-associated:Human:Skin',
    'Host-associated:Insecta',
    'Host-associated:Insecta:Digestive system',
    'Host-associated:Insecta:Digestive system:Gut',
    'Host-associated:Invertebrates:Cnidaria',
    'Host-associated:Mammals',
    'Host-associated:Mammals:Digestive system',
    'Host-associated:Mammals:Digestive system:Large intestine',
    'Host-associated:Mammals:Digestive system:Large intestine:Fecal',
    'Host-associated:Mammals:Nervous system',
    'Host-associated:Mollusca',
    'Host-associated:Mollusca:Digestive system:Hindgut',
    'Host-associated:Plants',
    'Host-associated:Porifera',
    'Host-associated:Reptilia:Digestive system:Large intestine:Fecal',
}


def test_crosswalk_dicts_only_emit_valid_gold_prefixes():
    for term, path in FLAT_CROSSWALK.items():
        assert path.startswith(("Environmental:", "Engineered:", "Engineered")), (term, path)
    for leaf, taxon in HOST_TAXON.items():
        assert ":" not in taxon and taxon, (leaf, taxon)
    for leaf, site in HOST_SITE.items():
        assert site is None or (site and not site.startswith(":")), (leaf, site)


def test_host_gold_human_only():
    assert _host_gold({TERM_HUMAN}) == "Host-associated:Human"


def test_host_gold_human_plus_feces_appends_site():
    assert _host_gold({TERM_HUMAN, TERM_FECES}) == (
        "Host-associated:Human:Digestive system:Large intestine:Fecal")


def test_host_gold_site_only_defaults_to_mammals():
    # a digestive-tract body site with no named host -> Mammals
    assert _host_gold({"host-associated:animal host:digestive tract"}) == (
        "Host-associated:Mammals:Digestive system")


def test_host_gold_no_taxon_no_site():
    assert _host_gold({"host-associated:animal host"}) == "Host-associated"


def test_host_gold_none_site_leaf_contributes_no_segment():
    # 'eye' maps to None in HOST_SITE: taxon Human, no site
    assert _host_gold({TERM_HUMAN, "host-associated:animal host:eye"}) == (
        "Host-associated:Human")


def test_derive_gold_sea_floor():
    assert derive_gold([CODE_SEA_FLOOR]) == "Environmental:Aquatic:Marine:Sediment"


def test_derive_gold_human_plus_feces():
    assert derive_gold([CODE_HUMAN, CODE_FECES]) == (
        "Host-associated:Human:Digestive system:Large intestine:Fecal")


def test_derive_gold_generic_animal_digestive_defaults_mammals():
    # animal host + digestive tract, no taxon leaf -> Mammals:Digestive system
    assert derive_gold([CODE_ANIMAL_HOST, CODE_DIGESTIVE]) == (
        "Host-associated:Mammals:Digestive system")


def test_derive_gold_bare_host_falls_back_to_env():
    # a bare 'animal host' defers to the environmental context
    assert derive_gold([CODE_ANIMAL_HOST, CODE_SEA_FLOOR]) == (
        "Environmental:Aquatic:Marine:Sediment")


def test_derive_gold_bare_host_no_env_stays_host():
    assert derive_gold([CODE_ANIMAL_HOST]) == "Host-associated"


def test_derive_gold_physicochem_only_is_none():
    assert derive_gold([CODE_SALINITY, CODE_TEMPERATURE]) is None


def test_derive_gold_empty_is_none():
    assert derive_gold([]) is None


def test_derive_gold_unknown_codes_is_none():
    assert derive_gold(["MICRONT:99999999", "not-a-code"]) is None


def test_load_microntology_terms_reads_and_skips_blanks(tmp_path):
    p = _write(tmp_path / "t.tsv", [
        "category\tid\tterm\tdisplay_term",
        "aquatic\tMICRONT:02000000\taquatic\taquatic",
        "\t\t\t",  # blank separator row -> skipped
        "air\tMICRONT:05000000\tair\tair",
    ])
    code_term, code_cat = load_microntology_terms(p)
    assert code_term == {"MICRONT:02000000": "aquatic", "MICRONT:05000000": "air"}
    assert code_cat == {"MICRONT:02000000": "aquatic", "MICRONT:05000000": "air"}


def test_load_microntology_terms_duplicate_raises(tmp_path):
    p = _write(tmp_path / "t.tsv", [
        "category\tid\tterm",
        "aquatic\tMICRONT:02000000\taquatic",
        "aquatic\tMICRONT:02000000\taquatic",
    ])
    with pytest.raises(ValueError):
        load_microntology_terms(p)


def test_load_biosample_microntology_splits_and_filters(tmp_path):
    p = _write(tmp_path / "bm.tsv", [
        "biosample\tmicrontology",
        "SAMEA1\tMICRONT:02000000;MICRONT:02020100;junk;",
        "SAMEA2\t",
    ])
    out = load_biosample_microntology(p)
    assert out == {
        "SAMEA1": ["MICRONT:02000000", "MICRONT:02020100"],
        "SAMEA2": [],
    }


def test_load_biosample_microntology_duplicate_raises(tmp_path):
    p = _write(tmp_path / "bm.tsv", [
        "biosample\tmicrontology",
        "SAMEA1\tMICRONT:02000000",
        "SAMEA1\tMICRONT:05000000",
    ])
    with pytest.raises(ValueError):
        load_biosample_microntology(p)


def test_ecosystem_for_human_biosample_resolves():
    # spire_mag_02412046 -> SAMD00046792 (host + human host + feces)
    out = ecosystem_for("spire_mag_02412046")
    assert out is not None
    assert out["gold_ecosystem_path"] == (
        "Host-associated:Human:Digestive system:Large intestine:Fecal")
    meta = json.loads(out["metadata"])
    assert isinstance(meta["microntology"], list) and meta["microntology"]
    assert TERM_HUMAN in meta["microntology"]
    assert meta["microntology"] == sorted(set(meta["microntology"]))
    assert ", " not in out["metadata"] and '": ' not in out["metadata"]


def test_ecosystem_for_marine_biosample_resolves_environmental():
    # spire_mag_00707858 -> SAMEA4470835 (aquatic marine sea floor + others)
    out = ecosystem_for("spire_mag_00707858")
    assert out is not None
    assert out["gold_ecosystem_path"].startswith("Environmental:Aquatic")


def test_ecosystem_for_accession_not_in_map_returns_none():
    assert ecosystem_for("spire_mag_99999999") is None
    assert ecosystem_for("not-a-spire-genome") is None


def test_ecosystem_for_caches_loaded_tables(monkeypatch):
    import scripts.populator.adapters.spire_metadata as spire
    ecosystem_for("spire_mag_02412046")
    boom = lambda *a, **k: (_ for _ in ()).throw(
        AssertionError("loader re-invoked after cache prime"))
    monkeypatch.setattr(spire, "load_microntology_terms", boom)
    monkeypatch.setattr(spire, "load_biosample_microntology", boom)
    assert ecosystem_for("spire_mag_02412046") is not None


def test_integration_biosample_microntology_count_is_18670():
    assert len(load_biosample_microntology()) == 18670


def test_integration_every_biosample_derives_valid_or_none():
    bm = load_biosample_microntology()
    derived = set()
    for biosample, codes in bm.items():
        gold = derive_gold(codes)
        if gold is None:
            continue
        assert gold and gold.startswith(
            ("Environmental", "Host-associated", "Engineered")), (biosample, gold)
        derived.add(gold)
    print(f"\ndistinct derived GOLD paths over {len(bm)} biosamples: {len(derived)}")
    assert derived == DERIVED_GOLD_PATHS
    assert len(derived) == 73


from scripts.populator.adapters import spire_metadata  # noqa: E402


def test_envo_for_term_marine_sediment():
    e = spire_metadata._envo_for_term("aquatic:marine:sea floor")
    assert e == {"environment_biome": "marine biome", "environment_feature": "sea floor",
                 "environment_material": "marine sediment"}


def test_envo_for_term_longest_prefix_wins():
    # sea floor (marine sediment) must beat the shorter aquatic:marine (sea water) prefix
    assert spire_metadata._envo_for_term("aquatic:marine:sea floor")["environment_material"] \
        == "marine sediment"
    assert spire_metadata._envo_for_term("aquatic:marine")["environment_material"] == "sea water"


def test_envo_for_term_host_feces_and_soil():
    assert spire_metadata._envo_for_term(
        "host-associated:animal host:digestive tract:intestine:feces") == {
        "environment_biome": "host-associated habitat",
        "environment_feature": "feces", "environment_material": "feces"}
    assert spire_metadata._envo_for_term("terrestrial:forest")["environment_biome"] == "forest biome"


def test_envo_for_real_accession_full_triad():
    e = spire_metadata.envo_for("spire_mag_00000001")
    assert e and e["environment_biome"] and e["environment_feature"] and e["environment_material"]


def test_envo_for_unmapped_accession_is_none():
    assert spire_metadata.envo_for("specI_v4_99999") is None


def test_envo_integration_every_micront_biosample_resolves():
    ab = spire_metadata.load_accession_biosample()
    bm = spire_metadata.load_biosample_microntology()
    n = miss = 0
    for acc, bs in ab.items():
        if bs not in bm:
            continue
        n += 1
        if spire_metadata.envo_for(acc) is None:
            miss += 1
    assert n > 80000 and miss == 0
