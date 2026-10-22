#!/usr/bin/env python3
"""Unit tests for gtdb_taxonomy.py.

Run with the project venv:
    .venv/bin/python test_gtdb_taxonomy.py
"""
import unittest

from gtdb_taxonomy import (
    RANKS,
    canonical_lineage,
    is_partial,
    rank_depth,
    restore_suffix,
    split_gtdb_lineage,
)


class TestRestoreSuffix(unittest.TestCase):
    def test_single_letter_genus_suffix(self):
        self.assertEqual(restore_suffix("Bacillus A"), "Bacillus_A")
        self.assertEqual(restore_suffix("Pseudomonas E"), "Pseudomonas_E")

    def test_suffix_inside_a_species_binomial(self):
        self.assertEqual(
            restore_suffix("Coprococcus C hominis"), "Coprococcus_C hominis"
        )

    def test_suffix_on_both_genus_and_epithet(self):
        self.assertEqual(
            restore_suffix("Bacillus A subtilis A"), "Bacillus_A subtilis_A"
        )

    def test_multi_letter_suffix(self):
        self.assertEqual(restore_suffix("Fusobacterium AB"), "Fusobacterium_AB")

    def test_leaves_plain_names_alone(self):
        for name in [
            "Escherichia coli",
            "Streptomyces",
            "Pseudomonas aeruginosa",
            "Aquipseudomonas lini",
        ]:
            self.assertEqual(restore_suffix(name), name)

    def test_leaves_placeholder_names_alone(self):
        for name in [
            "GJ-E10 sp000828975",
            "G047199095 sp047199095",
            "UBA1234",
            "WOR-3",
            "MGIIa-L1",
            "CG-Epi1",
        ]:
            self.assertEqual(restore_suffix(name), name)

    def test_does_not_swallow_a_lowercase_epithet(self):
        self.assertEqual(
            restore_suffix("Vescimonas sp900552475"), "Vescimonas sp900552475"
        )

    def test_none_and_empty(self):
        self.assertIsNone(restore_suffix(None))
        self.assertEqual(restore_suffix(""), "")


class TestCanonicalLineage(unittest.TestCase):
    def test_full_seven_rank_lineage(self):
        self.assertEqual(
            canonical_lineage(
                [
                    "Bacteria",
                    "Bacillota",
                    "Clostridia",
                    "Oscillospirales",
                    "Oscillospiraceae",
                    "Vescimonas",
                    "Vescimonas sp900552475",
                ]
            ),
            "d__Bacteria;p__Bacillota;c__Clostridia;o__Oscillospirales;"
            "f__Oscillospiraceae;g__Vescimonas;s__Vescimonas sp900552475",
        )

    def test_stops_at_the_first_missing_rank(self):
        self.assertEqual(
            canonical_lineage(
                [
                    "Bacteria",
                    "Bacillota",
                    "Clostridia",
                    "Lachnospirales",
                    "Lachnospiraceae",
                    None,
                    None,
                ]
            ),
            "d__Bacteria;p__Bacillota;c__Clostridia;o__Lachnospirales;"
            "f__Lachnospiraceae",
        )

    def test_does_not_resume_after_a_gap(self):
        self.assertEqual(
            canonical_lineage(
                ["Bacteria", "Bacillota", None, None, None, None, "Something sp1"]
            ),
            "d__Bacteria;p__Bacillota",
        )

    def test_applies_suffix_restoration(self):
        self.assertEqual(
            canonical_lineage(
                [
                    "Bacteria",
                    "Bacillota",
                    "Clostridia",
                    "Lachnospirales",
                    "Lachnospiraceae",
                    "Coprococcus C",
                    "Coprococcus C hominis",
                ]
            ),
            "d__Bacteria;p__Bacillota;c__Clostridia;o__Lachnospirales;"
            "f__Lachnospiraceae;g__Coprococcus_C;s__Coprococcus_C hominis",
        )

    def test_domain_only(self):
        self.assertEqual(
            canonical_lineage(["Bacteria", None, None, None, None, None, None]),
            "d__Bacteria",
        )

    def test_unclassified_yields_empty(self):
        self.assertEqual(canonical_lineage([None] * 7), "")


class TestDepthHelpers(unittest.TestCase):
    def test_rank_depth(self):
        self.assertEqual(rank_depth("d__Bacteria"), 1)
        self.assertEqual(rank_depth("d__Bacteria;p__Bacillota"), 2)
        self.assertEqual(
            rank_depth(
                "d__Bacteria;p__Bacillota;c__Clostridia;o__Lachnospirales;"
                "f__Lachnospiraceae;g__Coprococcus_C;s__Coprococcus_C hominis"
            ),
            7,
        )

    def test_is_partial(self):
        self.assertTrue(is_partial("d__Bacteria"))
        self.assertTrue(is_partial("d__Bacteria;p__Bacillota"))
        self.assertFalse(
            is_partial(
                "d__Bacteria;p__Bacillota;c__Clostridia;o__Lachnospirales;"
                "f__Lachnospiraceae;g__Coprococcus_C;s__Coprococcus_C hominis"
            )
        )


class TestSplitGtdbLineage(unittest.TestCase):
    def test_round_trips_a_reference_line(self):
        lin = (
            "d__Bacteria;p__Pseudomonadota;c__Gammaproteobacteria;"
            "o__Enterobacterales;f__Enterobacteriaceae;g__Escherichia;"
            "s__Escherichia coli"
        )
        parts = split_gtdb_lineage(lin)
        self.assertEqual(len(parts), len(RANKS))
        self.assertEqual(parts[0], "Bacteria")
        self.assertEqual(parts[5], "Escherichia")
        self.assertEqual(parts[6], "Escherichia coli")
        self.assertEqual(canonical_lineage(parts), lin)

    def test_keeps_existing_underscore_suffixes_intact(self):
        lin = (
            "d__Bacteria;p__Pseudomonadota;c__Gammaproteobacteria;"
            "o__Pseudomonadales;f__Pseudomonadaceae;g__Pseudomonas_E;"
            "s__Pseudomonas_E lini"
        )
        self.assertEqual(canonical_lineage(split_gtdb_lineage(lin)), lin)

    def test_empty_trailing_ranks_become_none(self):
        lin = "d__Archaea;p__Thermoproteota;c__;o__;f__;g__;s__"
        parts = split_gtdb_lineage(lin)
        self.assertEqual(parts[:2], ["Archaea", "Thermoproteota"])
        self.assertEqual(parts[2:], [None] * 5)
        self.assertEqual(canonical_lineage(parts), "d__Archaea;p__Thermoproteota")


if __name__ == "__main__":
    unittest.main(verbosity=2)
