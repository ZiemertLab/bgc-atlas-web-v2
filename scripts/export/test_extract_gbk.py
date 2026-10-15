import gzip
import io
import os
import tarfile

import pytest

from scripts.export.extract_gbk import run
from scripts.export.repack_regions_gbk import repack

A = "ef1e0ff2-a653-52b8-a80a-6026c43c8374"
B = "5fefcc41-8f4b-572f-8f9a-616aa05777e6"
C = "7a82c197-1309-5056-b5cc-cbcbae9e7d0e"
OLD = "0b3d0805-22e4-5868-b5da-6c0cc66e628c"  # a removed duplicate of B
UNKNOWN = "00000000-0000-5000-8000-000000000000"
FILES = {A + ".gbk": b"LOCUS one\n" * 300, B + ".gbk": b"LOCUS two\n" * 7, C + ".gbk": b"LOCUS three\n"}


@pytest.fixture
def published(tmp_path):
    """An archive, its gzipped index with the header line, and a redirects file."""
    raw = io.BytesIO()
    with tarfile.open(fileobj=raw, mode="w", format=tarfile.GNU_FORMAT) as tf:
        for name, data in FILES.items():
            info = tarfile.TarInfo(name)
            info.size = len(data)
            tf.addfile(info, io.BytesIO(data))
    archive, index = tmp_path / "all_regions_gbk.tar.gz", io.StringIO()
    with open(archive, "wb") as out:
        repack(io.BytesIO(raw.getvalue()), out, index, 2, batch_bytes=1024, log=io.StringIO())
    size = os.path.getsize(archive)
    with gzip.open(tmp_path / "index.tsv.gz", "wt") as f:
        f.write("# archive sha256 %s size %d\n" % ("0" * 64, size) + index.getvalue())
    with gzip.open(tmp_path / "redirects.tsv.gz", "wt") as f:
        f.write("old_bgc_id\tcurrent_bgc_id\n%s\t%s\n" % (OLD, B))
    return tmp_path


def _run(d, ids, redirects=True, **kw):
    (d / "ids.txt").write_text("\n".join(ids) + "\n")
    log = io.StringIO()
    code = run(str(d / "ids.txt"), str(d / "all_regions_gbk.tar.gz"), str(d / "index.tsv.gz"), str(d / "out"),
               str(d / "redirects.tsv.gz") if redirects else None, log=log, **kw)
    return code, log.getvalue()


def test_extracts_exactly_the_requested_regions(published):
    code, _ = _run(published, [C, A, "# a comment", "", A.upper()])
    assert code == 0
    assert sorted(os.listdir(published / "out")) == sorted([A + ".gbk", C + ".gbk"])
    assert (published / "out" / (A + ".gbk")).read_bytes() == FILES[A + ".gbk"]
    assert (published / "out" / (C + ".gbk")).read_bytes() == FILES[C + ".gbk"]


def test_an_old_id_is_written_from_its_replacement_under_its_own_name(published):
    code, log = _run(published, [OLD])
    assert code == 0
    assert (published / "out" / (OLD + ".gbk")).read_bytes() == FILES[B + ".gbk"]
    assert "redirected: 1" in log


def test_without_redirects_an_old_id_is_reported_with_the_hint(published):
    code, log = _run(published, [OLD, A], redirects=False)
    assert code == 1
    assert (published / "out" / "not_found.txt").read_text() == OLD + "\n"
    assert "try --redirects" in log


def test_unknown_and_malformed_ids_are_reported_not_fatal(published):
    code, log = _run(published, [A, UNKNOWN, "not-an-id"])
    assert code == 1
    assert (published / "out" / (A + ".gbk")).exists()
    assert (published / "out" / "not_found.txt").read_text() == UNKNOWN + "\n"
    assert "skipped, not a BGC id: not-an-id" in log


def test_an_index_from_another_build_is_refused_before_anything_is_written(published):
    with gzip.open(published / "index.tsv.gz", "rt") as f:
        text = f.read()
    with gzip.open(published / "index.tsv.gz", "wt") as f:
        f.write(text.replace(" size ", " size 1", 1))
    code, log = _run(published, [A])
    assert code == 2
    assert "does not match this archive" in log
    assert not (published / "out").exists()


def test_a_stale_offset_is_caught_by_the_tar_header_not_written(published):
    # Same size, but A's row points at B's bytes: what a rebuilt archive would do.
    with gzip.open(published / "index.tsv.gz", "rt") as f:
        lines = f.read().splitlines()
    rows = {l.split("\t")[0]: l.split("\t") for l in lines[1:]}
    rows[A + ".gbk"][1:3] = rows[B + ".gbk"][1:3]
    with gzip.open(published / "index.tsv.gz", "wt") as f:
        f.write(lines[0] + "\n" + "".join("\t".join(r) + "\n" for r in rows.values()))
    code, log = _run(published, [A, C])
    assert code == 1
    assert not (published / "out" / (A + ".gbk")).exists()
    assert (published / "out" / (C + ".gbk")).exists()
    assert "found %s.gbk instead" % B in log


def test_ids_can_come_from_stdin(published, monkeypatch):
    monkeypatch.setattr("sys.stdin", io.StringIO(A + "\n"))
    log = io.StringIO()
    code = run("-", str(published / "all_regions_gbk.tar.gz"), str(published / "index.tsv.gz"),
               str(published / "out"), log=log)
    assert code == 0
    assert (published / "out" / (A + ".gbk")).exists()
