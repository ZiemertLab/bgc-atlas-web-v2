#!/usr/bin/env python3
"""Tests for trim_antismash_region.py.

Run with the interpreter the server spawns (it is the one with ijson):
    /data/bgc-atlas/miniforge3/bin/python3 -m pytest scripts/test_trim_antismash_region.py
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import trim_antismash_region as trim  # noqa: E402


def record(rid, seq="ACGT" * 8, features=None):
    return {
        "id": rid,
        "seq": {"data": seq},
        "features": features if features is not None else [],
        "modules": {},
    }


def region(number, start, end):
    return {
        "type": "region",
        "location": "[%d:%d](+)" % (start, end),
        "qualifiers": {"region_number": [str(number)]},
    }


def cds(start, end, tag):
    return {
        "type": "CDS",
        "location": "[%d:%d](+)" % (start, end),
        "qualifiers": {"locus_tag": [tag]},
    }


def results_json(tmp_path, records, name="results.json"):
    """Write a results JSON with `taxon`/`schema` AFTER `records`, as antiSMASH does."""
    path = tmp_path / name
    doc = {
        "version": "8.0.4",
        "input_file": "assembly.fasta.gz",
        "records": records,
        "taxon": "bacteria",
        "schema": 4,
    }
    path.write_text(json.dumps(doc))
    return str(path)


def test_index_lists_every_record_id_in_file_order(tmp_path):
    path = results_json(tmp_path, [record("ctg1"), record("ctg2"), record("ctg3")])

    index = trim.build_records_index(path)

    assert [entry[0] for entry in index["records"]] == ["ctg1", "ctg2", "ctg3"]


def test_indexed_lookup_returns_the_requested_record(tmp_path):
    path = results_json(tmp_path, [record("ctg1"), record("ctg2"), record("ctg3")])
    index = trim.build_records_index(path)

    found = trim.record_from_index(path, index, "ctg2")

    assert found == record("ctg2")


def test_records_sharing_one_buffer_each_resolve_to_themselves(tmp_path):
    """One buffer can hold several small records, so a lookup must match on the id."""
    ids = ["ctg%d" % i for i in range(40)]
    path = results_json(tmp_path, [record(rid, seq="A" * 16) for rid in ids])
    index = trim.build_records_index(path, buf_size=512)

    for rid in ids:
        assert trim.record_from_index(path, index, rid)["id"] == rid


def test_braces_and_escapes_inside_strings_do_not_confuse_the_lookup(tmp_path):
    hostile = '{"id": "not-a-record"} \\" } ] é 🧬'
    records = [
        record("ctg1", features=[{"type": "CDS", "note": hostile}]),
        record("ctg2", features=[{"type": "CDS", "note": hostile}]),
    ]
    path = results_json(tmp_path, records)
    index = trim.build_records_index(path, buf_size=256)

    assert trim.record_from_index(path, index, "ctg2") == records[1]


def test_a_record_spanning_many_buffers_still_resolves(tmp_path):
    records = [record("ctg1"), record("big", seq="A" * 400_000), record("ctg3")]
    path = results_json(tmp_path, records)
    index = trim.build_records_index(path, buf_size=1024)

    assert trim.record_from_index(path, index, "big") == records[1]


def test_indexed_lookup_matches_the_streaming_scan_for_every_record(tmp_path):
    records = [record("ctg%d" % i, seq="ACGT" * (i + 1)) for i in range(25)]
    path = results_json(tmp_path, records)
    index = trim.build_records_index(path, buf_size=256)

    for entry in index["records"]:
        assert trim.record_from_index(path, index, entry[0]) == trim.select_record(
            path, entry[0]
        )


def test_index_is_saved_beside_the_json_and_loads_back(tmp_path):
    path = results_json(tmp_path, [record("ctg1"), record("ctg2")])
    trim.save_records_index(path, trim.build_records_index(path))

    assert os.path.exists(trim.records_index_path(path))
    assert [e[0] for e in trim.load_records_index(path)["records"]] == ["ctg1", "ctg2"]


def test_an_index_from_a_different_file_state_is_not_trusted(tmp_path):
    path = results_json(tmp_path, [record("ctg1"), record("ctg2")])
    trim.save_records_index(path, trim.build_records_index(path))

    results_json(tmp_path, [record("ctg1"), record("ctg2"), record("ctg3")])

    assert trim.load_records_index(path) is None


def test_a_record_without_an_id_does_not_shift_the_answer(tmp_path, monkeypatch):
    """A record with no `id` is absent from the index; "no match" must still fall
    back to it."""
    anonymous = {"seq": {"data": "TTTT"}, "features": [], "modules": {}}
    path = results_json(tmp_path, [anonymous, record("ctg1"), record("ctg2")])
    monkeypatch.setattr(trim, "INDEX_MIN_BYTES", 0)

    assert trim.select_record(path, "ctg2") == record("ctg2")
    assert trim.select_record(path, "absent") == anonymous


def test_selecting_a_record_from_a_large_file_leaves_an_index_behind(tmp_path, monkeypatch):
    monkeypatch.setattr(trim, "INDEX_MIN_BYTES", 0)
    path = results_json(tmp_path, [record("ctg1"), record("ctg2")])

    assert trim.select_record(path, "ctg2")["id"] == "ctg2"
    assert os.path.exists(trim.records_index_path(path))


def test_small_files_are_not_indexed(tmp_path):
    path = results_json(tmp_path, [record("ctg1"), record("ctg2")])

    assert trim.select_record(path, "ctg2")["id"] == "ctg2"
    assert not os.path.exists(trim.records_index_path(path))


def test_indexing_can_be_switched_off_by_environment(tmp_path, monkeypatch):
    monkeypatch.setattr(trim, "INDEX_MIN_BYTES", 0)
    monkeypatch.setenv("ANTISMASH_JSON_INDEX", "0")
    path = results_json(tmp_path, [record("ctg1"), record("ctg2")])

    assert trim.select_record(path, "ctg2")["id"] == "ctg2"
    assert not os.path.exists(trim.records_index_path(path))


def test_an_index_preserves_the_exact_then_fuzzy_then_first_precedence(tmp_path, monkeypatch):
    monkeypatch.setattr(trim, "INDEX_MIN_BYTES", 0)
    records = [record("NODE_1_length_500"), record("NODE_2"), record("NODE_2_extra")]
    path = results_json(tmp_path, records)
    indexed = tmp_path / "indexed.json"
    indexed.write_text((tmp_path / "results.json").read_text())

    for wanted, expected in (
        ("NODE_2", "NODE_2"),            # exact wins over the longer prefix match
        ("NODE_2_extra_more", "NODE_2"),  # fuzzy: the stored id is a prefix of the query
        ("NODE_1", "NODE_1_length_500"),  # fuzzy: the query is a prefix of the stored id
        ("absent", "NODE_1_length_500"),  # neither: the first record
    ):
        assert trim.select_record(path, wanted)["id"] == expected
        assert trim.select_record(str(indexed), wanted)["id"] == expected


def test_a_corrupt_index_is_not_trusted(tmp_path):
    path = results_json(tmp_path, [record("ctg1")])
    trim.save_records_index(path, trim.build_records_index(path))
    with open(trim.records_index_path(path), "w") as fh:
        fh.write('{"records": [["ctg1", 0]')  # truncated mid-write

    assert trim.load_records_index(path) is None


def test_main_writes_the_same_file_with_and_without_the_index(tmp_path, monkeypatch):
    records = [
        record("ctg1", features=[region(1, 0, 500), cds(10, 200, "ctg1_1")]),
        record("ctg2", features=[
            region(1, 0, 400), cds(5, 100, "ctg2_1"),
            region(2, 900, 1400), cds(950, 1100, "ctg2_2"),
        ]),
        record("ctg3", features=[region(1, 0, 300), cds(20, 150, "ctg3_1")]),
    ]
    path = results_json(tmp_path, records)

    def run(out_name):
        out = tmp_path / out_name
        monkeypatch.setattr(sys, "argv", [
            "trim_antismash_region.py",
            "--json-path", path,
            "--record-id", "ctg2",
            "--region-number", "2",
            "--out-path", str(out),
        ])
        assert trim.main() == 0
        return out.read_bytes()

    monkeypatch.setenv("ANTISMASH_JSON_INDEX", "0")
    scanned = run("scanned.json")

    monkeypatch.delenv("ANTISMASH_JSON_INDEX")
    monkeypatch.setattr(trim, "INDEX_MIN_BYTES", 0)
    indexed = run("indexed.json")

    assert os.path.exists(trim.records_index_path(path))
    assert indexed == scanned
    assert json.loads(indexed)["records"][0]["id"] == "ctg2"
