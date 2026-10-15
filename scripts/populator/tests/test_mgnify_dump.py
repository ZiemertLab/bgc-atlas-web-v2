import io
import json
import tarfile

from scripts.populator.adapters import mgnify_dump as md


def _make_bundle(path, members):
    """Write a .tar.gz with one '<name>.json' member per (name, obj) and a dir entry."""
    with tarfile.open(path, "w:gz") as tar:
        # a directory member that iter_entities must skip
        di = tarfile.TarInfo("analyses")
        di.type = tarfile.DIRTYPE
        tar.addfile(di)
        for name, obj in members:
            data = json.dumps(obj).encode("utf-8")
            ti = tarfile.TarInfo(name)
            ti.size = len(data)
            tar.addfile(ti, io.BytesIO(data))


def test_iter_entities_streams_json_members(tmp_path):
    path = tmp_path / "analyses.tar.gz"
    o1 = {"attributes": {"accession": "MGYA1"}}
    o2 = {"attributes": {"accession": "MGYA2"}}
    _make_bundle(path, [("analyses/MGYA1.json", o1),
                        ("analyses/MGYA2.json", o2)])
    got = dict(md.iter_entities(path))
    assert set(got) == {"MGYA1", "MGYA2"}
    assert got["MGYA1"] == o1
    assert got["MGYA2"] == o2


def test_iter_entities_skips_non_json(tmp_path):
    path = tmp_path / "mixed.tar.gz"
    with tarfile.open(path, "w:gz") as tar:
        for name in ("studies/MGYS1.json", "studies/README.txt"):
            data = b'{"attributes": {}}'
            ti = tarfile.TarInfo(name)
            ti.size = len(data)
            tar.addfile(ti, io.BytesIO(data))
    assert list(dict(md.iter_entities(path))) == ["MGYS1"]


OBJ = {
    "attributes": {"experiment-type": "assembly", "accession": "MGYA1"},
    "links": {"self": "https://x/analyses/MGYA1"},
    "relationships": {
        "run": {"data": {"type": "runs", "id": "SRR1"}},
        "study": {"data": None},
        "assemblies": {"data": [{"type": "assemblies", "id": "ERZ1"},
                                {"type": "assemblies", "id": "ERZ2"}],
                       "links": {"related": "https://x/runs/SRR1/assemblies"}},
        "analyses": {"links": {"related": "https://x/runs/SRR1/analyses"}},
    },
}


def test_attr():
    assert md.attr(OBJ, "experiment-type") == "assembly"
    assert md.attr(OBJ, "missing") is None


def test_self_link():
    assert md.self_link(OBJ).endswith("/MGYA1")


def test_rel_one():
    assert md.rel_one(OBJ, "run") == "SRR1"
    assert md.rel_one(OBJ, "study") is None         # data is None
    assert md.rel_one(OBJ, "analyses") is None      # data absent (only links) -> None, not a crash
    assert md.rel_one(OBJ, "assemblies") is None    # data is a list -> not a single id


def test_rel_type():
    assert md.rel_type(OBJ, "run") == "runs"
    assert md.rel_type(OBJ, "study") is None
    assert md.rel_type(OBJ, "assemblies") is None   # data is a list -> None


def test_rel_many():
    assert md.rel_many(OBJ, "assemblies") == ["ERZ1", "ERZ2"]
    assert md.rel_many(OBJ, "run") == []            # data is a dict -> []
    assert md.rel_many(OBJ, "study") == []          # data is None -> []
    assert md.rel_many(OBJ, "missing") == []


def test_links_related():
    assert md.links_related(OBJ, "analyses").endswith("/analyses")
    assert md.links_related(OBJ, "run") is None     # no links key


def test_helpers_on_empty_object():
    empty = {}
    assert md.attr(empty, "x") is None
    assert md.self_link(empty) is None
    assert md.rel_one(empty, "run") is None
    assert md.rel_type(empty, "run") is None
    assert md.rel_many(empty, "run") == []
    assert md.links_related(empty, "run") is None


from scripts.populator.adapters import mgnify


def test_emit_metadata_dump_streams_present_bundles(tmp_path):
    _make_bundle(tmp_path / "assemblies.tar.gz", [
        ("assemblies/ERZ1.json", {"id": "ERZ1", "attributes": {"accession": "ERZ1"},
                                  "relationships": {}}),
    ])
    _make_bundle(tmp_path / "samples.tar.gz", [
        ("samples/ERS1.json", {"id": "ERS1",
                               "attributes": {"accession": "ERS1", "sample-name": "S1"},
                               "relationships": {}}),
    ])
    recs = list(mgnify.emit_metadata_dump(tmp_path))
    by_table = {}
    for r in recs:
        by_table.setdefault(r.table, []).append(r)
    asm = next(r for r in by_table["assemblies"])
    assert asm.natural_key == "mgnify|ERZ1"
    assert asm.fields["accession"] == "ERZ1"
    samp = next(r for r in by_table["samples"])
    assert samp.natural_key == "mgnify|ERS1"
    assert samp.fields["accession"] == "ERS1"


def test_emit_metadata_dump_skips_missing_bundle_without_error(tmp_path, caplog):
    """No bundles at all: nothing yielded, a skip warning per missing bundle."""
    import logging
    with caplog.at_level(logging.WARNING, logger="populator"):
        recs = list(mgnify.emit_metadata_dump(tmp_path))
    assert recs == []
    assert any("missing" in rec.message for rec in caplog.records)
