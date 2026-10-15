"""iter_region_gbks skips the duplicate '<run>_basic/' region GBKs MGnify archives
bundle and dedups by basename."""
import io
import tarfile
from pathlib import Path

from scripts.populator.tools.extract_sequences import iter_region_gbks, _in_basic_dir


def test_in_basic_dir():
    assert _in_basic_dir("MGYA1/MGYA1_basic/k141_5.region001.gbk") is True
    assert _in_basic_dir("MGYA1/MGYA1/k141_5.region001.gbk") is False
    # only directory parts count, not the filename
    assert _in_basic_dir("MGYA1/MGYA1/x_basic.region001.gbk") is False


def _tar_with(members: dict[str, bytes], path: Path) -> Path:
    with tarfile.open(path, "w:gz") as tf:
        for name, data in members.items():
            ti = tarfile.TarInfo(name)
            ti.size = len(data)
            tf.addfile(ti, io.BytesIO(data))
    return path


def test_skips_basic_duplicate_in_tarball(tmp_path):
    # one real region, present in BOTH the full dir and the _basic dir
    arc = _tar_with({
        "MGYA1/MGYA1/k141_5.region001.gbk": b"FULL",
        "MGYA1/MGYA1_basic/k141_5.region001.gbk": b"BASIC",
        "MGYA1/MGYA1/k141_9.region001.gbk": b"FULL2",
        "MGYA1/MGYA1_basic/k141_9.region001.gbk": b"BASIC2",
    }, tmp_path / "MGYA1.tar.gz")
    out = list(iter_region_gbks(arc))
    names = [n for n, _ in out]
    assert names == ["k141_5.region001.gbk", "k141_9.region001.gbk"]   # 2 real, not 4
    assert dict(out)["k141_5.region001.gbk"] == b"FULL"
    assert dict(out)["k141_9.region001.gbk"] == b"FULL2"


def test_no_basic_unaffected(tmp_path):
    arc = _tar_with({
        "MGYA2/MGYA2/k1.region001.gbk": b"A",
        "MGYA2/MGYA2/k2.region001.gbk": b"B",
    }, tmp_path / "MGYA2.tar.gz")
    assert sorted(n for n, _ in iter_region_gbks(arc)) == ["k1.region001.gbk", "k2.region001.gbk"]
