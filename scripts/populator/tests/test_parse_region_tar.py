import io
import pathlib
import tarfile

from scripts.populator.adapters.antismash_gbk import parse_region_tar

FIX = pathlib.Path(__file__).parent / "fixtures"


def _make_tar(tar_path, members):
    with tarfile.open(tar_path, "w:gz") as tf:
        for arcname, text in members.items():
            data = text.encode("utf-8")
            info = tarfile.TarInfo(name=arcname)
            info.size = len(data)
            tf.addfile(info, io.BytesIO(data))


def test_parse_region_tar_yields_region_gbks_only(tmp_path):
    one = (FIX / "region_gbk_one.gbk").read_text()
    tar_path = tmp_path / "g.tar.gz"
    _make_tar(tar_path, {
        "g/g/ctg1.region001.gbk": one,
        "g/g/ctg2.region001.gbk": one,
        "g/g/g.gbk": one,                 # consolidated genome GBK -> ignored
        "g/g/index.html": "<html></html>",
        "g/g/regions.js": "var x = 1;",
    })
    regions = parse_region_tar(tar_path)
    assert len(regions) == 2
    by_contig = {r.contig: r for r in regions}
    assert set(by_contig) == {"ctg1", "ctg2"}
    assert by_contig["ctg1"].region_number == 1
    assert by_contig["ctg2"].region_number == 1


def test_parse_region_tar_skips_region_less_gbk(tmp_path):
    one = (FIX / "region_gbk_one.gbk").read_text()
    no_region = (FIX / "region_gbk_no_region.gbk").read_text()
    tar_path = tmp_path / "g.tar.gz"
    _make_tar(tar_path, {
        "g/g/ctg1.region001.gbk": one,
        "g/g/ctg2.region001.gbk": no_region,
    })
    regions = parse_region_tar(tar_path)
    assert [r.contig for r in regions] == ["ctg1"]


def test_parse_region_tar_no_region_gbks_returns_empty(tmp_path):
    one = (FIX / "region_gbk_one.gbk").read_text()
    tar_path = tmp_path / "g.tar.gz"
    _make_tar(tar_path, {
        "g/g/g.gbk": one,
        "g/g/index.html": "<html></html>",
    })
    assert parse_region_tar(tar_path) == []


def test_parse_region_tar_passes_taxon(tmp_path):
    one = (FIX / "region_gbk_one.gbk").read_text()
    tar_path = tmp_path / "g.tar.gz"
    _make_tar(tar_path, {"g/g/ctg1.region001.gbk": one})
    regions = parse_region_tar(tar_path, taxon="d__Bacteria")
    assert len(regions) == 1
    assert regions[0].taxon == "d__Bacteria"
