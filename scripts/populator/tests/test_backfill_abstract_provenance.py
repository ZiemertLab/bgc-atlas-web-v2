"""Unit tests for the DB-free, network-free logic in
tools/backfill_abstract_provenance.py: which licence URL is stored, which count as
open (default-deny), and whether a stored abstract really came from a given DOI.
"""
import pytest

from scripts.populator.tools.backfill_abstract_provenance import (
    TARGET_COLS,
    abstracts_match,
    build_update_row,
    choose_license,
    classify_license,
    normalize_for_match,
    resolve_provenance,
    split_ids,
    strip_jats,
)

# Real shapes from bgc_atlas_v2 / the Crossref API.
CC_BY = "http://creativecommons.org/licenses/by/4.0/"
CC_BY_NC_ND = "https://creativecommons.org/licenses/by-nc-nd/4.0"
OUP_REUSE = "https://academic.oup.com/pages/standard-publication-reuse-rights"
SPRINGER_TDM = "http://www.springer.com/tdm"

PITCHER = ("The 'pitchers' of carnivorous pitcher plants are exquisite examples of "
           "convergent evolution. An open question is whether the living communities "
           "housed in pitchers also converge in structure or function.")


class TestSplitIds:
    def test_single(self):
        assert split_ids("10.7554/eLife.36741") == ["10.7554/eLife.36741"]

    def test_comma_joined_keeps_order(self):
        assert split_ids("10.1038/ismej.2015.2, 10.1038/ncomms13219") == [
            "10.1038/ismej.2015.2", "10.1038/ncomms13219"]

    def test_none_and_empty(self):
        assert split_ids(None) == []
        assert split_ids("  ") == []


class TestStripJats:
    def test_flattens_tags_and_drops_the_heading(self):
        raw = "<jats:title>Abstract</jats:title><jats:p>Viral evolution is revealed.</jats:p>"
        assert strip_jats(raw) == "Viral evolution is revealed."

    def test_unescapes_entities(self):
        assert strip_jats("<jats:p>salt &amp; water</jats:p>") == "salt & water"

    def test_empty_is_none(self):
        assert strip_jats("<jats:title>Abstract</jats:title>") is None
        assert strip_jats(None) is None


class TestAbstractsMatch:
    def test_identical(self):
        assert abstracts_match(PITCHER, PITCHER)

    def test_whitespace_and_case_differences_still_match(self):
        assert abstracts_match(PITCHER, "  " + PITCHER.upper().replace(" ", "\n  ") + " ")

    def test_truncated_store_matches_full_crossref_text(self):
        # MGnify truncates at 2,000 chars; publishers can append later.
        assert abstracts_match(PITCHER[:150], PITCHER)

    def test_different_papers_do_not_match(self):
        assert not abstracts_match(PITCHER, "Deciphering how microbial communities are shaped.")

    def test_short_shared_opening_is_not_enough(self):
        assert not abstracts_match("Here we report", "Here we report a new genome.")

    def test_missing_side_is_never_a_match(self):
        assert not abstracts_match(None, PITCHER)
        assert not abstracts_match(PITCHER, None)
        assert not abstracts_match("", "")


class TestNormalizeForMatch:
    def test_collapses_and_casefolds(self):
        assert normalize_for_match("  Salt\n\tWater ") == "salt water"

    def test_none_is_empty(self):
        assert normalize_for_match(None) == ""


class TestChooseLicense:
    def test_prefers_creative_commons_over_a_tdm_grant(self):
        # 10.1038/ismej.2017.39 shape: the CC URL is the one worth storing.
        assert choose_license([
            {"URL": SPRINGER_TDM, "content-version": "tdm"},
            {"URL": CC_BY, "content-version": "vor"},
        ]) == CC_BY

    def test_falls_back_to_the_version_of_record_when_no_cc(self):
        # 10.1038/ismej.2016.14 shape: closed, but we record which terms.
        assert choose_license([
            {"URL": SPRINGER_TDM, "content-version": "tdm"},
            {"URL": OUP_REUSE, "content-version": "vor"},
        ]) == OUP_REUSE

    def test_tdm_only_work_still_records_its_url(self):
        assert choose_license([{"URL": SPRINGER_TDM, "content-version": "tdm"}]) == SPRINGER_TDM

    def test_accepted_manuscript_cc_does_not_win(self):
        assert choose_license([
            {"URL": CC_BY, "content-version": "am"},
            {"URL": OUP_REUSE, "content-version": "vor"},
        ]) == OUP_REUSE

    def test_unspecified_content_version_counts_as_version_of_record(self):
        assert choose_license([{"URL": CC_BY}]) == CC_BY

    def test_empty_and_malformed(self):
        assert choose_license(None) is None
        assert choose_license([]) is None
        assert choose_license([{"content-version": "vor"}]) is None


class TestClassifyLicense:
    @pytest.mark.parametrize("url", [
        CC_BY,
        CC_BY_NC_ND,
        "https://creativecommons.org/licenses/by-nc-sa/4.0",
        "https://creativecommons.org/publicdomain/zero/1.0/",
    ])
    def test_creative_commons_is_open(self, url):
        # NC and ND included: verbatim reproduction is not a derivative.
        assert classify_license(url) == "open"

    @pytest.mark.parametrize("url", [OUP_REUSE, SPRINGER_TDM,
                                     "https://www.elsevier.com/tdm/userlicense/1.0/"])
    def test_proprietary_and_tdm_only_are_closed(self, url):
        assert classify_license(url) == "closed"

    def test_missing_licence_defaults_to_closed(self):
        assert classify_license(None) == "closed"
        assert classify_license("") == "closed"


class TestResolveProvenance:
    def test_mgnify_short_circuits_without_consulting_crossref(self):
        study = {"id": "s1", "source": "MGnify", "abstract": PITCHER,
                 "doi": "10.7554/eLife.36741"}
        crossref = {"10.7554/elife.36741": {"abstract": PITCHER, "license": [{"URL": CC_BY}]}}
        assert resolve_provenance(study, crossref) == {
            "abstract_source": "mgnify", "abstract_doi": None,
            "abstract_license": None, "abstract_publisher": None}

    def test_matching_crossref_text_claims_the_doi_and_its_licence(self):
        study = {"id": "s2", "source": "metalog", "abstract": PITCHER,
                 "doi": "10.7554/eLife.36741"}
        crossref = {"10.7554/elife.36741": {
            "abstract": f"<jats:title>Abstract</jats:title><jats:p>{PITCHER}</jats:p>",
            "license": [{"URL": CC_BY, "content-version": "vor"}],
            "publisher": "eLife Sciences Publications, Ltd"}}
        assert resolve_provenance(study, crossref) == {
            "abstract_source": "crossref", "abstract_doi": "10.7554/elife.36741",
            "abstract_license": CC_BY,
            "abstract_publisher": "eLife Sciences Publications, Ltd"}

    def test_doi_whose_text_does_not_match_is_ena_only_once_ena_confirms_it(self):
        # The metalog resolver fell back to ENA, so the DOI alone proves nothing.
        descr = "Soil sampled across Denmark at 10,000 sites over four years, shotgun sequenced."
        study = {"id": "s3", "source": "metalog", "abstract": descr,
                 "accession": "PRJEB58634", "doi": "10.7554/eLife.36741"}
        crossref = {"10.7554/elife.36741": {"abstract": PITCHER}}
        ena = {"PRJEB58634": {"study_description": descr}}
        assert resolve_provenance(study, crossref, ena)["abstract_source"] == "ena"

    def test_text_no_source_can_account_for_is_left_unproven(self):
        # Guessing "ena" would launder publisher prose into archive text.
        study = {"id": "s3b", "source": "metalog", "abstract": PITCHER,
                 "accession": "PRJEB58634", "doi": "10.7554/eLife.36741"}
        crossref = {"10.7554/elife.36741": {"abstract": "Something else entirely."}}
        ena = {"PRJEB58634": {"study_description": "Soil sampled across Denmark."}}
        assert resolve_provenance(study, crossref, ena)["abstract_source"] is None

    def test_no_doi_is_ena_without_needing_corroboration(self):
        study = {"id": "s4", "source": "metalog", "abstract": PITCHER,
                 "accession": "PRJEB58634", "doi": None}
        assert resolve_provenance(study, {})["abstract_source"] == "ena"

    def test_uncached_doi_is_unproven_not_a_crash(self):
        study = {"id": "s5", "source": "metalog", "abstract": PITCHER,
                 "accession": "PRJEB58634", "doi": "10.9999/missing"}
        assert resolve_provenance(study, {}, {})["abstract_source"] is None

    def test_injected_adapter_abstract_is_publisher_text_not_archive_text(self):
        # Crossref has no abstract for the hardcoded MFD DOI; only the injected arm
        # keeps it out of the archive branch.
        study = {"id": "s9", "source": "custom_microflora_danica", "abstract": PITCHER,
                 "accession": "PRJEB58634", "doi": "10.1038/s41586-025-09794-2"}
        crossref = {"10.1038/s41586-025-09794-2": {
            "abstract": None,
            "license": [{"URL": CC_BY_NC_ND, "content-version": "vor"}],
            "publisher": "Springer Science and Business Media LLC"}}
        got = resolve_provenance(study, crossref, {}, [(PITCHER, "10.1038/s41586-025-09794-2")])
        assert got["abstract_source"] == "europepmc"
        assert got["abstract_license"] == CC_BY_NC_ND
        assert got["abstract_publisher"] == "Springer Science and Business Media LLC"

    def test_injected_arm_is_checked_before_the_archive_fallback(self):
        study = {"id": "s10", "source": "custom_microflora_danica", "abstract": PITCHER,
                 "accession": "PRJEB58634", "doi": "10.1038/s41586-025-09794-2"}
        ena = {"PRJEB58634": {"study_description": PITCHER}}
        got = resolve_provenance(study, {}, ena, [(PITCHER, "10.1038/s41586-025-09794-2")])
        assert got["abstract_source"] == "europepmc"

    def test_multi_doi_picks_the_one_that_actually_matches(self):
        study = {"id": "s6", "source": "metalog", "abstract": PITCHER,
                 "accession": "PRJEB58634",
                 "doi": "10.1038/ncomms13219, 10.7554/eLife.36741"}
        crossref = {
            "10.1038/ncomms13219": {"abstract": "A different paper entirely, about viruses.",
                                    "license": [{"URL": OUP_REUSE}]},
            "10.7554/elife.36741": {"abstract": PITCHER,
                                    "license": [{"URL": CC_BY}], "publisher": "eLife"},
        }
        got = resolve_provenance(study, crossref)
        assert got["abstract_doi"] == "10.7554/elife.36741"
        assert got["abstract_license"] == CC_BY

    def test_crossref_hit_with_no_licence_still_records_the_doi(self):
        study = {"id": "s7", "source": "metalog", "abstract": PITCHER,
                 "doi": "10.7554/eLife.36741"}
        crossref = {"10.7554/elife.36741": {"abstract": PITCHER, "publisher": "eLife"}}
        got = resolve_provenance(study, crossref)
        assert got["abstract_source"] == "crossref"
        assert got["abstract_license"] is None
        assert classify_license(got["abstract_license"]) == "closed"

    def test_blank_publisher_is_none_not_empty_string(self):
        study = {"id": "s8", "source": "metalog", "abstract": PITCHER,
                 "doi": "10.7554/eLife.36741"}
        crossref = {"10.7554/elife.36741": {"abstract": PITCHER, "publisher": "   "}}
        assert resolve_provenance(study, crossref)["abstract_publisher"] is None


class TestBuildUpdateRow:
    def test_row_is_id_then_target_cols_in_order(self):
        want = {"abstract_source": "crossref", "abstract_doi": "10.1/x",
                "abstract_license": CC_BY, "abstract_publisher": "eLife"}
        assert build_update_row("s1", want) == ("s1", "crossref", "10.1/x", CC_BY, "eLife")

    def test_nulls_are_carried_through_rather_than_skipped(self):
        # Derived columns: a re-run must be able to clear a withdrawn licence.
        want = {"abstract_source": "ena", "abstract_doi": None,
                "abstract_license": None, "abstract_publisher": None}
        assert build_update_row("s2", want) == ("s2", "ena", None, None, None)

    def test_row_width_tracks_target_cols(self):
        assert len(build_update_row("s3", {})) == len(TARGET_COLS) + 1
