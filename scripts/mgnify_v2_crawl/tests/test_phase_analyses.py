"""Tests for phase C: analyses list-crawl, linkage filter, detail-fetch."""

from scripts.mgnify_v2_crawl import phase_analyses
from scripts.mgnify_v2_crawl.state import ResumeLog
from scripts.mgnify_v2_crawl.writer import BundleWriter, read_keys


def make_get(list_items, details):
    """`list_items` are re-paged by the requested page_size; `details` maps accession -> dict / None."""
    count = len(list_items)

    def fake_get(path, params=None, **kwargs):
        if path == "analyses/":
            params = params or {}
            page = params.get("page", 1)
            size = params.get("page_size", count or 1)
            start = (page - 1) * size
            return {"count": count, "items": list_items[start:start + size]}
        acc = path.split("/", 1)[1]
        return details.get(acc, None)

    return fake_get


def _seed_assemblies(tmp_path, accs):
    w = BundleWriter(tmp_path, "assemblies")
    for a in accs:
        w.write(a, "u", {"accession": a})
    w.finalize()


def test_keeps_only_in_set_items_and_detail_fetches_them(tmp_path):
    list_items = [
        # kept: assembly in set
        {"accession": "MGYA1", "assembly": {"accession": "ERZ1"}, "run": None, "sample": None},
        # kept: run in set
        {"accession": "MGYA2", "assembly": None, "run": {"accession": "ERR1"}, "sample": None},
        # kept: sample in set
        {"accession": "MGYA3", "assembly": None, "run": None, "sample": {"accession": "SAMEA1"}},
        # dropped: nothing in any set
        {"accession": "MGYA4", "assembly": {"accession": "ERZX"}, "run": {"accession": "ERRX"}, "sample": {"accession": "SAMEAX"}},
        # dropped: all linkage null
        {"accession": "MGYA5", "assembly": None, "run": None, "sample": None},
    ]
    details = {
        "MGYA1": {"accession": "MGYA1"},
        "MGYA2": {"accession": "MGYA2"},
        "MGYA3": {"accession": "MGYA3"},
    }
    get = make_get(list_items, details)
    _seed_assemblies(tmp_path, {"ERZ1"})
    linkage = {"runs": {"ERR1"}, "samples": {"SAMEA1"}, "studies": set()}
    log = ResumeLog(str(tmp_path / "crawl.sqlite"))
    stats = phase_analyses.run(tmp_path, log, linkage, get=get)

    assert read_keys(tmp_path / "analyses.jsonl.gz") == {"MGYA1", "MGYA2", "MGYA3"}
    assert stats["written"] == 3
    assert stats["requested"] == 3


def test_all_null_linkage_items_are_dropped(tmp_path):
    list_items = [
        {"accession": "MGYAa", "assembly": None, "run": None, "sample": None},
        {"accession": "MGYAb", "assembly": {}, "run": {}, "sample": {}},  # empty dicts -> no accession
    ]
    get = make_get(list_items, {})
    _seed_assemblies(tmp_path, set())
    linkage = {"runs": set(), "samples": set(), "studies": set()}
    log = ResumeLog(str(tmp_path / "crawl.sqlite"))
    stats = phase_analyses.run(tmp_path, log, linkage, get=get)
    assert read_keys(tmp_path / "analyses.jsonl.gz") == set()
    assert stats["written"] == 0
    assert stats["requested"] == 0


def test_assembly_set_read_from_bundle(tmp_path):
    # Assemblies come from the bundle, not from linkage.
    list_items = [
        {"accession": "MGYA1", "assembly": {"accession": "ERZ7"}, "run": None, "sample": None},
    ]
    details = {"MGYA1": {"accession": "MGYA1"}}
    get = make_get(list_items, details)
    _seed_assemblies(tmp_path, {"ERZ7"})
    linkage = {"runs": set(), "samples": set(), "studies": set()}
    log = ResumeLog(str(tmp_path / "crawl.sqlite"))
    phase_analyses.run(tmp_path, log, linkage, get=get)
    assert read_keys(tmp_path / "analyses.jsonl.gz") == {"MGYA1"}


def test_404_detail_marked_removed(tmp_path):
    list_items = [
        {"accession": "MGYA1", "assembly": {"accession": "ERZ1"}, "run": None, "sample": None},
        {"accession": "MGYAGONE", "assembly": {"accession": "ERZ1"}, "run": None, "sample": None},
    ]
    details = {"MGYA1": {"accession": "MGYA1"}, "MGYAGONE": None}
    get = make_get(list_items, details)
    _seed_assemblies(tmp_path, {"ERZ1"})
    linkage = {"runs": set(), "samples": set(), "studies": set()}
    log = ResumeLog(str(tmp_path / "crawl.sqlite"))
    stats = phase_analyses.run(tmp_path, log, linkage, get=get)
    assert stats["removed"] == 1
    assert read_keys(tmp_path / "analyses.jsonl.gz") == {"MGYA1"}


def test_rerun_is_no_op(tmp_path):
    list_items = [
        {"accession": "MGYA1", "assembly": {"accession": "ERZ1"}, "run": None, "sample": None},
    ]
    details = {"MGYA1": {"accession": "MGYA1"}}
    get = make_get(list_items, details)
    _seed_assemblies(tmp_path, {"ERZ1"})
    linkage = {"runs": set(), "samples": set(), "studies": set()}
    log = ResumeLog(str(tmp_path / "crawl.sqlite"))
    phase_analyses.run(tmp_path, log, linkage, get=get)
    stats2 = phase_analyses.run(tmp_path, log, linkage, get=get)
    assert stats2["skipped"] == 1
    assert stats2["written"] == 0
    assert read_keys(tmp_path / "analyses.jsonl.gz") == {"MGYA1"}
