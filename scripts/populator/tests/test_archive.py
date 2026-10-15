from scripts.populator.adapters import archive
from scripts.populator.adapters.archive import derive_alias, archive_stem, find_json_member
import io, json, tarfile, pathlib
import pytest

ARCH = pathlib.Path("/data/bgc-atlas/data-v2/custom-datasets/"
                    "fram_ras/FRAM_RAS_F4_03_1819_1-contigs.tar.gz")
needs_archive = pytest.mark.skipif(not ARCH.exists(), reason="real archive not mounted")

def test_alias_strips_known_suffixes():
    assert derive_alias("FRAM_RAS_F4_01_1718-contigs") == "FRAM_RAS_F4_01_1718"
    assert derive_alias("124-5-R1-1-33_assembly") == "124-5-R1-1-33"
    assert derive_alias("STO1-LR-COASSEMBLY-CONTIGS") == "STO1-LR-COASSEMBLY"
    assert derive_alias("MFD00008") == "MFD00008"

def test_archive_stem():
    assert archive_stem("/x/FRAM_RAS_F4_03_1819_1-contigs.tar.gz") == "FRAM_RAS_F4_03_1819_1-contigs"

@needs_archive
def test_finds_consolidated_json():
    with tarfile.open(ARCH, "r:gz") as t:
        member = find_json_member(t)
    assert member is not None and member.endswith(".json")
    assert not member.endswith("_regions.json")

def _make_tar(path, members):
    """members: dict of {member_name: bytes}."""
    with tarfile.open(path, "w:gz") as t:
        for name, data in members.items():
            info = tarfile.TarInfo(name)
            info.size = len(data)
            t.addfile(info, io.BytesIO(data))

def test_load_regions_json_reads_nested_member(tmp_path):
    # mirror a real mgnify tarball: member nested two levels deep
    tarpath = tmp_path / "RUN.tar.gz"
    payload = json.dumps({"records": []}).encode("utf-8")
    _make_tar(tarpath, {"RUN/RUN/RUN_regions.json": payload})
    assert archive.load_regions_json(str(tarpath)) == {"records": []}

def test_find_regions_json_member_returns_nested_name(tmp_path):
    tarpath = tmp_path / "RUN.tar.gz"
    payload = json.dumps({"records": []}).encode("utf-8")
    _make_tar(tarpath, {"RUN/RUN/RUN_regions.json": payload})
    with tarfile.open(tarpath, "r:gz") as t:
        member = archive.find_regions_json_member(t)
    assert member == "RUN/RUN/RUN_regions.json"

def test_load_regions_json_raises_when_absent(tmp_path):
    tarpath = tmp_path / "NO_REGIONS.tar.gz"
    _make_tar(tarpath, {"RUN/RUN/RUN.json": b"{}"})
    with pytest.raises(FileNotFoundError):
        archive.load_regions_json(str(tarpath))
