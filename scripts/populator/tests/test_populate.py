import os
import re
import pytest
from scripts.conftest import needs_third_party
from scripts.populator import populate
from scripts.populator.adapters.mfd_metadata import FIELD_METADATA_PATH
from scripts.populator.validate import validate_tables


def test_alias_uniqueness_raises(tmp_path):
    ds = tmp_path / "ds1"; ds.mkdir()
    (ds / "X-contigs.tar.gz").write_bytes(b"x")
    (ds / "X_assembly.tar.gz").write_bytes(b"x")   # both -> alias "X"
    archives = populate.dataset_archives(tmp_path, "ds1")
    with pytest.raises(ValueError):
        populate.check_alias_uniqueness(archives, "ds1", populate.ADAPTERS["custom"].alias_fn)


def test_alias_uniqueness_ok(tmp_path):
    ds = tmp_path / "ds1"; ds.mkdir()
    (ds / "A-contigs.tar.gz").write_bytes(b"x")
    (ds / "B-contigs.tar.gz").write_bytes(b"x")
    archives = populate.dataset_archives(tmp_path, "ds1")
    populate.check_alias_uniqueness(archives, "ds1", populate.ADAPTERS["custom"].alias_fn)


def test_dataset_archives_limit(tmp_path):
    ds = tmp_path / "ds1"; ds.mkdir()
    for n in "ABC":
        (ds / f"{n}-contigs.tar.gz").write_bytes(b"x")
    assert len(populate.dataset_archives(tmp_path, "ds1", limit=2)) == 2


def test_quarantine_partitions_domain_violators():
    tables = {"bgcs": [
        {"id": "B1", "filename": "f1", "start_pos": 0, "end_pos": 10},
        {"id": "B2", "filename": "f2", "start_pos": 50, "end_pos": 10},  # start>end
    ]}
    rep = validate_tables(tables)
    kept, rejects = populate.quarantine(tables, rep)
    assert [r["id"] for r in kept["bgcs"]] == ["B1"]
    assert [r["id"] for r in rejects["bgcs"]] == ["B2"]


def test_emit_one_detects_filename_collision(monkeypatch):
    from scripts.populator.core.record import Record
    def fake_emit(path, dataset):
        yield Record("bgcs", "a", {"filename": "DUP.region001"}, {})
        yield Record("bgcs", "b", {"filename": "DUP.region001"}, {})
    monkeypatch.setattr(populate.custom, "emit_archive", fake_emit)
    with pytest.raises(ValueError):
        populate._emit_one("custom", "ds1", "/x/A.tar.gz")


def test_provenance_wired_in_build_unit(monkeypatch):
    # workers=1 so the module-level monkeypatch is honored
    from scripts.populator.core.record import Record
    from scripts.populator import ids
    def fake_emit(path, dataset):
        yield Record("samples", "custom_ds1|s1", {"external_id": "custom_ds1|s1"}, {})
    monkeypatch.setattr(populate.custom, "emit_archive", fake_emit)
    import pathlib
    unit = populate.Unit(key="custom_ds1", adapter="custom", dataset="ds1",
                         archives=[pathlib.Path("/x/A.tar.gz")])
    reg, _ingested, _failures = populate.build_unit(unit, unit.archives, workers=1)
    row = reg.finalize()["samples"][0]
    assert row["data_source_ids"] == [str(ids.entity_id("data_sources", "custom_ds1"))]


def _coherent_emit(source_ds_name, bad_parent=False, bad_child=False):
    from scripts.populator.core.record import Record
    def fake_emit(path, dataset):
        nk = f"{source_ds_name}|A"; fp = "/x/A.tar.gz"
        yield Record("data_sources", source_ds_name,
                     {"name": source_ds_name, "source_type": "custom"}, {})
        yield Record("samples", nk, {"external_id": nk, "name": "A", "accession": "A"}, {})
        yield Record("assemblies", nk,
                     {"accession": nk, "name": "A",
                      "source_type": ("weird" if bad_parent else "metagenome")}, {})
        yield Record("analyses", nk,
                     {"accession": nk, "name": "A", "analysis_type": "antismash"}, {})
        yield Record("antismash_runs", fp,
                     {"name": "A", "file_path": fp, "num_bgcs": 2, "status": "completed"},
                     refs={"analysis_id": ("analyses", nk), "assembly_id": ("assemblies", nk)})
        yield Record("bgcs", "A_c1.region001",
                     {"filename": "A_c1.region001", "contig": "c1",
                      "start_pos": 0, "end_pos": 100, "is_complete": True,
                      "num_cds_features": 1},
                     refs={"assembly": ("assemblies", nk), "analysis_id": ("analyses", nk),
                           "antismash_run_id": ("antismash_runs", fp)})
        yield Record("bgcs", "A_c2.region001",
                     {"filename": "A_c2.region001", "contig": "c2",
                      "start_pos": (500 if bad_child else 0), "end_pos": 100,  # bad_child: start>end
                      "is_complete": True, "num_cds_features": 1},
                     refs={"assembly": ("assemblies", nk), "analysis_id": ("analyses", nk),
                           "antismash_run_id": ("antismash_runs", fp)})
    return fake_emit

def _make_dataset_dir(tmp_path):
    base = tmp_path / "base"; (base / "ds1").mkdir(parents=True)
    (base / "ds1" / "A-contigs.tar.gz").write_bytes(b"x")
    return base

def _custom_unit(base):
    unit = populate.Unit(key="custom_ds1", adapter="custom", dataset="ds1")
    unit.archives = populate.dataset_archives(base, "ds1")
    return unit

def test_run_unit_quarantines_domain_violator(tmp_path, monkeypatch):
    import polars as pl, pathlib
    base = _make_dataset_dir(tmp_path)
    monkeypatch.setattr(populate.custom, "emit_archive", _coherent_emit("custom_ds1", bad_child=True))
    out_dir = str(tmp_path / "out")
    manifest = populate.run_unit(_custom_unit(base), out_dir, workers=1)
    out = pathlib.Path(out_dir) / "custom_ds1"
    assert pl.read_parquet(str(out / "bgcs*.parquet")).height == 1
    assert pl.read_parquet(str(out / "rejects" / "bgcs*.parquet")).height == 1
    assert manifest["archives"]["ingested"] == 1
    assert manifest["archives"]["failed"] == []

def test_run_unit_aborts_when_quarantine_orphans_children(tmp_path, monkeypatch):
    import pytest
    base = _make_dataset_dir(tmp_path)
    monkeypatch.setattr(populate.custom, "emit_archive", _coherent_emit("custom_ds1", bad_parent=True))
    out_dir = str(tmp_path / "out")
    with pytest.raises(SystemExit):
        populate.run_unit(_custom_unit(base), out_dir, workers=1)

def test_dataset_archives_limit_zero(tmp_path):
    ds = tmp_path / "ds1"; ds.mkdir()
    for n in "AB":
        (ds / f"{n}-contigs.tar.gz").write_bytes(b"x")
    assert len(populate.dataset_archives(tmp_path, "ds1", limit=0)) == 0


def test_run_unit_emit_tsv_writes_tsv(tmp_path, monkeypatch):
    import pathlib
    base = _make_dataset_dir(tmp_path)
    monkeypatch.setattr(populate.custom, "emit_archive", _coherent_emit("custom_ds1"))
    out_dir = str(tmp_path / "out")
    populate.run_unit(_custom_unit(base), out_dir, workers=1, emit_tsv=True)
    out = pathlib.Path(out_dir) / "custom_ds1"
    assert (out / "bgcs_0000.tsv").exists()
    assert (out / "bgcs_0000.parquet").exists()


def test_resolve_units_custom_all_and_filter(tmp_path):
    base = tmp_path / "cust"; (base / "fram_ras").mkdir(parents=True); (base / "deep").mkdir()
    (base / "fram_ras" / "A-contigs.tar.gz").write_bytes(b"x")
    cfg = {"output_dir": str(tmp_path / "out"),
           "sources": {"custom": {"type": "custom", "base_dir": str(base),
                                  "datasets": ["fram_ras", "deep"]},
                       "metalog": {"type": "metalog", "base_dir": str(tmp_path / "ml")}}}
    (tmp_path / "ml").mkdir()
    assert {u.key for u in populate.resolve_units(cfg, "custom")} == {"custom_fram_ras", "custom_deep"}
    one = populate.resolve_units(cfg, "custom:fram_ras")
    assert len(one) == 1 and one[0].dataset == "fram_ras"
    ml = populate.resolve_units(cfg, "metalog")
    assert len(ml) == 1 and ml[0].key == "metalog" and ml[0].adapter == "metalog"
    assert {u.key for u in populate.resolve_units(cfg, "all")} == {"custom_fram_ras", "custom_deep", "metalog"}

def test_resolve_units_unknown_source_raises(tmp_path):
    import pytest
    cfg = {"output_dir": "x", "sources": {"custom": {"type": "custom", "base_dir": "b", "datasets": []}}}
    with pytest.raises(SystemExit):
        populate.resolve_units(cfg, "nope")

def test_metalog_alias_uniqueness_uses_full_stem(tmp_path):
    (tmp_path / "5O_Y1.1.tar.gz").write_bytes(b"x")
    (tmp_path / "5O_Y1.2.tar.gz").write_bytes(b"x")
    archives = sorted(tmp_path.glob("*.tar.gz"))
    populate.check_alias_uniqueness(archives, "metalog", populate.ADAPTERS["metalog"].alias_fn)


def test_alias_collision_across_dirs_names_both_full_paths(tmp_path):
    # A same-stem collision across directories must name the full paths.
    d1 = tmp_path / "d1"; d1.mkdir()
    d2 = tmp_path / "d2"; d2.mkdir()
    a1 = d1 / "X.tar.gz"; a1.write_bytes(b"x")
    a2 = d2 / "X.tar.gz"; a2.write_bytes(b"x")
    archives = [a1, a2]
    with pytest.raises(ValueError, match=rf"{re.escape(str(a1))}|{re.escape(str(a2))}") as exc:
        populate.check_alias_uniqueness(archives, "metalog", populate.ADAPTERS["metalog"].alias_fn)
    msg = str(exc.value)
    assert str(a1) in msg and str(a2) in msg


def test_metalog_unit_carries_env_path(tmp_path):
    ml = tmp_path / "ml"; ml.mkdir()
    cfg = {"output_dir": str(tmp_path / "out"),
           "sources": {"metalog": {"type": "metalog", "base_dir": str(ml),
                                   "env_metadata": "/some/env.tsv"}}}
    units = populate.resolve_units(cfg, "metalog")
    assert units[0].dataset == "/some/env.tsv"


def test_metalog_unit_spans_multiple_base_dirs(tmp_path):
    d1 = tmp_path / "d1"; d1.mkdir()
    d2 = tmp_path / "d2"; d2.mkdir()
    a1 = d1 / "B.tar.gz"; a1.write_bytes(b"x")
    a2 = d2 / "A.tar.gz"; a2.write_bytes(b"x")
    cfg = {"output_dir": str(tmp_path / "out"),
           "sources": {"metalog": {"type": "metalog",
                                   "base_dirs": [str(d1), str(d2)]}}}
    units = populate.resolve_units(cfg, "metalog")
    assert len(units) == 1 and units[0].key == "metalog"
    archives = units[0].archives
    assert set(archives) == {a1.resolve(), a2.resolve()}
    assert archives == sorted(archives)


def test_metalog_base_dirs_nonexistent_dir_raises(tmp_path):
    d1 = tmp_path / "d1"; d1.mkdir()
    cfg = {"output_dir": str(tmp_path / "out"),
           "sources": {"metalog": {"type": "metalog",
                                   "base_dirs": [str(d1), str(tmp_path / "nope")]}}}
    with pytest.raises(SystemExit, match="does not exist"):
        populate.resolve_units(cfg, "metalog")


def test_metalog_base_dirs_dedupes_duplicate_dirs(tmp_path):
    # the SAME dir listed twice must not enumerate its archive twice
    d1 = tmp_path / "d1"; d1.mkdir()
    (d1 / "A.tar.gz").write_bytes(b"x")
    cfg = {"output_dir": str(tmp_path / "out"),
           "sources": {"metalog": {"type": "metalog",
                                   "base_dirs": [str(d1), str(d1)]}}}
    units = populate.resolve_units(cfg, "metalog")
    assert len(units[0].archives) == 1


def test_metalog_base_dir_backward_compat(tmp_path):
    ml = tmp_path / "ml"; ml.mkdir()
    (ml / "A.tar.gz").write_bytes(b"x")
    cfg = {"output_dir": str(tmp_path / "out"),
           "sources": {"metalog": {"type": "metalog", "base_dir": str(ml)}}}
    units = populate.resolve_units(cfg, "metalog")
    assert [p.name for p in units[0].archives] == ["A.tar.gz"]


def test_metalog_missing_base_dir_and_base_dirs_raises(tmp_path):
    cfg = {"output_dir": str(tmp_path / "out"),
           "sources": {"metalog": {"type": "metalog"}}}
    with pytest.raises(SystemExit, match="base_dir' or 'base_dirs'"):
        populate.resolve_units(cfg, "metalog")


def test_metalog_provenance_resolves_to_emitted_data_source(monkeypatch):
    # Pins unit.key == the data_sources.name the adapter emits.
    import pathlib
    from scripts.populator import ids
    fake = {"taxon": "bacteria", "records": [{
        "id": "k141_1",
        "areas": [{"start": 0, "end": 100, "products": ["x"], "protoclusters": {}}],
        "features": [{"type": "region", "location": "[0:100](+)",
                      "qualifiers": {"region_number": ["1"], "contig_edge": ["True"]}}]}]}
    monkeypatch.setattr(populate.metalog, "load_regions_json", lambda p: fake)
    unit = populate.Unit(key="metalog", adapter="metalog", dataset=None,
                         archives=[pathlib.Path("/x/5O_Y1.1.tar.gz")])
    reg, ingested, failures = populate.build_unit(unit, unit.archives, workers=1)
    tables = reg.finalize()
    ds_ids = {r["id"] for r in tables["data_sources"]}
    assert {r["name"] for r in tables["data_sources"]} == {"metalog", "SPIRE"}
    mid = str(ids.entity_id("data_sources", "metalog"))
    sid = str(ids.entity_id("data_sources", "SPIRE"))
    assert tables["samples"][0]["data_source_ids"] == [mid, sid]
    assert tables["assemblies"][0]["data_source_ids"] == [sid]
    assert tables["analyses"][0]["data_source_ids"] == [mid, sid]
    assert set(tables["samples"][0]["data_source_ids"]) <= ds_ids


def test_resolve_units_unknown_adapter_type_raises():
    import pytest
    cfg = {"output_dir": "x", "sources": {"weird": {"type": "nosuch", "base_dir": "b"}}}
    with pytest.raises(SystemExit):
        populate.resolve_units(cfg, "weird")


def _make_mgnify_tar(base, run_key):
    import io, json, tarfile
    regions = {"taxon": "bacteria", "records": [{"id": "c1",
        "areas": [{"start": 0, "end": 100, "products": ["x"], "protoclusters": {}}],
        "features": [{"type": "region", "location": "[0:100](+)",
                      "qualifiers": {"region_number": ["1"], "contig_edge": ["True"]}}]}]}
    payload = json.dumps(regions).encode("utf-8")
    p = base / f"{run_key}.tar.gz"
    with tarfile.open(p, "w:gz") as tar:
        info = tarfile.TarInfo(f"{run_key}/{run_key}/{run_key}_regions.json")
        info.size = len(payload)
        tar.addfile(info, io.BytesIO(payload))
    return p


def test_build_unit_skips_corrupt_mgnify_tarball(tmp_path):
    """A corrupt tarball is a per-archive failure; the run still completes."""
    base = tmp_path / "mt"; base.mkdir()
    good = _make_mgnify_tar(base, "MGYA1_ERZ1")
    bad = base / "MGYA2_ERZ2.tar.gz"; bad.write_bytes(b"not a gzip stream")
    unit = populate.Unit(key="mgnify", adapter="mgnify", dataset=None,
                         archives=[good, bad])
    reg, ingested, failures = populate.build_unit(unit, unit.archives, workers=1)
    assert ingested == 1
    assert len(failures) == 1 and failures[0][0] == "MGYA2_ERZ2.tar.gz"
    tables = reg.finalize()
    assert tables["bgcs"]


def _make_dump_bundle(path, members):
    import io, json, tarfile
    with tarfile.open(path, "w:gz") as tar:
        for name, obj in members:
            data = json.dumps(obj).encode("utf-8")
            ti = tarfile.TarInfo(name)
            ti.size = len(data)
            tar.addfile(ti, io.BytesIO(data))


def test_build_unit_runs_mgnify_metadata_dump_post_pass(tmp_path):
    """The dump's rich rows overwrite BGC placeholders (last-write-wins) and its
    standalone entities are absorbed with [MGnify] provenance."""
    base = tmp_path / "mt"; base.mkdir()
    # the BGC tarball emits a minimal assembly ERZ1 (name="ERZ1")
    good = _make_mgnify_tar(base, "MGYA1_ERZ1")
    meta = tmp_path / "meta"; meta.mkdir()
    _make_dump_bundle(meta / "assemblies.tar.gz", [
        ("assemblies/ERZ1.json", {"id": "ERZ1", "attributes": {"accession": "ERZ1"},
                                  "relationships": {}}),
    ])
    _make_dump_bundle(meta / "samples.tar.gz", [
        ("samples/ERS1.json", {"id": "ERS1",
                               "attributes": {"accession": "ERS1", "sample-name": "S1"},
                               "relationships": {}}),
    ])
    _make_dump_bundle(meta / "studies.tar.gz", [
        ("studies/MGYS1.json", {"id": "MGYS1",
                                "attributes": {"accession": "MGYS1", "study-name": "study one"},
                                "relationships": {}}),
    ])
    unit = populate.Unit(key="mgnify", adapter="mgnify", dataset=str(meta),
                         archives=[good])
    reg, ingested, failures = populate.build_unit(unit, unit.archives, workers=1)
    assert ingested == 1 and not failures
    tables = reg.finalize()
    asm = next(a for a in tables["assemblies"]
               if a["accession"] == "ERZ1")
    assert asm.get("name") is None
    assert any(s["accession"] == "ERS1" for s in tables["samples"])
    assert any(s["accession"] == "MGYS1" for s in tables["studies"])
    samp = next(s for s in tables["samples"] if s["accession"] == "ERS1")
    from scripts.populator import ids
    assert samp["data_source_ids"] == [str(ids.entity_id("data_sources", "MGnify"))]


def test_build_unit_no_dump_when_dataset_none(tmp_path):
    """With dataset=None the post-emit yields nothing (BGC-only)."""
    base = tmp_path / "mt2"; base.mkdir()
    good = _make_mgnify_tar(base, "MGYA1_ERZ1")
    unit = populate.Unit(key="mgnify", adapter="mgnify", dataset=None, archives=[good])
    reg, ingested, failures = populate.build_unit(unit, unit.archives, workers=1)
    assert ingested == 1 and not failures
    tables = reg.finalize()
    assert tables["bgcs"]
    assert "samples" not in tables and "studies" not in tables


def test_resolve_units_unknown_dataset_raises(tmp_path):
    import pytest
    (tmp_path / "fram").mkdir()
    cfg = {"output_dir": "x", "sources": {"custom": {
        "type": "custom", "base_dir": str(tmp_path), "datasets": ["fram"]}}}
    with pytest.raises(SystemExit):
        populate.resolve_units(cfg, "custom:nonexistent")


def test_resolve_units_missing_base_dir_raises():
    import pytest
    cfg = {"output_dir": "x", "sources": {"custom": {"type": "custom", "datasets": ["fram"]}}}
    with pytest.raises(SystemExit):
        populate.resolve_units(cfg, "custom")


def _touch_tar(base, run_key):
    # enumeration globs by name only; content irrelevant
    (base / f"{run_key}.tar.gz").write_bytes(b"x")


def test_mgnify_units_enumerate_run_tarballs(tmp_path):
    base = tmp_path / "mj"; base.mkdir()
    _touch_tar(base, "MGYA1_ERZ1"); _touch_tar(base, "MGYA2_ERZ2")
    (base / "afile.txt").write_bytes(b"x")   # non-tarball ignored
    cfg = {"output_dir": str(tmp_path/"out"),
           "sources": {"mgnify": {"type": "mgnify", "base_dir": str(base)}}}
    units = populate.resolve_units(cfg, "mgnify")
    assert len(units) == 1 and units[0].key == "mgnify"
    assert len(units[0].archives) == 2
    assert units[0].dataset is None


def test_mgnify_unit_carries_metadata_dir(tmp_path):
    base = tmp_path / "mj"; base.mkdir()
    _touch_tar(base, "MGYA1_ERZ1")
    meta = tmp_path / "meta"; meta.mkdir()
    cfg = {"output_dir": str(tmp_path/"out"),
           "sources": {"mgnify": {"type": "mgnify", "base_dir": str(base),
                                   "metadata_dir": str(meta)}}}
    units = populate.resolve_units(cfg, "mgnify")
    assert units[0].dataset == str(meta)


def test_mgnify_alias_uniqueness_uses_run_key():
    import pathlib
    archives = [pathlib.Path("/x/MGYA1_ERZ1.tar.gz"), pathlib.Path("/x/MGYA2_ERZ2.tar.gz")]
    populate.check_alias_uniqueness(archives, "mgnify", populate.ADAPTERS["mgnify"].alias_fn)


def test_gtdb_units_enumerate_genome_dirs(tmp_path):
    base = tmp_path / "gtdb"; base.mkdir()
    (base / "GB_GCA_000003955.1").mkdir(); (base / "GB_GCA_000009999.1").mkdir()
    (base / "afile.txt").write_bytes(b"x")   # non-dir ignored
    cfg = {"output_dir": str(tmp_path/"out"),
           "sources": {"gtdb": {"type": "gtdb", "base_dir": str(base)}}}
    units = populate.resolve_units(cfg, "gtdb")
    assert len(units) == 1 and units[0].key == "gtdb" and units[0].adapter == "gtdb"
    assert len(units[0].archives) == 2
    assert units[0].dataset is None


def test_gtdb_unit_carries_metadata_path(tmp_path):
    base = tmp_path / "gtdb"; base.mkdir()
    (base / "GB_GCA_000003955.1").mkdir()
    meta = tmp_path / "hq_mimag_genomes.tsv"; meta.write_text("Representative genome\n")
    cfg = {"output_dir": str(tmp_path/"out"),
           "sources": {"gtdb": {"type": "gtdb", "base_dir": str(base),
                                 "metadata": str(meta)}}}
    units = populate.resolve_units(cfg, "gtdb")
    assert units[0].dataset == str(meta)


def test_gtdb_unit_carries_runs_tar_dir(tmp_path):
    base = tmp_path / "gtdb"; base.mkdir()
    (base / "GB_GCA_000003955.1").mkdir()
    cfg = {"output_dir": str(tmp_path/"out"),
           "sources": {"gtdb": {"type": "gtdb", "base_dir": str(base),
                                 "runs_tar_dir": "/data/gtdb_genomes_runs_tar"}}}
    units = populate.resolve_units(cfg, "gtdb")
    assert isinstance(units[0].dataset, dict)
    assert units[0].dataset["runs_tar_dir"] == "/data/gtdb_genomes_runs_tar"


def test_gtdb_missing_base_dir_raises():
    import pytest
    cfg = {"output_dir": "x", "sources": {"gtdb": {"type": "gtdb"}}}
    with pytest.raises(SystemExit):
        populate.resolve_units(cfg, "gtdb")


def test_gtdb_alias_uniqueness_uses_genome_dir_name():
    import pathlib
    archives = [pathlib.Path("/g/GB_GCA_000003955.1"), pathlib.Path("/g/GB_GCA_000009999.1")]
    populate.check_alias_uniqueness(archives, "gtdb", populate.ADAPTERS["gtdb"].alias_fn)  # distinct -> no raise


def test_adapter_registry_is_complete():
    from scripts.populator import populate
    assert set(populate.ADAPTERS) == {"custom", "metalog", "mgnify", "gtdb", "mag",
                                      "mgnify_antismash"}
    for name, spec in populate.ADAPTERS.items():
        assert callable(spec.units_fn) and callable(spec.alias_fn) and callable(spec.emit_fn)


def test_provenance_for_matrix_untagged_and_fallback():
    assert populate._provenance_for("gtdb", "samples") == ["GTDB"]
    assert populate._provenance_for("gtdb", "analyses") is None
    assert populate._provenance_for("mgnify", "assemblies") is None
    assert populate._provenance_for("mgnify", "studies") == ["MGnify"]
    assert populate._provenance_for("metalog", "assemblies") == ["SPIRE"]
    assert populate._provenance_for("custom_fram_ras", "samples") == ["custom_fram_ras"]


def test_provenance_for_mfd_custom_omits_studies():
    # The MFD study payload's cross-source data_source_ids must survive finalize.
    from scripts.populator.adapters.mfd_metadata import CUSTOM_SOURCE_NAME
    assert populate._provenance_for(CUSTOM_SOURCE_NAME, "studies") is None
    assert populate._provenance_for(CUSTOM_SOURCE_NAME, "samples") == [CUSTOM_SOURCE_NAME]
    assert populate._provenance_for(CUSTOM_SOURCE_NAME, "assemblies") == [CUSTOM_SOURCE_NAME]
    assert populate._provenance_for(CUSTOM_SOURCE_NAME, "analyses") == [CUSTOM_SOURCE_NAME]


@needs_third_party(FIELD_METADATA_PATH)
def test_mfd_custom_study_data_source_ids_survive_finalize(monkeypatch):
    """The custom MFD study keeps data_source_ids = [custom, long-read]."""
    import json, pathlib
    from scripts.populator.adapters import custom
    from scripts.populator.adapters.mfd_metadata import CUSTOM_SOURCE_NAME
    from scripts.populator.ids import entity_id
    fix = json.loads(
        (pathlib.Path(__file__).parent / "fixtures" / "as_one_region.json").read_text())
    monkeypatch.setattr(custom, "load_json", lambda p: fix)
    unit = populate.Unit(key=CUSTOM_SOURCE_NAME, adapter="custom",
                         dataset="microflora_danica",
                         archives=[pathlib.Path("/x/MFD00008-contigs.tar.gz")])
    reg, _ingested, _failures = populate.build_unit(unit, unit.archives, workers=1)
    tables = reg.finalize()
    study = next(r for r in tables["studies"] if r["accession"] == "PRJEB58634")
    assert study["data_source_ids"] == [
        str(entity_id("data_sources", "custom_microflora_danica")),
        str(entity_id("data_sources", "Microflora Danica (long-read)"))]
    samp = tables["samples"][0]
    assert samp["data_source_ids"] == [str(entity_id("data_sources", CUSTOM_SOURCE_NAME))]


def test_streamed_bgcs_equal_non_streamed_registry(tmp_path, monkeypatch):
    """bgcs streamed in small batches equal those kept in the aggregate Registry."""
    import polars as pl, pathlib
    base = _make_dataset_dir(tmp_path)
    monkeypatch.setattr(populate.custom, "emit_archive", _coherent_emit("custom_ds1"))
    # non-streamed reference: streamer=None keeps bgcs in the Registry
    u = _custom_unit(base)
    reg, _, _ = populate.build_unit(u, u.archives, workers=1)
    ref = {r["filename"]: r for r in reg.finalize()["bgcs"]}
    # streamed: one bgc per part -> multiple parts, then union
    out = str(tmp_path / "out")
    populate.run_unit(_custom_unit(base), out, workers=1, bgc_batch=1)
    dest = pathlib.Path(out) / "custom_ds1"
    streamed = {r["filename"]: r for r in pl.read_parquet(str(dest / "bgcs*.parquet")).to_dicts()}
    assert set(ref) == set(streamed)
    for fn in ref:
        for col in ("id", "assembly", "analysis_id", "start_pos", "end_pos", "is_complete"):
            assert ref[fn][col] == streamed[fn][col]


def test_run_unit_cleans_stale_output_on_rerun(tmp_path, monkeypatch):
    """A leftover bgcs.parquet would shadow the parts; stale higher parts would double-count."""
    import polars as pl, pathlib
    base = _make_dataset_dir(tmp_path)
    monkeypatch.setattr(populate.custom, "emit_archive", _coherent_emit("custom_ds1"))
    out = str(tmp_path / "out"); dest = pathlib.Path(out) / "custom_ds1"
    populate.run_unit(_custom_unit(base), out, workers=1, bgc_batch=1)
    # plant stale artifacts a naive re-run would leave behind
    (dest / "bgcs.parquet").write_bytes(b"")
    (dest / "bgcs_0099.parquet").write_bytes(b"")
    populate.run_unit(_custom_unit(base), out, workers=1, bgc_batch=1)
    names = {p.name for p in dest.glob("bgcs*.parquet")}
    assert "bgcs.parquet" not in names and "bgcs_0099.parquet" not in names
    assert pl.read_parquet(str(dest / "bgcs*.parquet")).height == 2


# SPIRE metaSMASH archives go through the metalog adapter. Their *_regions.json is one
# level deeper and the regions.json version differs; both must be inert.

_SPIRE_ENV_ONLY_DIR = "/data/bgc-atlas/data-v2/spire_env_only_antismash_runs/"


def _make_spire_tar(base, run_key, *, version="0.1.3", taxon="bacteria", n_regions=2):
    """A SPIRE-shaped archive: <id>/<id>/<id>_regions.json, version "0.1.3", one area
    and region feature per record."""
    import io, json, tarfile
    records = []
    for i in range(n_regions):
        records.append({
            "id": f"k141_{i}",
            "areas": [{"start": 0, "end": 100, "products": ["x"], "protoclusters": {}}],
            "features": [{"type": "region", "location": "[0:100](+)",
                          "qualifiers": {"region_number": ["1"], "contig_edge": ["True"]}}],
        })
    regions = {"version": version, "taxon": taxon, "records": records}
    payload = json.dumps(regions).encode("utf-8")
    p = base / f"{run_key}.tar.gz"
    with tarfile.open(p, "w:gz") as tar:
        info = tarfile.TarInfo(f"{run_key}/{run_key}/{run_key}_regions.json")
        info.size = len(payload)
        tar.addfile(info, io.BytesIO(payload))
    return p


def test_spire_env_only_archive_emits_metalog_spire_rows_no_gcf_tax(tmp_path):
    from scripts.populator.adapters import metalog
    from scripts.populator.ids import scoped
    run_key = "SAMN_FAKE_1"
    archive = _make_spire_tar(tmp_path, run_key, version="0.1.3", n_regions=2)
    records = list(metalog.emit_archive(str(archive)))

    ds_names = {r.natural_key for r in records if r.table == "data_sources"}
    assert ds_names == {"metalog", "SPIRE"}
    assert {r.fields["name"] for r in records if r.table == "data_sources"} == {"metalog", "SPIRE"}

    expected_nk = scoped("metalog", run_key)
    assert expected_nk == f"metalog|{run_key}"
    for table in ("samples", "assemblies", "analyses"):
        rows = [r for r in records if r.table == table]
        assert len(rows) == 1, f"{table}: expected 1, got {len(rows)}"
        assert rows[0].natural_key == expected_nk

    runs = [r for r in records if r.table == "antismash_runs"]
    assert len(runs) == 1
    assert runs[0].fields["num_bgcs"] == 2
    assert runs[0].fields["taxon"] == "bacteria"

    # gcf/taxonomy are applied later; check both refs and fields.
    bgcs = [r for r in records if r.table == "bgcs"]
    assert len(bgcs) == 2
    for b in bgcs:
        assert "taxonomy_id" not in b.refs, f"bgc {b.natural_key} got a taxonomy_id ref"
        assert "taxonomy_id" not in b.fields, f"bgc {b.natural_key} got a taxonomy_id field"
        assert "gcf_id" not in b.refs, f"bgc {b.natural_key} got a gcf_id ref"
        assert "gcf_id" not in b.fields, f"bgc {b.natural_key} got a gcf_id field"
        assert b.fields.get("gcf_id") is None, f"bgc {b.natural_key} set gcf_id"
        assert "gcf_membership" not in b.refs, f"bgc {b.natural_key} got a gcf_membership ref"
        assert "gcf_membership" not in b.fields, f"bgc {b.natural_key} set gcf_membership"

    assert not any(r.table == "taxonomies" for r in records), "unexpected taxonomies record"
    assert not any(r.table == "gcfs" for r in records), "unexpected gcfs record"


# BGC-bearing sample ids, so the smoke test below parses a small real archive with regions.
_SPIRE_BGC_BEARING_IDS = os.path.join(_SPIRE_ENV_ONLY_DIR, "_bin", "bgc_bearing_ids.txt")
_SPIRE_ARCHIVE_SIZE_CAP = 50 * 1024 * 1024   # <= 50 MB: stay fast, never read a ~900 MB giant


@pytest.mark.skipif(not os.path.isdir(_SPIRE_ENV_ONLY_DIR),
                    reason="SPIRE env-only archive dir not present (off-ceph)")
def test_spire_env_only_real_archive_round_trips(tmp_path):
    """Smoke test on real SPIRE bytes (ceph only): the smallest BGC-bearing archive
    under a 50 MB cap."""
    from scripts.populator.adapters import metalog, archive as archive_mod
    from scripts.populator.ids import scoped
    if not os.path.isfile(_SPIRE_BGC_BEARING_IDS):
        pytest.skip(f"BGC-bearing id list absent: {_SPIRE_BGC_BEARING_IDS}")
    with open(_SPIRE_BGC_BEARING_IDS) as fh:
        ids = [ln.strip() for ln in fh if ln.strip()]
    candidates = []
    for sid in ids:
        path = os.path.join(_SPIRE_ENV_ONLY_DIR, f"{sid}.tar.gz")
        if os.path.isfile(path) and os.path.getsize(path) <= _SPIRE_ARCHIVE_SIZE_CAP:
            candidates.append(path)
    if not candidates:
        pytest.skip("no BGC-bearing archive present under the size cap on this host")
    archive = min(candidates, key=os.path.getsize)   # deterministic smallest BGC-bearing

    records = list(metalog.emit_archive(str(archive)))   # dataset=None

    expected_nk = scoped("metalog", archive_mod.archive_stem(archive))
    for table in ("samples", "assemblies", "analyses"):
        rows = [r for r in records if r.table == table]
        assert len(rows) == 1, f"{table}: expected 1, got {len(rows)}"
        assert rows[0].natural_key == expected_nk

    runs = [r for r in records if r.table == "antismash_runs"]
    assert len(runs) == 1
    n_bgcs = len([r for r in records if r.table == "bgcs"])
    assert n_bgcs > 0, f"{archive} emitted 0 bgcs (expected a BGC-bearing archive)"
    assert runs[0].fields["num_bgcs"] == n_bgcs   # parity on real data, derived not hardcoded


# antismash_runs versions come from the source config, per directory where a source mixes cohorts.

def test_run_versions_source_default_and_per_dir_override(tmp_path):
    rerun = tmp_path / "rerun"
    rerun.mkdir()
    rv = populate.run_versions_for(
        {"antismash_version": "8.dev", "pipeline_version": None,
         "run_versions": [{"dir": str(rerun), "antismash_version": "8.0.4",
                           "pipeline_version": "metaSMASH 1.0.3"}]}, "gtdb")
    assert rv.for_path(str(tmp_path / "orig" / "G.tar.gz")) == ("8.dev", None)
    assert rv.for_path(str(rerun / "G.tar.gz")) == ("8.0.4", "metaSMASH 1.0.3")
    # a sibling whose name merely starts with the directory's is not under it
    assert rv.for_path(str(tmp_path / "rerun-old" / "G.tar.gz")) == ("8.dev", None)


def test_run_versions_absent_is_none():
    assert populate.run_versions_for({}, "x") is None


@pytest.mark.parametrize("entry", [
    {"pipeline_version": "metaSMASH 1.0.3"},                       # wrapper without antiSMASH
    {"antismash_version": ""},
    {"antismash_version": "8.0.4", "pipeline_version": ""},
    {"run_versions": [{"antismash_version": "8.0.4"}]},            # no dir
    {"run_versions": [{"dir": "/x"}]},                             # no version
])
def test_run_versions_malformed_config_fails_loudly(entry):
    with pytest.raises(SystemExit):
        populate.run_versions_for(entry, "src")


def test_build_unit_stamps_versions_on_completed_runs(monkeypatch):
    from scripts.populator.core.record import Record
    def fake_emit(path, dataset):
        yield Record("antismash_runs", "/x/A.tar.gz",
                     {"name": "A", "file_path": "/x/A.tar.gz", "num_bgcs": 0,
                      "status": "completed", "taxon": None}, {})
        yield Record("antismash_runs", "/x/B.tar.gz",
                     {"name": "B", "file_path": "/x/B.tar.gz", "num_bgcs": 0,
                      "status": "failed", "taxon": None}, {})
    monkeypatch.setattr(populate.custom, "emit_archive", fake_emit)
    import pathlib
    unit = populate.Unit(key="custom_ds1", adapter="custom", dataset="ds1",
                         archives=[pathlib.Path("/x/A.tar.gz")],
                         run_versions=populate.RunVersions(default=("8.0.4", "metaSMASH 1.0.3")))
    reg, _ingested, _failures = populate.build_unit(unit, unit.archives, workers=1)
    runs = {r["name"]: r for r in reg.finalize()["antismash_runs"]}
    assert (runs["A"]["antismash_version"], runs["A"]["pipeline_version"]) == ("8.0.4", "metaSMASH 1.0.3")
    assert runs["B"].get("antismash_version") is None      # nothing ran


def test_config_example_states_versions_for_every_source():
    import pathlib
    cfg = populate.load_config(pathlib.Path(populate.__file__).parent / "config.example.yaml")
    for name, entry in cfg["sources"].items():
        assert populate.run_versions_for(entry, name) is not None, name


def _example_config():
    import pathlib
    return populate.load_config(pathlib.Path(populate.__file__).parent / "config.example.yaml")


def test_config_example_keys_are_all_read_by_their_adapter():
    for name, entry in _example_config()["sources"].items():
        adapter = entry.get("type", name)
        assert adapter in populate.ADAPTERS, name
        unknown = set(entry) - {"type"} - populate.CONFIG_KEYS[adapter] - populate.RUN_VERSION_KEYS
        assert not unknown, (name, unknown)


def test_config_example_resolves_to_units(monkeypatch):
    """Every source's unit builder accepts its example entry (paths stubbed as existing)."""
    import pathlib
    monkeypatch.setattr(pathlib.Path, "is_dir", lambda self: True)
    monkeypatch.setattr(pathlib.Path, "glob", lambda self, pattern: iter(()))
    monkeypatch.setattr(pathlib.Path, "iterdir", lambda self: iter(()))
    units = populate.resolve_units(_example_config(), "all")
    keys = [u.key for u in units]
    assert len(keys) == len(set(keys)), keys                      # no two units share an output dir
    by_key = {u.key: u for u in units}
    added = by_key["metalog_added"]
    assert added.adapter == "metalog"
    assert added.dataset["study_overrides"]["existing"]["PRJEB13832_sewage"] == "mgnify|MGYS00005418"
    assert added.run_versions.for_path("/data/x/A.tar.gz") == ("8.0.4", "metaSMASH 1.0.3")
    assert populate._provenance_for("metalog_added", "samples") == ["metalog", "SPIRE"]
    new = by_key["mgnify_new"]
    assert new.adapter == "mgnify_antismash"
    assert new.run_versions.default == ("8.0.4", "metaSMASH 1.0.3")
    gt = by_key["gtdb"]
    assert gt.dataset["rerun_tar_dir"].endswith("rerun-20261008/runs_tar")
