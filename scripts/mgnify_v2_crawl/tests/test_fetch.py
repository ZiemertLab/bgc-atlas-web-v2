"""fetch_entities with a fake ``get``; the ResumeLog and bundles are real files under tmp_path."""



from scripts.mgnify_v2_crawl.client import CrawlError
from scripts.mgnify_v2_crawl.fetch import fetch_entities
from scripts.mgnify_v2_crawl.state import ResumeLog
from scripts.mgnify_v2_crawl.writer import read_keys


def make_get(mapping):
    """Dict/None values are returned; an exception instance or class is raised; missing -> None."""
    calls = []

    def fake_get(path, params=None, **kwargs):
        calls.append(path)
        result = mapping.get(path, None)
        if isinstance(result, BaseException) or (
            isinstance(result, type) and issubclass(result, BaseException)
        ):
            raise result
        return result

    fake_get.calls = calls
    return fake_get


def test_writes_ok_records_and_marks_done(tmp_path):
    get = make_get(
        {
            "samples/A": {"accession": "SAMEA-A"},
            "samples/B": {"accession": "SAMEA-B"},
        }
    )
    log = ResumeLog(str(tmp_path / "crawl.sqlite"))
    stats = fetch_entities(
        "samples", ["A", "B"], lambda k: f"samples/{k}", log, tmp_path, get=get
    )
    assert stats == {
        "requested": 2,
        "written": 2,
        "removed": 0,
        "errors": 0,
        "skipped": 0,
        "null_keys": 0,
    }
    assert read_keys(tmp_path / "samples.jsonl.gz") == {"A", "B"}
    assert log.is_done("samples", "A") is True
    assert log.is_done("samples", "B") is True


def test_endpoint_uses_base_url_plus_path(tmp_path):
    from scripts.mgnify_v2_crawl import config
    import gzip
    import json

    get = make_get({"samples/A": {"accession": "SAMEA-A"}})
    log = ResumeLog(str(tmp_path / "crawl.sqlite"))
    fetch_entities("samples", ["A"], lambda k: f"samples/{k}", log, tmp_path, get=get)
    with gzip.open(tmp_path / "samples.jsonl.gz", "rt", encoding="utf-8") as fh:
        line = json.loads(fh.readline())
    assert line["_v2_endpoint"] == config.BASE_URL + "samples/A"
    assert line["_key"] == "A"
    assert line["data"] == {"accession": "SAMEA-A"}


def test_404_marked_removed_not_written(tmp_path):
    get = make_get(
        {
            "samples/A": {"accession": "SAMEA-A"},
            "samples/GONE": None,  # 404
        }
    )
    log = ResumeLog(str(tmp_path / "crawl.sqlite"))
    stats = fetch_entities(
        "samples", ["A", "GONE"], lambda k: f"samples/{k}", log, tmp_path, get=get
    )
    assert stats["removed"] == 1
    assert stats["written"] == 1
    assert read_keys(tmp_path / "samples.jsonl.gz") == {"A"}
    # "removed" is not "ok", so the key stays retryable.
    assert log.is_done("samples", "GONE") is False


def test_crawl_error_counted_not_crashing_phase(tmp_path):
    get = make_get(
        {
            "samples/A": {"accession": "SAMEA-A"},
            "samples/BAD": CrawlError("boom"),
            "samples/C": {"accession": "SAMEA-C"},
        }
    )
    log = ResumeLog(str(tmp_path / "crawl.sqlite"))
    stats = fetch_entities(
        "samples", ["A", "BAD", "C"], lambda k: f"samples/{k}", log, tmp_path, get=get
    )
    assert stats["errors"] == 1
    assert stats["written"] == 2
    assert read_keys(tmp_path / "samples.jsonl.gz") == {"A", "C"}
    assert log.is_done("samples", "BAD") is False


def test_skips_keys_done_in_resume_log(tmp_path):
    get = make_get({"samples/B": {"accession": "SAMEA-B"}})
    log = ResumeLog(str(tmp_path / "crawl.sqlite"))
    log.mark("samples", "A", "ok", 200)
    stats = fetch_entities(
        "samples", ["A", "B"], lambda k: f"samples/{k}", log, tmp_path, get=get
    )
    assert stats["skipped"] == 1
    assert stats["written"] == 1
    assert "samples/A" not in get.calls
    assert read_keys(tmp_path / "samples.jsonl.gz") == {"B"}


def test_skips_keys_already_in_bundle_on_disk(tmp_path):
    from scripts.mgnify_v2_crawl.writer import BundleWriter

    pre = BundleWriter(tmp_path, "samples")
    pre.write("A", "u", {"accession": "SAMEA-A"})
    pre.finalize()

    get = make_get({"samples/B": {"accession": "SAMEA-B"}})
    log = ResumeLog(str(tmp_path / "crawl.sqlite"))
    stats = fetch_entities(
        "samples", ["A", "B"], lambda k: f"samples/{k}", log, tmp_path, get=get
    )
    assert stats["skipped"] == 1
    assert stats["written"] == 1
    assert "samples/A" not in get.calls
    assert read_keys(tmp_path / "samples.jsonl.gz") == {"A", "B"}


def test_skips_keys_already_in_part_on_disk(tmp_path):
    from scripts.mgnify_v2_crawl.writer import BundleWriter

    # An interrupted run leaves a .part with key A.
    pre = BundleWriter(tmp_path, "samples")
    pre.write("A", "u", {"accession": "SAMEA-A"})
    pre.close()  # no finalize -> .part remains

    get = make_get({"samples/B": {"accession": "SAMEA-B"}})
    log = ResumeLog(str(tmp_path / "crawl.sqlite"))
    stats = fetch_entities(
        "samples", ["A", "B"], lambda k: f"samples/{k}", log, tmp_path, get=get
    )
    assert "samples/A" not in get.calls
    assert stats["skipped"] == 1
    assert read_keys(tmp_path / "samples.jsonl.gz") == {"A", "B"}


def test_second_call_is_full_no_op(tmp_path):
    get = make_get(
        {
            "samples/A": {"accession": "SAMEA-A"},
            "samples/B": {"accession": "SAMEA-B"},
        }
    )
    log = ResumeLog(str(tmp_path / "crawl.sqlite"))
    fetch_entities("samples", ["A", "B"], lambda k: f"samples/{k}", log, tmp_path, get=get)
    get.calls.clear()
    stats2 = fetch_entities(
        "samples", ["A", "B"], lambda k: f"samples/{k}", log, tmp_path, get=get
    )
    assert stats2 == {
        "requested": 2,
        "written": 0,
        "removed": 0,
        "errors": 0,
        "skipped": 2,
        "null_keys": 0,
    }
    assert get.calls == []
    assert read_keys(tmp_path / "samples.jsonl.gz") == {"A", "B"}


def test_resume_rerun_writes_no_duplicate_physical_lines(tmp_path):
    # read_keys is a set and would hide duplicate writes; count physical lines.
    import gzip
    import json

    n = 5
    keys = [f"k{i}" for i in range(n)]
    mapping = {f"samples/{k}": {"accession": k} for k in keys}
    get = make_get(mapping)
    log = ResumeLog(str(tmp_path / "crawl.sqlite"))

    fetch_entities("samples", keys, lambda k: f"samples/{k}", log, tmp_path, get=get)
    fetch_entities("samples", keys, lambda k: f"samples/{k}", log, tmp_path, get=get)

    with gzip.open(tmp_path / "samples.jsonl.gz", "rt", encoding="utf-8") as fh:
        lines = [ln for ln in fh.read().splitlines() if ln.strip()]
    assert len(lines) == n
    assert {json.loads(ln)["_key"] for ln in lines} == set(keys)


def test_empty_keys_finalizes_empty_bundle(tmp_path):
    get = make_get({})
    log = ResumeLog(str(tmp_path / "crawl.sqlite"))
    stats = fetch_entities("samples", [], lambda k: f"samples/{k}", log, tmp_path, get=get)
    assert stats == {
        "requested": 0,
        "written": 0,
        "removed": 0,
        "errors": 0,
        "skipped": 0,
        "null_keys": 0,
    }
    assert (tmp_path / "samples.jsonl.gz").exists()
    assert read_keys(tmp_path / "samples.jsonl.gz") == set()


def test_duplicate_keys_fetched_and_written_once(tmp_path):
    # A long paginated list can surface the same accession on several pages.
    import gzip

    get = make_get({"analyses/MGYA1": {"accession": "MGYA1"}})
    log = ResumeLog(str(tmp_path / "crawl.sqlite"))
    stats = fetch_entities(
        "analyses",
        ["MGYA1", "MGYA1", "MGYA1"],  # same key 3x (pagination overlap)
        lambda k: f"analyses/{k}",
        log,
        tmp_path,
        get=get,
    )
    assert stats["requested"] == 1
    assert stats["written"] == 1
    assert get.calls == ["analyses/MGYA1"]
    with gzip.open(tmp_path / "analyses.jsonl.gz", "rt", encoding="utf-8") as fh:
        lines = [ln for ln in fh.read().splitlines() if ln.strip()]
    assert len(lines) == 1


def test_null_and_empty_keys_dropped_not_fetched_or_marked(tmp_path):
    # accession=None keys are dropped, never fetched, never marked (NOT NULL key).
    get = make_get({"assemblies/ERZ-A": {"accession": "ERZ-A"}})
    log = ResumeLog(str(tmp_path / "crawl.sqlite"))
    stats = fetch_entities(
        "assemblies",
        ["ERZ-A", None, "", "   "],
        lambda k: f"assemblies/{k}",
        log,
        tmp_path,
        get=get,
    )
    assert stats["null_keys"] == 3
    assert stats["requested"] == 1
    assert stats["written"] == 1
    assert read_keys(tmp_path / "assemblies.jsonl.gz") == {"ERZ-A"}
    assert get.calls == ["assemblies/ERZ-A"]
    assert log.done_keys("assemblies") == {"ERZ-A"}


def test_high_concurrency_writes_every_record_once(tmp_path):
    # BundleWriter.write is not thread-safe; every record must land exactly once.
    n = 200
    keys = [f"k{i}" for i in range(n)]
    mapping = {f"samples/{k}": {"accession": k} for k in keys}
    get = make_get(mapping)
    log = ResumeLog(str(tmp_path / "crawl.sqlite"))
    stats = fetch_entities(
        "samples", keys, lambda k: f"samples/{k}", log, tmp_path, get=get, concurrency=8
    )
    assert stats["written"] == n
    assert read_keys(tmp_path / "samples.jsonl.gz") == set(keys)
    assert log.done_keys("samples") == set(keys)
