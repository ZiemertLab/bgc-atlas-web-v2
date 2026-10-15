"""Tests for the native-v2 MGnify bundle reader + accession helpers."""
import gzip
import json

from scripts.populator.adapters import mgnify_v2_dump as v2


def _write_bundle(path, lines):
    """Write a v2 ``*.jsonl.gz`` bundle from raw ``lines`` verbatim, so a test can
    inject a truncated final line."""
    with gzip.open(path, "wt", encoding="utf-8") as fh:
        for line in lines:
            fh.write(line)


def _record_line(data):
    rec = {"_v2_endpoint": "https://x/samples/SAMEA1", "_key": "SAMEA1", "data": data}
    return json.dumps(rec) + "\n"


def test_iter_bundle_yields_data_for_good_lines(tmp_path):
    path = tmp_path / "samples.jsonl.gz"
    d1 = {"accession": "SAMEA1", "ena_accessions": ["SAMEA1", "ERS1"]}
    d2 = {"accession": "SAMEA2", "ena_accessions": ["SAMEA2", "ERS2"]}
    _write_bundle(path, [_record_line(d1), _record_line(d2)])
    assert list(v2.iter_bundle(path)) == [d1, d2]


def test_iter_bundle_breaks_on_truncated_final_line(tmp_path):
    path = tmp_path / "samples.jsonl.gz"
    d1 = {"accession": "SAMEA1"}
    d2 = {"accession": "SAMEA2"}
    truncated = '{"_v2_endpoint": "https://x", "_key": "SAMEA3", "da'  # no newline
    _write_bundle(path, [_record_line(d1), _record_line(d2), truncated])
    assert list(v2.iter_bundle(path)) == [d1, d2]


def test_iter_bundle_breaks_on_line_without_data(tmp_path):
    path = tmp_path / "samples.jsonl.gz"
    d1 = {"accession": "SAMEA1"}
    no_data = json.dumps({"_v2_endpoint": "https://x", "_key": "SAMEA9"}) + "\n"
    _write_bundle(path, [_record_line(d1), no_data])
    assert list(v2.iter_bundle(path)) == [d1]


def test_iter_bundle_skips_null_data_line(tmp_path):
    path = tmp_path / "samples.jsonl.gz"
    d1 = {"accession": "SAMEA1"}
    d2 = {"accession": "SAMEA2"}
    null_data = json.dumps(
        {"_v2_endpoint": "https://x", "_key": "SAMEA9", "data": None}) + "\n"
    _write_bundle(path, [_record_line(d1), null_data, _record_line(d2)])
    out = list(v2.iter_bundle(path))
    assert out == [d1, d2]
    assert None not in out


def test_iter_bundle_skips_blank_lines(tmp_path):
    path = tmp_path / "samples.jsonl.gz"
    d1 = {"accession": "SAMEA1"}
    d2 = {"accession": "SAMEA2"}
    _write_bundle(path, [_record_line(d1), "\n", _record_line(d2)])
    assert list(v2.iter_bundle(path)) == [d1, d2]


def test_iter_bundle_missing_file_yields_nothing(tmp_path):
    assert list(v2.iter_bundle(tmp_path / "does-not-exist.jsonl.gz")) == []


def test_secondary_accession_picks_first_ers_srs_drs():
    assert v2.secondary_accession(["SAMEA8898481", "ERS6581385"]) == "ERS6581385"
    assert v2.secondary_accession(["SAMN20708426", "SRS9873610"]) == "SRS9873610"
    assert v2.secondary_accession(["DRS123"]) == "DRS123"


def test_secondary_accession_none_when_only_biosample():
    assert v2.secondary_accession(["SAMEA1"]) is None


def test_secondary_accession_none_for_non_list():
    assert v2.secondary_accession(None) is None
    assert v2.secondary_accession("ERS1") is None


def test_biosample_accessions_picks_biosample_forms():
    got = v2.biosample_accessions(["SAMEA1", "ERS1", "SAMN2", "SRS2", "SAMD3"])
    assert got == ["SAMEA1", "SAMN2", "SAMD3"]


def test_biosample_accessions_empty_when_none():
    assert v2.biosample_accessions(["ERS1", "SRS2"]) == []
    assert v2.biosample_accessions(None) == []


def test_sample_natural_key_prefers_secondary():
    data = {"accession": "SAMEA1", "ena_accessions": ["SAMEA1", "ERS6581385"]}
    assert v2.sample_natural_key(data) == "ERS6581385"


def test_sample_natural_key_falls_back_to_biosample():
    data = {"accession": "SAMEA1", "ena_accessions": ["SAMEA1"]}
    assert v2.sample_natural_key(data) == "SAMEA1"


def test_sample_natural_key_none_when_empty():
    assert v2.sample_natural_key({}) is None


def test_build_biosample_to_secondary_maps_all_forms(tmp_path):
    path = tmp_path / "samples.jsonl.gz"
    s1 = {"accession": "SAMEA1", "ena_accessions": ["SAMEA1", "ERS1"]}
    s2 = {"accession": "SAMN2", "ena_accessions": ["SAMN2", "SRS2"]}
    _write_bundle(path, [_record_line(s1), _record_line(s2)])
    assert v2.build_biosample_to_secondary(path) == {
        "SAMEA1": "ERS1",
        "SAMN2": "SRS2",
    }


def test_build_biosample_to_secondary_fallback_sample(tmp_path):
    path = tmp_path / "samples.jsonl.gz"
    s1 = {"accession": "SAMEA1", "ena_accessions": ["SAMEA1", "ERS1"]}
    fallback = {"accession": "SAMEA9", "ena_accessions": ["SAMEA9"]}  # no secondary
    _write_bundle(path, [_record_line(s1), _record_line(fallback)])
    assert v2.build_biosample_to_secondary(path) == {
        "SAMEA1": "ERS1",
        "SAMEA9": "SAMEA9",
    }


def test_build_biosample_to_secondary_skips_keyless(tmp_path):
    path = tmp_path / "samples.jsonl.gz"
    keyless = {"accession": None, "ena_accessions": []}  # no key at all
    s1 = {"accession": "SAMEA1", "ena_accessions": ["SAMEA1", "ERS1"]}
    _write_bundle(path, [_record_line(keyless), _record_line(s1)])
    assert v2.build_biosample_to_secondary(path) == {"SAMEA1": "ERS1"}
