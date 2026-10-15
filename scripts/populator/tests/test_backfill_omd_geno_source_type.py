"""Unit tests for the DB-free logic in tools/backfill_omd_geno_source_type.py."""
import pytest

from scripts.populator.tools.backfill_omd_geno_source_type import (
    classify_report,
    index_reports,
    omd_name_to_accession,
    reclassification_matrix,
)


def _report(accession="GCA_000000001.1", notes=None, title=None):
    return {
        "accession": accession,
        "assembly_info": {
            "genome_notes": notes,
            "biosample": {"description": {"title": title}} if title is not None else {},
        },
    }


def test_derived_from_metagenome_is_a_mag():
    assert classify_report(_report(notes=["derived from metagenome"])) == "MAG"


def test_derived_from_single_cell_is_a_sag():
    assert classify_report(_report(notes=["derived from single cell"])) == "SAG"


def test_no_derivation_note_is_an_isolate():
    assert classify_report(_report(notes=["contaminated", "not used as type"])) == "isolate"


def test_absent_or_empty_notes_are_an_isolate():
    assert classify_report(_report(notes=None)) == "isolate"
    assert classify_report(_report(notes=[])) == "isolate"
    assert classify_report({"accession": "X", "assembly_info": {}}) == "isolate"


def test_derivation_note_is_matched_case_insensitively():
    assert classify_report(_report(notes=["Derived From Metagenome"])) == "MAG"


def test_a_sag_title_rescues_a_missing_derivation_note():
    """Three SAR11 SAGs (e.g. GCA_014654065.1) say SAG only in the BioSample title."""
    r = _report(notes=["genus undefined"], title="SAR11 SAG-MED15")
    assert classify_report(r) == "SAG"


@pytest.mark.parametrize("title", [
    "single cell genome of X",
    "single-cell amplified genome",
    "Sample SAGs from station 3",
])
def test_other_single_cell_phrasings_in_the_title(title):
    assert classify_report(_report(notes=[], title=title)) == "SAG"


@pytest.mark.parametrize("title", [
    # word-boundary matching: none of these are SAG
    "Sagittula stellata E-37",
    "Isolate from Lake Sagami",
    "SAGA project reference strain",
    "Massage-derived microbiota",
])
def test_sag_lookalikes_in_a_title_stay_isolates(title):
    assert classify_report(_report(notes=[], title=title)) == "isolate"


def test_the_derivation_note_outranks_the_title():
    """The explicit derivation note outranks the title."""
    r = _report(notes=["derived from metagenome"], title="SAG-like bin")
    assert classify_report(r) == "MAG"


def test_omd_name_to_accession():
    assert omd_name_to_accession(
        "RSGB23-1_GCF-002895405-V1_GENO_10000001") == "GCF_002895405.1"


def test_omd_name_without_an_accession():
    assert omd_name_to_accession("JGIG23-1_GA0061080_GENO_10000001") is None
    assert omd_name_to_accession("TARA_SAMEA6025493_MAG_00000105") is None


def test_index_reports_keys_on_both_requested_and_current_accession():
    """NCBI may swap `accession` and `current_accession` for a superseded genome."""
    reports = [{
        "accession": "GCA_000000002.2",
        "current_accession": "GCA_000000002.1",
        "assembly_info": {"genome_notes": ["derived from metagenome"]},
    }]
    idx = index_reports(reports)
    assert idx["GCA_000000002.2"] is idx["GCA_000000002.1"]


def test_index_reports_ignores_a_report_with_no_accession():
    assert index_reports([{"assembly_info": {}}]) == {}


def test_reclassification_matrix_counts_moves():
    matrix = reclassification_matrix([("MAG", "isolate"), ("MAG", "isolate"),
                                      ("MAG", "MAG"), ("MAG", "SAG")])
    assert matrix[("MAG", "isolate")] == 2
    assert matrix[("MAG", "MAG")] == 1
    assert matrix[("MAG", "SAG")] == 1
