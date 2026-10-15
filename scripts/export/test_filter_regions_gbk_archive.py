import io
import subprocess
import sys
import tarfile

import pytest

from scripts.export.repack_regions_gbk import repack

A, B, C = "aaaaaaaa-0000-5000-8000-000000000001", "bbbbbbbb-0000-5000-8000-000000000002", \
    "cccccccc-0000-5000-8000-000000000003"


def _tar(files: dict) -> bytes:
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w", format=tarfile.GNU_FORMAT) as tf:
        for name, data in files.items():
            info = tarfile.TarInfo(name)
            info.size = len(data)
            tf.addfile(info, io.BytesIO(data))
    return buf.getvalue()


def _archive(tmp_path, files):
    out, index = io.BytesIO(), io.StringIO()
    repack(io.BytesIO(_tar(files)), out, index, 1, batch_bytes=1024, log=io.StringIO())
    (tmp_path / "old.tar.gz").write_bytes(out.getvalue())
    (tmp_path / "old.index.tsv").write_text(index.getvalue())


def _filter(tmp_path, remove, add):
    (tmp_path / "remove.txt").write_text("".join(i + "\n" for i in remove))
    (tmp_path / "add.tar").write_bytes(_tar(add))
    return subprocess.run(
        [sys.executable, "-m", "scripts.export.filter_regions_gbk_archive", "--old", str(tmp_path / "old.tar.gz"),
         "--old-index", str(tmp_path / "old.index.tsv"), "--remove", str(tmp_path / "remove.txt"),
         "--add", str(tmp_path / "add.tar"), "--out", str(tmp_path / "new.tar.gz"),
         "--index", str(tmp_path / "new.index.tsv"), "--verify-sample", "10"],
        capture_output=True, text=True)


def _members(path):
    with tarfile.open(path, "r:gz") as tf:
        return {m.name: tf.extractfile(m).read() for m in tf if m.isfile()}


def test_a_removed_id_can_come_back_with_new_content(tmp_path):
    _archive(tmp_path, {f"{A}.gbk": b"LOCUS old A\n" * 40, f"{B}.gbk": b"LOCUS B\n" * 9})
    r = _filter(tmp_path, [A], {f"{A}.gbk": b"LOCUS new A\n" * 41, f"{C}.gbk": b"LOCUS C\n"})
    assert r.returncode == 0, r.stderr + r.stdout
    assert _members(tmp_path / "new.tar.gz") == {
        f"{B}.gbk": b"LOCUS B\n" * 9, f"{A}.gbk": b"LOCUS new A\n" * 41, f"{C}.gbk": b"LOCUS C\n"}


def test_adding_a_kept_id_is_refused(tmp_path):
    _archive(tmp_path, {f"{A}.gbk": b"LOCUS A\n", f"{B}.gbk": b"LOCUS B\n"})
    r = _filter(tmp_path, [A], {f"{B}.gbk": b"LOCUS another B\n"})
    assert r.returncode != 0 and "already in the old archive" in (r.stderr + r.stdout)


@pytest.mark.parametrize("remove", [[], [A]])
def test_adding_an_id_twice_is_refused(tmp_path, remove):
    _archive(tmp_path, {f"{A}.gbk": b"LOCUS A\n"})
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w", format=tarfile.GNU_FORMAT) as tf:
        for data in (b"one\n", b"two\n"):
            info = tarfile.TarInfo(f"{C}.gbk")
            info.size = len(data)
            tf.addfile(info, io.BytesIO(data))
    (tmp_path / "remove.txt").write_text("".join(i + "\n" for i in remove))
    (tmp_path / "add.tar").write_bytes(buf.getvalue())
    r = subprocess.run(
        [sys.executable, "-m", "scripts.export.filter_regions_gbk_archive", "--old", str(tmp_path / "old.tar.gz"),
         "--old-index", str(tmp_path / "old.index.tsv"), "--remove", str(tmp_path / "remove.txt"),
         "--add", str(tmp_path / "add.tar"), "--out", str(tmp_path / "new.tar.gz"),
         "--index", str(tmp_path / "new.index.tsv")], capture_output=True, text=True)
    assert r.returncode != 0 and "added twice" in (r.stderr + r.stdout)
