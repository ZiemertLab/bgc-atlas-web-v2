import pytest
from scripts.populator.adapters import metalog, archive

def test_bgc_filename_matches_bgc_to_gcf_convention(monkeypatch):
    # the GCF-critical convention: {sample}_{contig}.region{NNN}
    from scripts.populator.adapters._antismash_emit import bgc_filename
    assert bgc_filename("5O_Y1.1", "k141_101979", 1) == "5O_Y1.1_k141_101979.region001"

def test_emit_archive_via_mocked_json(monkeypatch):
    fake = {"taxon": "bacteria", "records": [
        {"id": "k141_101979",
         "areas": [{"start": 0, "end": 6000, "products": ["terpene"],
                    "protoclusters": {"0": {"category": "terpene", "core_start": 100,
                                            "core_end": 5000, "product": "terpene"}}}],
         "features": [{"type": "region", "location": "[0:6000](+)",
                       "qualifiers": {"region_number": ["1"], "contig_edge": ["False"]}}]}]}
    monkeypatch.setattr(metalog, "load_regions_json", lambda p: fake)
    recs = list(metalog.emit_archive("/x/5O_Y1.1.tar.gz"))
    ds = next(r for r in recs if r.table == "data_sources")
    assert ds.fields["name"] == "metalog" and ds.fields["source_type"] == "third_party"
    bgc = next(r for r in recs if r.table == "bgcs")
    assert bgc.fields["filename"] == "5O_Y1.1_k141_101979.region001"
    assert bgc.refs["assembly"][0] == "assemblies"
    samp = next(r for r in recs if r.table == "samples")
    assert samp.fields["name"] == "5O_Y1.1"

def test_emitted_records_finalize_without_errors(monkeypatch):
    from scripts.populator.core.registry import Registry
    fake = {"taxon": "bacteria", "records": [
        {"id": "k141_1", "areas": [{"start": 0, "end": 100, "products": ["x"],
          "protoclusters": {}}],
         "features": [{"type": "region", "location": "[0:100](+)",
                       "qualifiers": {"region_number": ["1"], "contig_edge": ["True"]}}]}]}
    monkeypatch.setattr(metalog, "load_regions_json", lambda p: fake)
    reg = Registry()
    for r in metalog.emit_archive("/x/5O_Y1.1.tar.gz"):
        reg.add(r)
    tables = reg.finalize()
    assert tables["bgcs"] and tables["antismash_runs"] and tables["data_sources"]

def test_emit_archive_with_env_enriches_sample(monkeypatch, tmp_path):
    import pathlib
    from scripts.populator.adapters import metalog
    fake = {"taxon": "bacteria", "records": [{"id": "k141_1",
            "areas": [{"start": 0, "end": 100, "products": ["x"], "protoclusters": {}}],
            "features": [{"type": "region", "location": "[0:100](+)",
                          "qualifiers": {"region_number": ["1"], "contig_edge": ["True"]}}]}]}
    monkeypatch.setattr(metalog, "load_regions_json", lambda p: fake)
    env = pathlib.Path(__file__).parent / "fixtures" / "metalog_env_small.tsv"
    recs = list(metalog.emit_archive("/x/5O_Y1.1.tar.gz", str(env)))
    samp = next(r for r in recs if r.table == "samples")
    assert samp.fields["name"] == "5O_Y1.1"
    assert samp.fields["latitude"] == 33.65
    assert samp.fields["environment_biome"].startswith("terrestrial biome")

_FAKE_REGIONS = {"taxon": "bacteria", "records": [{"id": "k141_1",
    "areas": [{"start": 0, "end": 100, "products": ["x"], "protoclusters": {}}],
    "features": [{"type": "region", "location": "[0:100](+)",
                  "qualifiers": {"region_number": ["1"], "contig_edge": ["True"]}}]}]}


def test_bgc_carries_anchor_from_regions_js(monkeypatch):
    monkeypatch.setattr(metalog, "load_regions_json", lambda p: _FAKE_REGIONS)
    monkeypatch.setattr(metalog, "region_anchor_map", lambda p: {("k141_1", 1): "r9c1"})
    recs = list(metalog.emit_archive("/x/5O_Y1.1.tar.gz"))
    bgc = next(r for r in recs if r.table == "bgcs")
    assert bgc.fields["anchor"] == "r9c1"


def test_bgc_anchor_none_when_regions_js_absent(monkeypatch):
    monkeypatch.setattr(metalog, "load_regions_json", lambda p: _FAKE_REGIONS)
    monkeypatch.setattr(metalog, "region_anchor_map", lambda p: {})
    recs = list(metalog.emit_archive("/x/5O_Y1.1.tar.gz"))
    bgc = next(r for r in recs if r.table == "bgcs")
    assert bgc.fields["anchor"] is None


def test_parse_envo():
    from scripts.populator.adapters.metalog_metadata import parse_envo
    assert parse_envo("soil [ENVO:00001998]") == ("soil", "ENVO:00001998")
    assert parse_envo("marine biome") == ("marine biome", None)
    assert parse_envo("") == (None, None)
    assert parse_envo("   ") == (None, None)
    assert parse_envo(None) == (None, None)


def test_biome_nk():
    from scripts.populator.adapters.metalog_metadata import biome_nk
    assert biome_nk("soil", "ENVO:00001998") == "envo:ENVO:00001998"
    # text-only terms dedup on lower(name), matching the schema
    assert biome_nk("Marine Biome", None) == "name:marine biome"


def test_emit_archive_emits_envo_biomes_and_links(monkeypatch):
    import json, pathlib
    monkeypatch.setattr(metalog, "load_regions_json", lambda p: _FAKE_REGIONS)
    env = pathlib.Path(__file__).parent / "fixtures" / "metalog_env_small.tsv"
    recs = list(metalog.emit_archive("/x/5O_Y1.1.tar.gz", str(env)))
    biomes = {r.natural_key: r for r in recs if r.table == "biomes"}
    # 5O_Y1.1 row: biome 'terrestrial biome [ENVO:00000446]', feature 'feat2',
    # material 'soil' -> one ENVO biome + two text-only biomes
    assert set(biomes) == {"envo:ENVO:00000446", "name:feat2", "name:soil"}
    envo = biomes["envo:ENVO:00000446"]
    assert envo.fields["name"] == "terrestrial biome"          # label, bracket stripped
    assert json.loads(envo.fields["metadata"]) == {
        "envo_id": "ENVO:00000446", "from_field": "environment_biome"}
    soil = biomes["name:soil"]
    assert soil.fields["name"] == "soil"
    assert json.loads(soil.fields["metadata"]) == {
        "envo_id": None, "from_field": "environment_material"}
    sb = [r for r in recs if r.table == "sample_biomes"]
    assert len(sb) == 3
    assert all(r.refs["sample_id"] == ("samples", "metalog|5O_Y1.1") for r in sb)
    assert {r.refs["biome_id"][1] for r in sb} == set(biomes)


def test_sample_env_field_is_parsed_label_not_raw(monkeypatch):
    import pathlib
    monkeypatch.setattr(metalog, "load_regions_json", lambda p: _FAKE_REGIONS)
    env = pathlib.Path(__file__).parent / "fixtures" / "metalog_env_small.tsv"
    recs = list(metalog.emit_archive("/x/5O_Y1.1.tar.gz", str(env)))
    samp = next(r for r in recs if r.table == "samples")
    assert samp.fields["environment_biome"] == "terrestrial biome"   # NOT the raw '[ENVO:...]'
    assert samp.fields["environment_material"] == "soil"


def test_envo_canonical_from_field_first_seen_in_file_order(tmp_path):
    """A shared envo_id takes the from_field of the first row in file order."""
    from scripts.populator.adapters.metalog_metadata import load_env_metadata
    tsv = tmp_path / "env.tsv"
    tsv.write_text(
        "spire_sample_name\tsample_alias\tenvironment_biome\tenvironment_feature\tenvironment_material\n"
        "S1\tA1\t\tmud [ENVO:9]\t\n"        # ENVO:9 first seen here, as a feature
        "S2\tA2\tmud [ENVO:9]\t\t\n")       # later seen as a biome -> ignored
    lk = load_env_metadata(str(tsv))
    expected = [("envo:ENVO:9", "mud", "ENVO:9", "environment_feature")]
    assert lk.biomes_for("S1") == expected
    assert lk.biomes_for("S2") == expected


def test_cross_sample_envo_biome_dedup_in_registry(monkeypatch, tmp_path):
    """Two samples sharing an ENVO term emit one biomes row and two links."""
    from scripts.populator.core.registry import Registry
    monkeypatch.setattr(metalog, "load_regions_json", lambda p: _FAKE_REGIONS)
    tsv = tmp_path / "env.tsv"
    tsv.write_text(
        "spire_sample_name\tsample_alias\tenvironment_biome\tenvironment_feature\tenvironment_material\n"
        "S1\tA1\tsoil [ENVO:00001998]\t\t\n"
        "S2\tA2\tsoil [ENVO:00001998]\t\t\n")
    reg = Registry()
    for arch in ("/x/S1.tar.gz", "/x/S2.tar.gz"):
        for r in metalog.emit_archive(arch, str(tsv)):
            reg.add(r)
    tables = reg.finalize()
    assert len(tables["biomes"]) == 1
    assert tables["biomes"][0]["name"] == "soil"
    sb = tables["sample_biomes"]
    assert len(sb) == 2
    bid = tables["biomes"][0]["id"]
    assert {x["biome_id"] for x in sb} == {bid}


def test_biomes_for_dedups_term_repeated_within_a_row(tmp_path):
    """Within a row, a repeated term keeps the highest-priority field
    (biome>feature>material)."""
    from scripts.populator.adapters.metalog_metadata import load_env_metadata
    tsv = tmp_path / "env.tsv"
    tsv.write_text(
        "spire_sample_name\tsample_alias\tenvironment_biome\tenvironment_feature\tenvironment_material\n"
        "S1\tA1\tsoil [ENVO:9]\tsoil [ENVO:9]\t\n")
    lk = load_env_metadata(str(tsv))
    assert lk.biomes_for("S1") == [("envo:ENVO:9", "soil", "ENVO:9", "environment_biome")]


def test_sample_without_env_match_emits_no_biomes(monkeypatch):
    """No env match: the sample is emitted but no biomes or links."""
    import pathlib
    monkeypatch.setattr(metalog, "load_regions_json", lambda p: _FAKE_REGIONS)
    env = pathlib.Path(__file__).parent / "fixtures" / "metalog_env_small.tsv"
    recs = list(metalog.emit_archive("/x/NOMATCH_SAMPLE.tar.gz", str(env)))
    assert any(r.table == "samples" for r in recs)
    assert not any(r.table == "biomes" for r in recs)
    assert not any(r.table == "sample_biomes" for r in recs)


def test_find_regions_json_member_real_archive():
    import tarfile, pathlib
    arch = pathlib.Path("/data/bgc-atlas/data-v2/metalog_antismash_runs/5O_Y1.1.tar.gz")
    if not arch.exists():
        pytest.skip("metalog archive not present")
    with tarfile.open(arch, "r:gz") as t:
        m = archive.find_regions_json_member(t)
    assert m is not None and m.endswith("_regions.json")

def test_gcf_reconciliation_real_archive():
    import pathlib, subprocess
    arch = pathlib.Path("/data/bgc-atlas/data-v2/metalog_antismash_runs/5O_Y1.1.tar.gz")
    gcf = pathlib.Path("/data/bgc-atlas/data-v2/bgc_to_gcf.tsv")
    if not arch.exists() or not gcf.exists():
        pytest.skip("metalog archive or gcf map not present")
    fns = {r.fields["filename"] for r in metalog.emit_archive(str(arch)) if r.table == "bgcs"}
    assert fns, "expected some BGCs from the archive"
    # bgc_id is column 1 of bgc_to_gcf.tsv; grep this sample's prefix to avoid
    # scanning the full 1.8GB file.
    out = subprocess.run(["grep", "-F", "5O_Y1.1_", str(gcf)],
                         capture_output=True, text=True).stdout
    mapped = {line.split("\t")[1] for line in out.splitlines()
              if len(line.split("\t")) >= 2}
    missing = fns - mapped
    assert not missing, (f"{len(missing)} metalog BGC filenames absent from the GCF "
                         f"map (filename convention regressed): {sorted(missing)[:3]}")


def test_real_archive_anchors_match_regions_js():
    import pathlib, re as _re
    from scripts.populator.adapters.anchors import region_anchor_map
    arch = pathlib.Path("/data/bgc-atlas/data-v2/metalog_antismash_runs/5O_Y1.1.tar.gz")
    if not arch.exists():
        pytest.skip("metalog archive not present")
    amap = region_anchor_map(str(arch))
    assert amap, "expected a non-empty anchor map from real regions.js"
    bgcs = [r for r in metalog.emit_archive(str(arch)) if r.table == "bgcs"]
    assert bgcs
    anchored = 0
    for r in bgcs:
        contig = r.fields["contig"]
        rnum = int(_re.search(r"\.region(\d+)$", r.fields["filename"]).group(1))
        expected = amap.get((contig, rnum))
        if expected is not None:
            assert r.fields["anchor"] == expected
            anchored += 1
    assert anchored > 0, "no BGC matched a regions.js anchor — wiring regressed"


def _study_env_tsv(tmp_path, rows):
    """Minimal metalog env TSV with the join + study columns."""
    cols = ["spire_sample_name", "sample_alias", "study_code", "study_accession", "pmid", "doi"]
    p = tmp_path / "env.tsv"
    p.write_text("\t".join(cols) + "\n" +
                 "\n".join("\t".join(r.get(c, "") for c in cols) for r in rows) + "\n")
    return str(p)


def test_study_for_code_only_from_fixture():
    import pathlib
    from scripts.populator.adapters.metalog_metadata import load_env_metadata
    env = load_env_metadata(str(pathlib.Path(__file__).parent / "fixtures" / "metalog_env_small.tsv"))
    key, fields = env.study_for("5O_Y1.1")
    assert key == "StudyB"                          # study_code is the key (no accession)
    assert fields == {"study_name": "StudyB"}       # no accession, no pmid/doi metadata


def test_study_for_accession_is_the_key_with_metadata(tmp_path):
    import json
    from scripts.populator.adapters.metalog_metadata import load_env_metadata
    env = load_env_metadata(_study_env_tsv(tmp_path, [
        {"spire_sample_name": "S1", "sample_alias": "A1", "study_code": "Bahram_2018_soil",
         "study_accession": "PRJEB19855, PRJEB18701", "pmid": "30069051", "doi": "10.1038/x"}]))
    key, fields = env.study_for("S1")
    assert key == "PRJEB19855, PRJEB18701"          # accession (verbatim, comma-joined) is the dedup key
    assert fields["study_name"] == "Bahram_2018_soil"
    assert fields["accession"] == "PRJEB19855, PRJEB18701"
    assert json.loads(fields["metadata"]) == {"pmid": "30069051", "doi": "10.1038/x"}


def test_emit_archive_emits_study_and_link(monkeypatch, tmp_path):
    env = _study_env_tsv(tmp_path, [
        {"spire_sample_name": "5O_Y1.1", "sample_alias": "A1", "study_code": "StudyX",
         "study_accession": "PRJEBX"}])
    monkeypatch.setattr(metalog, "load_regions_json", lambda p: _FAKE_REGIONS)
    recs = list(metalog.emit_archive("/x/5O_Y1.1.tar.gz", env))
    st = next(r for r in recs if r.table == "studies")
    assert st.natural_key == "metalog|PRJEBX"       # scoped on the accession key
    assert st.fields["study_name"] == "StudyX" and st.fields["accession"] == "PRJEBX"
    assert "metadata" not in st.fields and "external_id" not in st.fields
    ss = next(r for r in recs if r.table == "study_samples")
    assert ss.refs["study_id"] == ("studies", "metalog|PRJEBX")
    assert ss.refs["sample_id"] == ("samples", "metalog|5O_Y1.1")


def test_study_dedups_across_samples_in_registry(monkeypatch, tmp_path):
    from scripts.populator.core.registry import Registry
    env = _study_env_tsv(tmp_path, [
        {"spire_sample_name": "S1", "sample_alias": "A1", "study_code": "ST", "study_accession": "PRJ1"},
        {"spire_sample_name": "S2", "sample_alias": "A2", "study_code": "ST", "study_accession": "PRJ1"}])
    monkeypatch.setattr(metalog, "load_regions_json", lambda p: _FAKE_REGIONS)
    reg = Registry()
    for arch in ("/x/S1.tar.gz", "/x/S2.tar.gz"):
        for r in metalog.emit_archive(arch, env):
            reg.add(r)
    tables = reg.finalize()
    assert len(tables["studies"]) == 1
    assert len(tables["study_samples"]) == 2


def test_study_fields_deterministic_first_seen_under_divergent_rows(tmp_path):
    """Divergent pmids resolve to the first-seen field set, so the study row is
    deterministic regardless of archive completion order."""
    import json
    from scripts.populator.adapters.metalog_metadata import load_env_metadata
    env = load_env_metadata(_study_env_tsv(tmp_path, [
        {"spire_sample_name": "S1", "sample_alias": "A1", "study_code": "ST",
         "study_accession": "PRJ1", "pmid": "111"},                # row 1 has pmid
        {"spire_sample_name": "S2", "sample_alias": "A2", "study_code": "ST",
         "study_accession": "PRJ1"}]))                             # row 2 has none
    assert env.study_for("S1") == env.study_for("S2")
    assert json.loads(env.study_for("S2")[1]["metadata"]) == {"pmid": "111"}  # first-seen wins


def test_study_for_accession_only_no_study_name(tmp_path):
    from scripts.populator.adapters.metalog_metadata import load_env_metadata
    env = load_env_metadata(_study_env_tsv(tmp_path, [
        {"spire_sample_name": "S1", "sample_alias": "A1", "study_accession": "PRJONLY"}]))
    key, fields = env.study_for("S1")
    assert key == "PRJONLY" and fields == {"accession": "PRJONLY"}   # no study_name (no study_code)


def _measurements_tsv(tmp_path, rows):
    cols = ["sample_alias", "metadata_item", "curation_tier", "value"]
    p = tmp_path / "long.tsv"
    p.write_text("\t".join(cols) + "\n" +
                 "\n".join("\t".join(r.get(c, "") for c in cols) for r in rows) + "\n")
    return str(p)


def test_load_measurements_indexes_by_alias(tmp_path):
    from scripts.populator.adapters.metalog_metadata import load_measurements
    m = load_measurements(_measurements_tsv(tmp_path, [
        {"sample_alias": "A1", "metadata_item": "depth", "curation_tier": "core", "value": "10"},
        {"sample_alias": "A1", "metadata_item": "ph", "curation_tier": "all", "value": "7.2"},
        {"sample_alias": "A1", "metadata_item": "salinity", "curation_tier": "core", "value": ""},
        {"sample_alias": "A2", "metadata_item": "depth", "curation_tier": "core", "value": "5"},
        {"sample_alias": "A2", "metadata_item": "", "curation_tier": "core", "value": "orphan"},
        {"sample_alias": "", "metadata_item": "x", "curation_tier": "core", "value": "v"}]))
    # curation_tier dropped, order preserved; empty value kept as "" (value is NOT NULL in DB)
    assert m["A1"] == [("depth", "10"), ("ph", "7.2"), ("salinity", "")]
    assert m["A2"] == [("depth", "5")]
    assert "" not in m


def test_measurements_for_via_wide_alias(tmp_path):
    from scripts.populator.adapters.metalog_metadata import load_env_metadata
    wide = _study_env_tsv(tmp_path, [{"spire_sample_name": "S1", "sample_alias": "A1"}])
    long = _measurements_tsv(tmp_path, [{"sample_alias": "A1", "metadata_item": "depth", "value": "10"}])
    env = load_env_metadata(wide, long)
    assert env.measurements_for("S1") == [("depth", "10")]   # resolved via the wide-row alias A1
    assert env.measurements_for("NOPE") == []
    assert load_env_metadata(wide).measurements_for("S1") == []


def test_emit_archive_emits_sample_measurements(monkeypatch, tmp_path):
    wide = _study_env_tsv(tmp_path, [{"spire_sample_name": "5O_Y1.1", "sample_alias": "A1"}])
    long = _measurements_tsv(tmp_path, [
        {"sample_alias": "A1", "metadata_item": "depth", "value": "10"},
        {"sample_alias": "A1", "metadata_item": "ph", "value": "7.2"}])
    monkeypatch.setattr(metalog, "load_regions_json", lambda p: _FAKE_REGIONS)
    recs = list(metalog.emit_archive("/x/5O_Y1.1.tar.gz", {"env": wide, "measurements": long}))
    sm = {r.natural_key: r for r in recs if r.table == "sample_measurements"}
    assert set(sm) == {"metalog|5O_Y1.1|depth", "metalog|5O_Y1.1|ph"}
    assert sm["metalog|5O_Y1.1|depth"].fields == {
        "key": "depth", "value": "10", "source": "metalog_long_all"}
    assert sm["metalog|5O_Y1.1|depth"].refs["sample_id"] == ("samples", "metalog|5O_Y1.1")


def test_emit_archive_promotes_env_analytes_to_sample(monkeypatch, tmp_path):
    wide = _study_env_tsv(tmp_path, [{"spire_sample_name": "5O_Y1.1", "sample_alias": "A1"}])
    long = _measurements_tsv(tmp_path, [
        {"sample_alias": "A1", "metadata_item": "salinity_psu", "value": "35.1"},
        {"sample_alias": "A1", "metadata_item": "oxygen_um", "value": "230"},
        {"sample_alias": "A1", "metadata_item": "nitrate", "value": "5"},
        # a trap: COD must NOT populate dissolved_oxygen
        {"sample_alias": "A1", "metadata_item": "chemical_oxygen_demand_mg_per_l", "value": "99"}])
    monkeypatch.setattr(metalog, "load_regions_json", lambda p: _FAKE_REGIONS)
    recs = list(metalog.emit_archive("/x/5O_Y1.1.tar.gz", {"env": wide, "measurements": long}))
    sample = next(r for r in recs
                  if r.table == "samples" and r.natural_key == "metalog|5O_Y1.1")
    f = sample.fields
    assert f["salinity"] == 35.1 and f["salinity_unit"] == "psu"
    assert f["dissolved_oxygen"] == 230.0 and f["dissolved_oxygen_unit"] == "uM"
    assert f["nitrate"] == 5.0
    # measurements still also emitted as raw KV rows (unchanged behaviour)
    assert any(r.table == "sample_measurements" for r in recs)


def test_str_dataset_emits_no_measurements(monkeypatch):
    import pathlib
    monkeypatch.setattr(metalog, "load_regions_json", lambda p: _FAKE_REGIONS)
    env = str(pathlib.Path(__file__).parent / "fixtures" / "metalog_env_small.tsv")
    recs = list(metalog.emit_archive("/x/5O_Y1.1.tar.gz", env))
    assert not any(r.table == "sample_measurements" for r in recs)


# --- study overrides ---

def test_key_by_code_groups_per_row_accessions_into_one_study(tmp_path):
    """Seitz_2016_estuary: each row carries its own study_accession. key_by_code makes ONE
    study keyed on the code, its accession the sorted distinct accessions comma-joined."""
    from scripts.populator.adapters.metalog_metadata import load_env_metadata
    env = load_env_metadata(_study_env_tsv(tmp_path, [
        {"spire_sample_name": "S1", "sample_alias": "A1", "study_code": "Seitz", "study_accession": "PRJ2"},
        {"spire_sample_name": "S2", "sample_alias": "A2", "study_code": "Seitz", "study_accession": "PRJ1"},
        {"spire_sample_name": "S3", "sample_alias": "A3", "study_code": "Other", "study_accession": "PRJ9"}]),
        key_by_code=["Seitz"])
    assert env.study_for("S1") == env.study_for("S2")
    key, fields = env.study_for("S1")
    assert key == "Seitz"
    assert fields == {"study_name": "Seitz", "accession": "PRJ1, PRJ2"}
    assert env.study_for("S3")[0] == "PRJ9"          # codes not listed keep the default rule


def test_existing_study_override_links_to_foreign_nk(monkeypatch, tmp_path):
    """PRJEB13832_sewage -> the live MGnify study: the sample links to that study's nk and
    the emitted studies row is a fields-less stub (the loader inserts it ON CONFLICT DO
    NOTHING), so the existing row is never overwritten."""
    env = _study_env_tsv(tmp_path, [
        {"spire_sample_name": "5O_Y1.1", "sample_alias": "A1", "study_code": "PRJEB13832_sewage"}])
    monkeypatch.setattr(metalog, "load_regions_json", lambda p: _FAKE_REGIONS)
    ds = {"env": env, "study_overrides": {"existing": {"PRJEB13832_sewage": "mgnify|MGYS00005418"}}}
    recs = list(metalog.emit_archive("/x/5O_Y1.1.tar.gz", ds))
    st = [r for r in recs if r.table == "studies"]
    assert len(st) == 1 and st[0].natural_key == "mgnify|MGYS00005418" and st[0].fields == {}
    ss = next(r for r in recs if r.table == "study_samples")
    assert ss.refs["study_id"] == ("studies", "mgnify|MGYS00005418")
    from scripts.populator.ids import entity_id
    assert str(entity_id("studies", "mgnify|MGYS00005418")) == "eab2f947-d06a-5487-8b72-76840e6f74c5"


def test_key_by_code_via_dataset_dict(monkeypatch, tmp_path):
    env = _study_env_tsv(tmp_path, [
        {"spire_sample_name": "5O_Y1.1", "sample_alias": "A1", "study_code": "Seitz", "study_accession": "PRJ1"}])
    monkeypatch.setattr(metalog, "load_regions_json", lambda p: _FAKE_REGIONS)
    ds = {"env": env, "study_overrides": {"key_by_code": ["Seitz"]}}
    st = next(r for r in metalog.emit_archive("/x/5O_Y1.1.tar.gz", ds) if r.table == "studies")
    assert st.natural_key == "metalog|Seitz"


def test_current_layout_temperature_column(tmp_path):
    """metalog renamed current_temperature -> temperature; both map to samples.temperature."""
    from scripts.populator.adapters.metalog_metadata import load_env_metadata
    p = tmp_path / "env.tsv"
    p.write_text("sample_alias\tspire_sample_name\ttemperature\nA1\tS1\t4.5\n")
    assert load_env_metadata(str(p)).fields_for("S1")["temperature"] == 4.5


def test_override_code_absent_from_env_file_raises(tmp_path):
    from scripts.populator.adapters.metalog_metadata import load_env_metadata
    p = _study_env_tsv(tmp_path, [{"spire_sample_name": "S1", "sample_alias": "A1", "study_code": "Seitz"}])
    with pytest.raises(ValueError, match="Seitzz"):
        load_env_metadata(p, key_by_code=["Seitzz"])
    with pytest.raises(ValueError, match="Nope"):
        load_env_metadata(p, required_codes=["Nope"])


def test_existing_override_follows_the_rows_own_code(monkeypatch, tmp_path):
    """Two codes sharing one accession: the override applies to the row's OWN code,
    not the canonical (first-seen) study_name of the shared key."""
    env = _study_env_tsv(tmp_path, [
        {"spire_sample_name": "S1", "sample_alias": "A1", "study_code": "First", "study_accession": "PRJ1"},
        {"spire_sample_name": "S2", "sample_alias": "A2", "study_code": "Second", "study_accession": "PRJ1"}])
    monkeypatch.setattr(metalog, "load_regions_json", lambda p: _FAKE_REGIONS)
    ds = {"env": env, "study_overrides": {"existing": {"Second": "mgnify|MGYS1"}}}
    st1 = next(r for r in metalog.emit_archive("/x/S1.tar.gz", ds) if r.table == "studies")
    st2 = next(r for r in metalog.emit_archive("/x/S2.tar.gz", ds) if r.table == "studies")
    assert st1.natural_key == "metalog|PRJ1" and st2.natural_key == "mgnify|MGYS1"


@pytest.mark.parametrize("bad", [
    {"key_by_code": "Seitz"},                         # scalar, not a list
    {"key_by_code": [1]},
    {"existing": {"X": "MGYS00005418"}},              # not <source>|<key>
    {"existing": ["X"]},
    {"unknown_option": []},
])
def test_metalog_units_rejects_malformed_study_overrides(tmp_path, bad):
    from scripts.populator.populate import _metalog_units
    (tmp_path / "runs").mkdir()
    with pytest.raises(SystemExit):
        _metalog_units({"base_dirs": [str(tmp_path / "runs")], "env_metadata": "e.tsv",
                        "study_overrides": bad}, "metalog")


def test_metalog_units_dataset_shape(tmp_path):
    from scripts.populator.populate import _metalog_units
    (tmp_path / "runs").mkdir()
    base = {"base_dirs": [str(tmp_path / "runs")], "env_metadata": "e.tsv"}
    assert _metalog_units(base, "m")[0].dataset == "e.tsv"
    assert _metalog_units(dict(base, env_measurements="l.tsv"), "m")[0].dataset == \
        {"env": "e.tsv", "measurements": "l.tsv"}              # unchanged for the live config
    ov = {"key_by_code": ["Seitz"], "existing": {"P": "mgnify|MGYS1"}}
    assert _metalog_units(dict(base, study_overrides=ov), "m")[0].dataset == \
        {"env": "e.tsv", "measurements": None, "study_overrides": ov}


def test_stub_study_survives_registry_and_keeps_live_id(monkeypatch, tmp_path):
    from scripts.populator.core.registry import Registry
    env = _study_env_tsv(tmp_path, [
        {"spire_sample_name": "5O_Y1.1", "sample_alias": "A1", "study_code": "PRJEB13832_sewage"}])
    monkeypatch.setattr(metalog, "load_regions_json", lambda p: _FAKE_REGIONS)
    ds = {"env": env, "study_overrides": {"existing": {"PRJEB13832_sewage": "mgnify|MGYS00005418"}}}
    reg = Registry()
    for r in metalog.emit_archive("/x/5O_Y1.1.tar.gz", ds):
        reg.add(r)
    reg.drop_dangling_junctions()
    t = reg.finalize()
    assert [s["id"] for s in t["studies"]] == ["eab2f947-d06a-5487-8b72-76840e6f74c5"]
    assert t["study_samples"][0]["study_id"] == "eab2f947-d06a-5487-8b72-76840e6f74c5"


def test_key_by_code_with_some_rows_lacking_accession(tmp_path):
    from scripts.populator.adapters.metalog_metadata import load_env_metadata
    env = load_env_metadata(_study_env_tsv(tmp_path, [
        {"spire_sample_name": "S1", "sample_alias": "A1", "study_code": "C"},
        {"spire_sample_name": "S2", "sample_alias": "A2", "study_code": "C", "study_accession": "PRJ1"}]),
        key_by_code=["C"])
    assert env.study_for("S1") == env.study_for("S2") == ("C", {"study_name": "C", "accession": "PRJ1"})


def test_old_and_new_temperature_columns_first_wins(tmp_path):
    from scripts.populator.adapters.metalog_metadata import load_env_metadata
    p = tmp_path / "env.tsv"
    p.write_text("sample_alias\tspire_sample_name\tcurrent_temperature\ttemperature\nA1\tS1\t4.5\t9\n")
    assert load_env_metadata(str(p)).fields_for("S1")["temperature"] == 4.5
