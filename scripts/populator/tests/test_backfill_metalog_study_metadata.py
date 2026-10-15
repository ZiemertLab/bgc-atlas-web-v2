"""Unit tests for the DB-free, network-free logic in
tools/backfill_metalog_study_metadata.py."""
import pytest

from scripts.populator.tools.backfill_metalog_study_metadata import (
    TARGET_COLS,
    build_update_row,
    clean_text,
    parse_bioprojects,
    pick_consistent,
    resolve_logical,
    resolve_study_title,
    row_bioproject,
    split_ids,
    strip_jats,
)

# Real shapes from bgc_atlas_v2.
ENA_TITLE = "16S metabarcoding data of global soil samples"
ENA_DESCR = "Here, we leverage metabarcoding in 190 soil microbiome samples."
PAPER_TITLE = "Convergence between the microcosms of Southeast Asian and North American pitcher plants"


class TestParseBioprojects:
    def test_single_accession(self):
        assert parse_bioprojects("PRJEB19856") == ["PRJEB19856"]

    def test_comma_joined_list_keeps_order(self):
        assert parse_bioprojects("PRJEB19856, PRJEB19855, PRJEB18701") == [
            "PRJEB19856", "PRJEB19855", "PRJEB18701"]

    def test_mgrast_id_is_not_a_bioproject(self):
        assert parse_bioprojects("mgp15454") == []

    def test_ncbi_and_ddbj_prefixes(self):
        assert parse_bioprojects("PRJNA760651") == ["PRJNA760651"]
        assert parse_bioprojects("PRJDB7293") == ["PRJDB7293"]

    def test_deduplicates_repeats_but_keeps_distinct_ids(self):
        assert parse_bioprojects("PRJEB19856, PRJEB19856") == ["PRJEB19856"]
        assert parse_bioprojects("PRJEB1, PRJEB19856") == ["PRJEB1", "PRJEB19856"]

    def test_uppercases(self):
        assert parse_bioprojects("prjeb19856") == ["PRJEB19856"]

    @pytest.mark.parametrize("value", [None, "", "   "])
    def test_empty_inputs(self, value):
        assert parse_bioprojects(value) == []


class TestSplitIds:
    """Treating a joined cell as one id would 404 at Crossref and lose the title."""

    def test_comma_joined_dois(self):
        assert split_ids("10.1021/acs.est.6b04477, 10.1111/1462-2920.12936") == [
            "10.1021/acs.est.6b04477", "10.1111/1462-2920.12936"]

    def test_comma_joined_pmids(self):
        assert split_ids("29955139, 30013118, 30013236") == [
            "29955139", "30013118", "30013236"]

    def test_semicolon_separator(self):
        assert split_ids("10.1/a; 10.2/b") == ["10.1/a", "10.2/b"]

    def test_single_value_is_a_one_item_list(self):
        assert split_ids("10.7554/eLife.36741") == ["10.7554/eLife.36741"]

    def test_deduplicates_and_strips(self):
        assert split_ids(" 10.1/a ,10.1/a , 10.2/b ") == ["10.1/a", "10.2/b"]

    @pytest.mark.parametrize("value", [None, "", "  ", " , "])
    def test_empty_inputs(self, value):
        assert split_ids(value) == []


class TestStripJats:
    def test_flattens_tags_and_entities(self):
        raw = "<jats:p>Soils harbour &amp; sustain diverse microbiomes.</jats:p>"
        assert strip_jats(raw) == "Soils harbour & sustain diverse microbiomes."

    def test_drops_leading_abstract_heading(self):
        raw = "<jats:title>Abstract</jats:title><jats:p>Real content here.</jats:p>"
        assert strip_jats(raw) == "Real content here."

    def test_collapses_whitespace_across_tags(self):
        assert strip_jats("<p>one</p>\n\n  <p>two</p>") == "one two"

    @pytest.mark.parametrize("value", [None, "", "   ", "<jats:p>  </jats:p>"])
    def test_empty_becomes_none_not_empty_string(self, value):
        # the caller's COALESCE must see "nothing found", not an empty string
        assert strip_jats(value) is None


class TestCleanText:
    def test_collapses_whitespace(self):
        assert clean_text("a  \n b\t c") == "a b c"

    @pytest.mark.parametrize("value", [None, "", "  \n "])
    def test_empty_becomes_none(self, value):
        assert clean_text(value) is None


class TestResolveStudyTitle:
    CROSSREF = {"10.7554/elife.36741": {"title": PAPER_TITLE}}
    PUBMED = {"26944845": {"title": "Metagenomic Signatures of Bacterial Adaptation"}}

    def test_crossref_wins_over_pubmed(self):
        assert resolve_study_title(["10.7554/eLife.36741"], ["26944845"],
                                   self.CROSSREF, self.PUBMED) == PAPER_TITLE

    def test_pubmed_used_when_no_doi_resolves(self):
        assert resolve_study_title([], ["26944845"], self.CROSSREF, self.PUBMED) == \
            "Metagenomic Signatures of Bacterial Adaptation"

    def test_doi_lookup_is_case_insensitive(self):
        assert resolve_study_title(["10.7554/ELIFE.36741"], [], self.CROSSREF, {}) == PAPER_TITLE

    def test_multi_paper_study_is_order_independent(self):
        cr = {"10.1/aaa": {"title": "Paper A"}, "10.2/bbb": {"title": "Paper B"}}
        forward = resolve_study_title(["10.1/aaa", "10.2/bbb"], [], cr, {})
        reverse = resolve_study_title(["10.2/bbb", "10.1/aaa"], [], cr, {})
        assert forward == reverse == "Paper A"

    def test_skips_dois_absent_from_crossref(self):
        assert resolve_study_title(["10.0/missing", "10.7554/eLife.36741"], [],
                                   self.CROSSREF, {}) == PAPER_TITLE

    def test_none_when_no_paper(self):
        assert resolve_study_title([], [], self.CROSSREF, self.PUBMED) is None

    def test_negative_cached_entry_is_not_a_hit(self):
        assert resolve_study_title(["10.1/x"], [], {"10.1/x": {}}, {}) is None


class TestPickConsistent:
    def test_single_distinct_value_wins(self):
        assert pick_consistent(["EMBL", "EMBL", None]) == "EMBL"

    def test_disagreement_yields_none(self):
        assert pick_consistent(["Sample A metagenome", "Sample B metagenome"]) is None

    def test_all_empty_yields_none(self):
        assert pick_consistent([None, "", "  "]) is None

    def test_whitespace_variants_count_as_one_value(self):
        assert pick_consistent(["EMBL", " EMBL "]) == "EMBL"


class TestResolveLogical:
    CROSSREF = {"10.7554/elife.36741": {"title": PAPER_TITLE,
                                        "abstract": "<jats:p>Pitcher plants.</jats:p>"}}
    ENA_CONSISTENT = {"PRJEB1": {"study_title": ENA_TITLE, "study_description": ENA_DESCR,
                                 "center_name": "EMBL"},
                      "PRJEB2": {"study_title": ENA_TITLE, "study_description": ENA_DESCR,
                                 "center_name": "EMBL"}}
    ENA_DIVERGENT = {"PRJEB1": {"study_title": "Sample 1 metagenome",
                                "study_description": "sample 1", "center_name": "EMBL"},
                     "PRJEB2": {"study_title": "Sample 2 metagenome",
                                "study_description": "sample 2", "center_name": "EMBL"}}

    def test_ena_never_supplies_a_title_even_when_consistent(self):
        rows = [{"accession": "PRJEB1", "doi": None, "pmid": None}]
        got = resolve_logical(rows, {}, {}, self.ENA_CONSISTENT)
        assert got["title"] is None

    def test_paper_title_is_used(self):
        rows = [{"accession": "PRJEB1", "doi": "10.7554/eLife.36741", "pmid": None}]
        got = resolve_logical(rows, self.CROSSREF, {}, self.ENA_CONSISTENT)
        assert got["title"] == PAPER_TITLE

    def test_title_is_shared_across_siblings_that_list_different_ids(self):
        rows = [{"accession": "PRJEB1", "doi": None, "pmid": None},
                {"accession": "PRJEB2", "doi": "10.7554/eLife.36741", "pmid": None}]
        got = resolve_logical(rows, self.CROSSREF, {}, self.ENA_DIVERGENT)
        assert got["title"] == PAPER_TITLE

    def test_abstract_prefers_crossref_stripped(self):
        rows = [{"accession": "PRJEB1", "doi": "10.7554/eLife.36741", "pmid": None}]
        assert resolve_logical(rows, self.CROSSREF, {}, self.ENA_CONSISTENT)["abstract"] == "Pitcher plants."

    def test_abstract_falls_back_to_ena_only_when_consistent(self):
        rows = [{"accession": "PRJEB1", "doi": None, "pmid": None},
                {"accession": "PRJEB2", "doi": None, "pmid": None}]
        assert resolve_logical(rows, {}, {}, self.ENA_CONSISTENT)["abstract"] == ENA_DESCR
        assert resolve_logical(rows, {}, {}, self.ENA_DIVERGENT)["abstract"] is None

    def test_center_name_requires_agreement(self):
        rows = [{"accession": "PRJEB1", "doi": None, "pmid": None},
                {"accession": "PRJEB2", "doi": None, "pmid": None}]
        assert resolve_logical(rows, {}, {}, self.ENA_CONSISTENT)["center_name"] == "EMBL"
        split = {"PRJEB1": {"center_name": "EMBL"}, "PRJEB2": {"center_name": "JGI"}}
        assert resolve_logical(rows, {}, {}, split)["center_name"] is None

    def test_bioproject_is_not_a_logical_field(self):
        rows = [{"accession": "PRJEB1", "doi": None, "pmid": None}]
        assert "bioproject" not in resolve_logical(rows, {}, {}, {})


class TestRowBioproject:
    def test_first_of_the_rows_own_accession(self):
        assert row_bioproject("PRJEB19856, PRJEB18701") == "PRJEB19856"

    def test_none_without_a_bioproject(self):
        assert row_bioproject("mgp15454") is None
        assert row_bioproject(None) is None


class TestBuildUpdateRow:
    WANT = {"title": PAPER_TITLE, "abstract": "abs", "center_name": "EMBL",
            "bioproject": "PRJEB19856"}
    EMPTY_HAVE = {c: None for c in TARGET_COLS}

    def test_all_columns_filled_when_row_is_empty(self):
        row = build_update_row("uuid-1", self.EMPTY_HAVE, self.WANT)
        assert row == ("uuid-1", PAPER_TITLE, "abs", "EMBL", "PRJEB19856")

    def test_existing_values_are_never_overwritten(self):
        have = dict(self.EMPTY_HAVE, title="Already here")
        row = build_update_row("uuid-1", have, self.WANT)
        assert row[1] is None            # title masked out
        assert row[2] == "abs"           # the rest still fill

    def test_empty_string_counts_as_missing(self):
        have = dict(self.EMPTY_HAVE, title="")
        row = build_update_row("uuid-1", have, self.WANT)
        assert row[1] == PAPER_TITLE

    def test_returns_none_when_nothing_would_change(self):
        have = {c: "x" for c in TARGET_COLS}
        assert build_update_row("uuid-1", have, self.WANT) is None

    def test_returns_none_when_nothing_resolved(self):
        nothing = {c: None for c in TARGET_COLS}
        assert build_update_row("uuid-1", self.EMPTY_HAVE, nothing) is None

    def test_withheld_abstract_is_not_refetched(self):
        # Migration 0083 withheld 680 abstracts (NULL + abstract_withheld); fill-only
        # would otherwise restore them.
        have = dict(self.EMPTY_HAVE, abstract_withheld=True)
        row = build_update_row("uuid-1", have, self.WANT)
        assert row[2] is None
        assert row[1] == PAPER_TITLE

    def test_withheld_row_with_nothing_else_to_fill_is_skipped_entirely(self):
        have = {c: "x" for c in TARGET_COLS} | {"abstract": None, "abstract_withheld": True}
        assert build_update_row("uuid-1", have, self.WANT) is None

    def test_abstract_still_fills_when_not_withheld(self):
        have = dict(self.EMPTY_HAVE, abstract_withheld=False)
        assert build_update_row("uuid-1", have, self.WANT)[2] == "abs"

    def test_column_order_matches_the_values_alias(self):
        # the UPDATE binds VALUES %s AS v(id, title, abstract, center_name, bioproject)
        row = build_update_row("uuid-1", self.EMPTY_HAVE, self.WANT)
        assert list(row[1:]) == [self.WANT[c] for c in TARGET_COLS]
        assert TARGET_COLS == ["title", "abstract", "center_name", "bioproject"]
