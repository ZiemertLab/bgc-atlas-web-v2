import gzip
import json

from scripts.mgnify_v2_crawl.writer import BundleWriter, read_keys


def _read_lines(path):
    with gzip.open(path, "rt", encoding="utf-8") as fh:
        return [json.loads(line) for line in fh if line.strip()]


def test_write_finalize_produces_bundle_and_removes_part(tmp_path):
    w = BundleWriter(tmp_path, "samples")
    part = tmp_path / "samples.jsonl.gz.part"
    final = tmp_path / "samples.jsonl.gz"
    assert part.exists()
    assert not final.exists()

    w.write("ERS1", "https://api/samples/ERS1", {"accession": "SAMEA1", "lat": 1.5})
    w.write("ERS2", "https://api/samples/ERS2", {"accession": "SAMEA2", "lat": -2.0})
    w.write("ERS3", "https://api/samples/ERS3", {"accession": "SAMEA3", "lat": None})
    w.finalize()

    assert final.exists()
    assert not part.exists()


def test_lossless_round_trip(tmp_path):
    w = BundleWriter(tmp_path, "samples")
    records = [
        ("ERS1", "https://api/samples/ERS1", {"accession": "SAMEA1", "lat": 1.5, "n": [1, 2, 3]}),
        ("ERS2", "https://api/samples/ERS2", {"accession": "SAMEA2", "nested": {"a": {"b": 1}}}),
        ("ERS3", "https://api/samples/ERS3", {"accession": "SAMEA3", "lat": None}),
    ]
    for key, endpoint, data in records:
        w.write(key, endpoint, data)
    w.finalize()

    lines = _read_lines(tmp_path / "samples.jsonl.gz")
    assert len(lines) == 3
    for (key, endpoint, data), line in zip(records, lines):
        assert line == {"_v2_endpoint": endpoint, "_key": key, "data": data}


def test_read_keys_returns_all_keys(tmp_path):
    w = BundleWriter(tmp_path, "runs")
    w.write("ERR1", "u1", {"x": 1})
    w.write("ERR2", "u2", {"x": 2})
    w.write("ERR3", "u3", {"x": 3})
    w.finalize()
    assert read_keys(tmp_path / "runs.jsonl.gz") == {"ERR1", "ERR2", "ERR3"}


def test_read_keys_missing_file_is_empty_set(tmp_path):
    assert read_keys(tmp_path / "nope.jsonl.gz") == set()


def test_read_keys_reads_partial_file(tmp_path):
    w = BundleWriter(tmp_path, "studies")
    w.write("MGYS1", "u1", {"x": 1})
    w.write("MGYS2", "u2", {"x": 2})
    w.close()  # no finalize -> .part remains
    part = tmp_path / "studies.jsonl.gz.part"
    assert part.exists()
    assert read_keys(part) == {"MGYS1", "MGYS2"}


def test_read_keys_tolerates_truncated_trailing_line(tmp_path):
    part = tmp_path / "studies.jsonl.gz.part"
    with gzip.open(part, "wt", encoding="utf-8") as fh:
        fh.write(json.dumps({"_v2_endpoint": "u1", "_key": "MGYS1", "data": {"x": 1}}) + "\n")
        fh.write(json.dumps({"_v2_endpoint": "u2", "_key": "MGYS2", "data": {"x": 2}}) + "\n")
        fh.write('{"_v2_endpoint": "u3", "_key": "MGYS3", "da')  # truncated, no newline
    assert read_keys(part) == {"MGYS1", "MGYS2"}


def test_non_ascii_survives(tmp_path):
    w = BundleWriter(tmp_path, "samples")
    data = {"center_name": "Universität Tübingen", "note": "café — naïve ☃"}
    w.write("ERS1", "https://api/samples/ERS1", data)
    w.finalize()
    lines = _read_lines(tmp_path / "samples.jsonl.gz")
    assert lines[0]["data"] == data


def test_compact_separators_no_spaces(tmp_path):
    w = BundleWriter(tmp_path, "samples")
    w.write("ERS1", "u1", {"a": 1, "b": 2})
    w.finalize()
    with gzip.open(tmp_path / "samples.jsonl.gz", "rt", encoding="utf-8") as fh:
        raw = fh.read()
    assert ", " not in raw
    assert '": ' not in raw


def test_append_continues_existing_part(tmp_path):
    w1 = BundleWriter(tmp_path, "samples")
    w1.write("ERS1", "u1", {"x": 1})
    w1.close()
    w2 = BundleWriter(tmp_path, "samples")
    w2.write("ERS2", "u2", {"x": 2})
    w2.finalize()
    assert read_keys(tmp_path / "samples.jsonl.gz") == {"ERS1", "ERS2"}
