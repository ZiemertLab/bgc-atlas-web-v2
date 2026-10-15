"""Unit tests for the DB-free logic in tools/build_facet_vocab.py. The promotion gate
is what matters: a wrong "yes" means autocomplete silently returns nothing for a field.
"""

from scripts.populator.tools.build_facet_vocab import (
    FIELDS,
    MAPPING,
    report_diff,
)


class TestReportDiff:
    def test_growth_is_not_a_regression(self):
        old = {"product_type": 42, "tax_genus": 12_904}
        new = {"product_type": 43, "tax_genus": 13_118}
        assert report_diff(old, new) == []

    def test_a_field_losing_terms_is_reported(self):
        old = {"ripp_subclass": 31, "pfam": 19_233}
        new = {"ripp_subclass": 30, "pfam": 19_233}
        assert report_diff(old, new) == [("ripp_subclass", 31, 30)]

    def test_a_single_term_lost_counts(self):
        # Any decrease blocks: a renamed field is indistinguishable from a small loss.
        assert report_diff({"pfam": 2}, {"pfam": 1}) == [("pfam", 2, 1)]

    def test_a_field_that_vanishes_entirely_is_a_loss(self):
        assert report_diff({"ripp_subclass": 31}, {}) == [("ripp_subclass", 31, 0)]

    def test_a_brand_new_field_is_not_a_loss(self):
        assert report_diff({}, {"tfbs_regulators": 88}) == []

    def test_unchanged_fields_are_not_losses(self):
        assert report_diff({"biome": 5}, {"biome": 5}) == []

    def test_every_loss_is_returned_not_just_the_first(self):
        old = {"a": 5, "b": 5, "c": 5}
        new = {"a": 4, "b": 5, "c": 0}
        assert report_diff(old, new) == [("a", 5, 4), ("c", 5, 0)]

    def test_empty_on_both_sides_is_quiet(self):
        # first ever run: nothing to regress against
        assert report_diff({}, {}) == []

    def test_first_run_against_no_alias_never_blocks(self):
        assert report_diff({}, {"pfam": 19_233, "biome": 12}) == []


class TestFieldRegistry:
    def test_fields_are_unique(self):
        # a duplicate would inflate its count and look like growth to the gate
        assert len(FIELDS) == len(set(FIELDS))

    def test_mapping_indexes_the_three_document_fields(self):
        props = MAPPING["mappings"]["properties"]
        assert set(props) == {"field", "value", "count"}
        # `value.prefix` makes autocomplete a prefix match rather than exact
        assert props["value"]["fields"]["prefix"]["analyzer"] == "edge"
