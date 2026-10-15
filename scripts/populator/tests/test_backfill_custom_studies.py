"""Unit tests for the DB-free, network-free logic in tools/backfill_custom_studies.py."""
import json
import uuid

import pytest

from scripts.populator.tools.backfill_custom_studies import (
    CUSTOM_STUDIES,
    STUDY_TYPE,
    build_study_row,
    cited_dois,
    clean_text,
    strip_jats,
    study_id_for,
)

CROSSREF = {
    "10.1093/gigascience/giaf135": {
        "title": "Ultra-deep long-read metagenomics captures diverse taxonomic and biosynthetic potential of soil",
        "abstract": "<jats:p>Soil is deep.</jats:p>",
        "publisher": "Oxford University Press",
        "journal": "GigaScience",
        "year": 2025,
    },
}


class TestRegistry:
    def test_every_entry_declares_accession_doi_and_centre(self):
        # A missing centre would stay NULL under the fill-only UPDATE.
        for name, spec in CUSTOM_STUDIES.items():
            assert spec.get("accession"), f"{name} has no accession"
            assert spec.get("doi"), f"{name} has no doi"
            assert spec.get("center"), f"{name} has no center"

    def test_no_declared_centre_is_a_journal_publisher(self):
        publishers = ("oxford university press", "springer", "elsevier", "wiley",
                      "american society for microbiology", "frontiers media")
        for name, spec in CUSTOM_STUDIES.items():
            low = spec["center"].lower()
            assert not any(p in low for p in publishers), f"{name} centre is a publisher"

    def test_accessions_are_unique(self):
        # a duplicate would be silently dropped by ON CONFLICT DO NOTHING
        accs = [s["accession"] for s in CUSTOM_STUDIES.values()]
        assert len(accs) == len(set(accs))

    def test_fram_ras_is_anchored_on_the_bioproject_not_the_doi(self):
        # PRJEB67368's 47 ENA runs match our 47 samples; don't "normalise" it to the DOI.
        fram = CUSTOM_STUDIES["custom_fram_ras"]
        assert fram["accession"] == "PRJEB67368"
        assert fram["doi"].startswith("10.")

    def test_source_names_look_like_custom_data_sources(self):
        for name in CUSTOM_STUDIES:
            assert name.startswith("custom_")

    def test_extra_dois_are_dois_and_never_repeat_the_anchor(self):
        # a repeat would render the same paper twice on the study page
        for name, spec in CUSTOM_STUDIES.items():
            for extra in spec.get("extra_dois") or []:
                assert extra.startswith("10."), f"{name}: {extra} is not a DOI"
                assert extra.lower() != spec["doi"].lower(), f"{name} repeats its anchor"

    def test_ziemert_cites_both_of_its_papers(self):
        # Mirrors adapters/customs_metadata.py `_ZIEMERT_PAPER`.
        dois = cited_dois(CUSTOM_STUDIES["custom_ziemert_lab"]).split(",")
        assert dois == ["10.1093/gigascience/giaf135", "10.1128/msystems.01018-21"]


class TestStudyIdFor:
    def test_is_deterministic(self):
        assert study_id_for("custom_ziemert_lab") == study_id_for("custom_ziemert_lab")

    def test_differs_per_source(self):
        assert study_id_for("custom_ziemert_lab") != study_id_for("custom_fram_ras")

    def test_is_a_valid_uuid(self):
        uuid.UUID(study_id_for("custom_ziemert_lab"))


class TestBuildStudyRow:
    SPEC = CUSTOM_STUDIES["custom_ziemert_lab"]

    def _row(self, crossref=CROSSREF):
        return build_study_row("custom_ziemert_lab", self.SPEC, "src-uuid", crossref)

    def test_column_order_matches_the_insert(self):
        # INSERT INTO studies (id, accession, study_name, title, abstract,
        #                      center_name, study_type, data_source_ids, metadata)
        row = self._row()
        assert row[0] == study_id_for("custom_ziemert_lab")
        assert row[1] == self.SPEC["accession"]
        assert row[2] == "custom_ziemert_lab"
        assert row[3].startswith("Ultra-deep long-read metagenomics")
        assert row[4] == "Soil is deep."
        assert row[5] == self.SPEC["center"]
        assert row[6] == STUDY_TYPE
        assert row[7] == ["src-uuid"]

    def test_center_name_is_the_declared_centre_not_the_publisher(self):
        row = self._row()
        assert row[5] == "Ziemert Lab, University of Tübingen"
        assert row[5] != CROSSREF[self.SPEC["doi"]]["publisher"]

    def test_study_name_is_the_source_key_not_the_title(self):
        assert self._row()[2] == "custom_ziemert_lab"

    def test_metadata_carries_doi_journal_year(self):
        # journal/year stay the anchor paper's
        meta = json.loads(self._row()[8])
        assert meta["doi"] == ("10.1093/gigascience/giaf135,"
                               "10.1128/msystems.01018-21")
        assert meta["journal"] == "GigaScience"
        assert meta["year"] == 2025

    def test_unresolved_doi_yields_a_null_title(self):
        row = self._row(crossref={})
        assert row[3] is None
        assert row[1] == self.SPEC["accession"]

    def test_metadata_omits_missing_keys(self):
        meta = json.loads(self._row(crossref={})[8])
        assert meta == {"doi": ("10.1093/gigascience/giaf135,"
                                "10.1128/msystems.01018-21")}

    def test_extra_dois_do_not_change_the_title_or_abstract(self):
        # Crossref here knows only the anchor.
        row = self._row()
        assert row[3].startswith("Ultra-deep long-read metagenomics")
        assert row[4] == "Soil is deep."


class TestCitedDois:
    def test_anchor_only_when_there_are_no_extras(self):
        assert cited_dois({"doi": "10.1/a"}) == "10.1/a"

    def test_anchor_comes_first(self):
        # the study page dedupes the DOI list against the accession, which is the anchor
        assert cited_dois({"doi": "10.1/a", "extra_dois": ["10.2/b"]}) == "10.1/a,10.2/b"

    def test_joined_with_a_comma_which_is_what_splitids_expects(self):
        # api/studies/[id]/route.ts splits metadata->>'doi' on [,;]
        assert "," in cited_dois({"doi": "10.1/a", "extra_dois": ["10.2/b"]})

    def test_duplicate_extra_is_dropped_case_insensitively(self):
        assert cited_dois({"doi": "10.1/A", "extra_dois": ["10.1/a", "10.2/b"]}) == "10.1/A,10.2/b"

    def test_blank_and_whitespace_entries_are_ignored(self):
        assert cited_dois({"doi": " 10.1/a ", "extra_dois": ["", "  ", "10.2/b"]}) == "10.1/a,10.2/b"

    def test_no_doi_at_all_is_none_so_the_key_is_omitted(self):
        # build_study_row drops falsy metadata keys
        assert cited_dois({}) is None


class TestTextHelpers:
    def test_strip_jats_flattens_and_unescapes(self):
        assert strip_jats("<jats:p>a &amp; b</jats:p>") == "a & b"

    def test_strip_jats_drops_leading_heading(self):
        assert strip_jats("<jats:title>Abstract</jats:title><jats:p>Body.</jats:p>") == "Body."

    @pytest.mark.parametrize("value", [None, "", "  ", "<jats:p> </jats:p>"])
    def test_strip_jats_empty_is_none(self, value):
        assert strip_jats(value) is None

    def test_clean_text_collapses_whitespace(self):
        assert clean_text("a  \n b") == "a b"

    @pytest.mark.parametrize("value", [None, "", "   "])
    def test_clean_text_empty_is_none(self, value):
        assert clean_text(value) is None


def test_fill_update_never_restores_a_withheld_abstract():
    # migration 0083 deleted non-redistributable abstracts and set abstract_withheld; the
    # fill-only UPDATE must leave those NULL (and must not run just because they are NULL)
    import inspect
    from scripts.populator.tools import backfill_custom_studies as b
    src = inspect.getsource(b.main)
    assert "CASE WHEN abstract_withheld THEN abstract" in src
    assert "(abstract IS NULL AND NOT abstract_withheld)" in src
