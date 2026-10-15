"""Tests for the mgnify_antismash_run adapter, which injects new antiSMASH BGCs onto
MGnify ERZ assemblies already in the DB.

Tarballs are ``ERZ<acc>.tar.gz`` with a consolidated ``<top>/<top>/ERZ<acc>.json``.
The assembly nk is scoped("mgnify", ERZ), the existing DB assembly; no sample or
assembly metadata is written, and a fresh per-ERZ antiSMASH analysis is created.
"""

from scripts.populator.adapters import mgnify_antismash_run as mnr
from scripts.populator.core.registry import Registry
from scripts.populator.ids import entity_id, scoped


# The record id carries the ERZ prefix, as metaSMASH names them.
_FAKE = {"taxon": "bacteria", "records": [
    {"id": "ERZ1022737.5",
     "areas": [{"start": 0, "end": 6000, "products": ["terpene"],
                "protoclusters": {"0": {"category": "terpene", "core_start": 100,
                                        "core_end": 5000, "product": "terpene"}}}],
     "features": [{"type": "region", "location": "[0:6000](+)",
                   "qualifiers": {"region_number": ["1"], "contig_edge": ["False"]}}]}]}

_EMPTY = {"taxon": "bacteria", "records": [
    {"id": "ERZ1022737.9", "areas": [], "features": []}]}


def _emit(monkeypatch, fake=_FAKE, path="/data/mgnify_new/ERZ1022737.tar.gz"):
    monkeypatch.setattr(mnr, "load_json", lambda p: fake)
    return list(mnr.emit_run_archive(path))


def test_bgc_filename_uses_erz_base_name(monkeypatch):
    recs = _emit(monkeypatch)
    bgc = next(r for r in recs if r.table == "bgcs")
    assert bgc.fields["filename"] == "ERZ1022737_ERZ1022737.5.region001"


def test_bgc_attaches_to_existing_assembly(monkeypatch):
    recs = _emit(monkeypatch)
    bgc = next(r for r in recs if r.table == "bgcs")
    assert bgc.refs["assembly"] == ("assemblies", scoped("mgnify", "ERZ1022737"))
    # equals the assembly already loaded in bgc_atlas_v2
    assert str(entity_id("assemblies", scoped("mgnify", "ERZ1022737"))) == \
        "56929ee9-236c-5a2d-b9cd-47fc13f7c614"


def test_fresh_antismash_analysis(monkeypatch):
    recs = _emit(monkeypatch)
    an = next(r for r in recs if r.table == "analyses")
    assert an.natural_key == scoped("mgnify", "ERZ1022737|antismash")
    assert an.fields["analysis_type"] == "antismash"
    assert an.fields["tool_name"] == "antiSMASH"
    bgc = next(r for r in recs if r.table == "bgcs")
    run = next(r for r in recs if r.table == "antismash_runs")
    assert bgc.refs["analysis_id"] == ("analyses", scoped("mgnify", "ERZ1022737|antismash"))
    assert run.refs["analysis_id"] == ("analyses", scoped("mgnify", "ERZ1022737|antismash"))


def test_does_not_rewrite_sample_metadata(monkeypatch):
    recs = _emit(monkeypatch)
    assert not any(r.table == "samples" for r in recs)


def test_minimal_assembly_kept_as_fk_target(monkeypatch):
    # a minimal assembly keeps assembly_analyses from being dropped as dangling
    recs = _emit(monkeypatch)
    asm = next(r for r in recs if r.table == "assemblies")
    assert asm.natural_key == scoped("mgnify", "ERZ1022737")
    assert asm.fields["accession"] == "ERZ1022737"


def test_antismash_run_counts_regions(monkeypatch):
    recs = _emit(monkeypatch)
    run = next(r for r in recs if r.table == "antismash_runs")
    assert run.fields["num_bgcs"] == 1
    assert run.refs["assembly_id"] == ("assemblies", scoped("mgnify", "ERZ1022737"))


def test_empty_run_emits_run_but_no_bgcs(monkeypatch):
    recs = _emit(monkeypatch, fake=_EMPTY)
    run = next(r for r in recs if r.table == "antismash_runs")
    assert run.fields["num_bgcs"] == 0
    assert not any(r.table == "bgcs" for r in recs)


def test_resolve_units_registers_adapter(tmp_path):
    from scripts.populator import populate
    base = tmp_path / "runs"; base.mkdir()
    (base / "ERZ1022737.tar.gz").write_bytes(b"x")
    (base / "ERZ21830300.tar.gz").write_bytes(b"x")
    cfg = {"output_dir": str(tmp_path / "out"),
           "sources": {"mgnify_new": {"type": "mgnify_antismash", "base_dir": str(base)}}}
    units = populate.resolve_units(cfg, "mgnify_new")
    assert len(units) == 1
    u = units[0]
    assert u.adapter == "mgnify_antismash"
    assert {p.name for p in u.archives} == {"ERZ1022737.tar.gz", "ERZ21830300.tar.gz"}
    assert populate.ADAPTERS["mgnify_antismash"].alias_fn(base / "ERZ1022737.tar.gz") == "ERZ1022737"


def test_analyses_provenance_untagged(tmp_path):
    # untagged, not the phantom [unit.key] fallback
    from scripts.populator import populate
    assert populate._provenance_for(mnr.UNIT_KEY, "analyses") is None
    assert populate._provenance_for(mnr.UNIT_KEY, "assemblies") is None
    base = tmp_path / "runs"; base.mkdir()
    (base / "ERZ1022737.tar.gz").write_bytes(b"x")
    cfg = {"output_dir": str(tmp_path / "out"),
           "sources": {"whatever_name": {"type": "mgnify_antismash", "base_dir": str(base)}}}
    units = populate.resolve_units(cfg, "whatever_name")
    assert units[0].key == mnr.UNIT_KEY


def test_extract_sequences_base_name_is_erz(tmp_path):
    from scripts.populator.tools.extract_sequences import base_name_for
    assert base_name_for("mgnify_antismash", tmp_path / "ERZ1022737.tar.gz") == "ERZ1022737"


_MULTI = {"taxon": "archaea", "records": [
    {"id": "ERZ1022737.1",
     "areas": [{"start": 0, "end": 100, "products": ["t1"], "protoclusters": {}},
               {"start": 200, "end": 300, "products": ["t2"], "protoclusters": {}}],
     "features": [
         {"type": "region", "location": "[0:100](+)",
          "qualifiers": {"region_number": ["1"], "contig_edge": ["False"]}},
         {"type": "region", "location": "[200:300](+)",
          "qualifiers": {"region_number": ["2"], "contig_edge": ["True"]}}]},
    {"id": "ERZ1022737.2",
     "areas": [{"start": 0, "end": 50, "products": ["t3"], "protoclusters": {}}],
     "features": [{"type": "region", "location": "[0:50](+)",
                   "qualifiers": {"region_number": ["1"], "contig_edge": ["False"]}}]}]}


def test_multi_contig_multi_region_filenames(monkeypatch):
    recs = _emit(monkeypatch, fake=_MULTI)
    names = sorted(r.fields["filename"] for r in recs if r.table == "bgcs")
    assert names == ["ERZ1022737_ERZ1022737.1.region001",
                     "ERZ1022737_ERZ1022737.1.region002",
                     "ERZ1022737_ERZ1022737.2.region001"]
    run = next(r for r in recs if r.table == "antismash_runs")
    assert run.fields["num_bgcs"] == 3


def test_taxon_propagates_to_run(monkeypatch):
    run = next(r for r in _emit(monkeypatch, fake=_MULTI) if r.table == "antismash_runs")
    assert run.fields["taxon"] == "archaea"


def test_finalize_resolves_and_keeps_junctions(monkeypatch):
    recs = _emit(monkeypatch)
    reg = Registry()
    for r in recs:
        reg.add(r)
    reg.drop_dangling_junctions()
    tables = reg.finalize()
    assert len(tables["bgcs"]) == 1
    assert tables["bgcs"][0]["assembly"] == "56929ee9-236c-5a2d-b9cd-47fc13f7c614"
    assert tables["antismash_runs"] and tables["analyses"]
    assert tables.get("assembly_analyses"), "assembly_analyses junction was dropped"
