import pytest

from scripts.populator.tools.gtdb_release_metadata import (
    RENAMED, SAME_NAME, release_metadata)


def _row(**over):
    row = {c: "1" for c in SAME_NAME}
    row.update({c: "1" for c in RENAMED.values()})
    row.update({"checkm_completeness": "88.0", "checkm_contamination": "7.0",   # CheckM1
                "checkm2_completeness": "99.87", "checkm2_contamination": "0.1",
                "checkm2_model": "Specific", "accession": "RS_GCF_1.1"})
    row.update(over)
    return row


def test_checkm_keys_carry_checkm2_values():
    md = release_metadata(_row())
    assert md["checkm_completeness"] == "99.87"       # not CheckM1's 88.0
    assert md["checkm_contamination"] == "0.1"
    assert md["quality_model"] == "Specific"
    assert md["quality_tool"] == "CheckM2"


def test_none_dropped_na_kept():
    md = release_metadata(_row(ncbi_isolation_source="none", ncbi_protein_count="",
                               ncbi_isolate="na"))
    assert "ncbi_isolation_source" not in md
    assert "ncbi_protein_count" not in md
    assert md["ncbi_isolate"] == "na"


def test_only_known_keys():
    md = release_metadata(_row(accession="RS_GCF_1.1", checkm2_model="General"))
    assert set(md) == set(SAME_NAME) | set(RENAMED) | {"quality_tool"}


def test_refuses_a_row_missing_columns():
    row = _row()
    del row["gtdb_taxonomy"]
    with pytest.raises(ValueError):
        release_metadata(row)
