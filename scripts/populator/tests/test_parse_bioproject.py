import pathlib
from scripts.populator.tools.parse_bioproject import parse_bioproject_set

FIX = pathlib.Path(__file__).parent / "fixtures" / "bioproject_small.xml"


def test_prefers_title_then_name():
    d = parse_bioproject_set(FIX.read_text())
    assert d["PRJNA802201"] == "Crop Bioprotection Raw sequence reads"  # Title wins
    assert d["PRJNA000002"] == "Soil metagenome"                        # falls back to Name


def test_all_missing_omitted():
    d = parse_bioproject_set(FIX.read_text())
    assert "PRJNA000003" not in d   # Title 'none' + Name 'missing' both dropped
