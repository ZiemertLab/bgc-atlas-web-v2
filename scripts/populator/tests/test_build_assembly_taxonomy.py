"""Unit tests for the DB-free resolution logic in tools/build_assembly_taxonomy.py."""
import random

import pytest

from scripts.populator.tools.build_assembly_taxonomy import (
    CONSENSUS_METHOD,
    LineageRow,
    group_rows,
    is_classified,
    lineage_string,
    nested_majority,
    resolve_genome,
)

BACTERIA = "d__Bacteria"


def ranks(*values):
    return tuple(values) + (None,) * (7 - len(values))


PSEUDO = ranks(BACTERIA, "p__Pseudomonadota", "c__Gammaproteobacteria",
               "o__Enterobacterales", "f__Enterobacteriaceae", "g__Escherichia",
               "s__Escherichia coli")
BACILLOTA = ranks(BACTERIA, "p__Bacillota", "c__Bacilli", "o__Bacillales",
                  "f__Bacillaceae", "g__Bacillus", "s__Bacillus subtilis")
CLOSTRIDIA = ranks(BACTERIA, "p__Bacillota", "c__Clostridia")


def predicted(lineage, n, method="orf_lca_v1"):
    return LineageRow(method=method, ranks=lineage, taxonomy_id=None, n=n)


def genome_derived(lineage, n, taxonomy_id="tax-1", method="gtdb_r232"):
    return LineageRow(method=method, ranks=lineage, taxonomy_id=taxonomy_id, n=n)


class TestIsClassified:
    def test_a_named_domain_is_classified(self):
        assert is_classified(PSEUDO)

    def test_a_missing_domain_is_not(self):
        assert not is_classified(ranks())

    @pytest.mark.parametrize("value", ["d__Unknown", "d__unknown", "  d__Unknown  "])
    def test_unknown_domain_is_not_a_taxon(self, value):
        assert not is_classified(ranks(value))


class TestNestedMajority:
    def test_unanimous_resolves_to_full_depth(self):
        accepted, backing = nested_majority([(PSEUDO, 5)])
        assert accepted == list(PSEUDO[:7])
        assert backing == 5

    def test_no_majority_at_domain_resolves_to_nothing(self):
        archaea = ranks("d__Archaea", "p__Thermoproteota")
        accepted, _ = nested_majority([(PSEUDO, 3), (archaea, 3)])
        assert accepted == []

    def test_stops_at_the_rank_where_the_majority_runs_out(self):
        # 4 Bacillota vs 2 Pseudomonadota: phylum carries 4/6. Below it the
        # Bacillota split 2 Bacilli / 2 Clostridia, so class has no majority.
        accepted, backing = nested_majority([
            (BACILLOTA, 2), (CLOSTRIDIA, 2), (PSEUDO, 2),
        ])
        assert accepted == [BACTERIA, "p__Bacillota"]
        assert backing == 4

    def test_denominator_is_the_surviving_set_not_the_whole_genome(self):
        # 3 Bacilli + 1 Clostridia + 2 Pseudomonadota: 3/4 survivors is a majority at
        # class even though 3/6 of the genome is not.
        accepted, backing = nested_majority([
            (BACILLOTA, 3), (CLOSTRIDIA, 1), (PSEUDO, 2),
        ])
        assert accepted[:3] == [BACTERIA, "p__Bacillota", "c__Bacilli"]
        assert backing == 3

    def test_an_exact_tie_is_not_a_majority(self):
        # Both lineages are Bacteria, so the domain is unanimous and the 3-3 tie
        # falls at phylum: half is not a strict majority, so it stops there.
        accepted, backing = nested_majority([(BACILLOTA, 3), (PSEUDO, 3)])
        assert accepted == [BACTERIA]
        assert backing == 6

    def test_uncalled_ranks_stay_in_the_denominator(self):
        # 1 BGC names the phylum, 2 stop at domain. The phylum has a plurality of
        # the calls but only 1/3 of the survivors, so it must not be kept.
        accepted, _ = nested_majority([(BACILLOTA, 1), (ranks(BACTERIA), 2)])
        assert accepted == [BACTERIA]

    def test_a_majority_over_uncalled_ranks_is_still_a_majority(self):
        accepted, backing = nested_majority([(BACILLOTA, 2), (ranks(BACTERIA), 1)])
        assert accepted == list(BACILLOTA[:7])
        assert backing == 2

    def test_result_does_not_depend_on_row_order(self):
        voters = [(BACILLOTA, 3), (CLOSTRIDIA, 1), (PSEUDO, 2)]
        expected = nested_majority(voters)
        rng = random.Random(0)
        for _ in range(20):
            shuffled = voters[:]
            rng.shuffle(shuffled)
            assert nested_majority(shuffled) == expected


class TestResolveGenome:
    def test_genome_derived_beats_a_larger_prediction_set(self):
        # One GTDB-classified BGC against 20 predicted ones: GTDB classified the
        # GENOME, the predictions are per-BGC guesses at the same organism.
        resolution, conflict = resolve_genome([
            genome_derived(PSEUDO, 1),
            predicted(BACILLOTA, 20),
        ])
        assert resolution.ranks == PSEUDO
        assert resolution.method == "gtdb_r232"
        assert resolution.agreement is None
        assert conflict is False

    def test_gtdb_legacy_also_counts_as_genome_derived(self):
        resolution, _ = resolve_genome([
            genome_derived(PSEUDO, 2, method="gtdb_legacy"),
            predicted(BACILLOTA, 9),
        ])
        assert resolution.method == "gtdb_legacy"

    def test_conflicting_genome_derived_lineages_are_flagged(self):
        resolution, conflict = resolve_genome([
            genome_derived(PSEUDO, 3),
            genome_derived(BACILLOTA, 1),
        ])
        assert conflict is True
        assert resolution.ranks == PSEUDO

    def test_genome_derived_lineage_stopping_short_of_species(self):
        # Sorting the candidate lineages must not compare None against a str.
        short = ranks(BACTERIA, "p__Bacillota", "c__Bacilli", "o__Bacillales",
                      "f__Bacillaceae", "g__Bacillus")
        resolution, conflict = resolve_genome([
            genome_derived(short, 4),
            genome_derived(BACILLOTA, 1),
        ])
        assert conflict is True
        assert resolution.ranks == short
        assert resolution.rank == "genus"

    def test_consensus_records_its_rank_and_agreement(self):
        resolution, _ = resolve_genome([
            predicted(BACILLOTA, 2), (predicted(CLOSTRIDIA, 2)), predicted(PSEUDO, 2),
        ])
        assert resolution.rank == "phylum"
        assert resolution.method == CONSENSUS_METHOD
        assert resolution.n_voting == 6
        assert resolution.agreement == pytest.approx(4 / 6)

    def test_ranks_below_the_resolved_one_are_null(self):
        resolution, _ = resolve_genome([
            predicted(BACILLOTA, 2), predicted(CLOSTRIDIA, 2), predicted(PSEUDO, 2),
        ])
        assert resolution.ranks == ranks(BACTERIA, "p__Bacillota")

    def test_bgcs_without_taxonomy_count_toward_n_bgcs_only(self):
        resolution, _ = resolve_genome([
            predicted(PSEUDO, 3),
            LineageRow(method=None, ranks=ranks(), taxonomy_id=None, n=7),
        ])
        assert resolution.n_bgcs == 10
        assert resolution.n_voting == 3
        assert resolution.agreement == pytest.approx(1.0)

    def test_a_genome_with_no_classified_bgc_gets_no_row(self):
        resolution, conflict = resolve_genome([
            LineageRow(method=None, ranks=ranks(), taxonomy_id=None, n=4),
        ])
        assert resolution is None
        assert conflict is False

    def test_a_genome_whose_bgcs_are_all_unknown_gets_no_row(self):
        resolution, _ = resolve_genome([predicted(ranks("d__Unknown"), 6)])
        assert resolution is None

    def test_a_genome_that_cannot_agree_on_a_domain_gets_no_row(self):
        resolution, _ = resolve_genome([
            predicted(PSEUDO, 2), predicted(ranks("d__Archaea"), 2),
        ])
        assert resolution is None

    def test_taxonomy_id_is_looked_up_for_a_truncated_consensus(self):
        index = {"d__Bacteria;p__Bacillota": "tax-bacillota"}
        resolution, _ = resolve_genome([
            predicted(BACILLOTA, 2), predicted(CLOSTRIDIA, 2), predicted(PSEUDO, 2),
        ], index)
        assert resolution.taxonomy_id == "tax-bacillota"

    def test_taxonomy_id_is_null_when_the_prefix_is_not_a_known_lineage(self):
        resolution, _ = resolve_genome([
            predicted(BACILLOTA, 2), predicted(CLOSTRIDIA, 2), predicted(PSEUDO, 2),
        ], {})
        assert resolution.taxonomy_id is None


class TestLineageString:
    def test_joins_prefixed_ranks_the_way_taxonomies_keys_them(self):
        assert lineage_string([BACTERIA, "p__Bacillota"]) == "d__Bacteria;p__Bacillota"


class TestGroupRows:
    def test_groups_consecutive_rows_by_assembly(self):
        scan = [
            ("asm-1", "orf_lca_v1", None, *PSEUDO, 3),
            ("asm-1", "orf_lca_v1", None, *BACILLOTA, 1),
            ("asm-2", "gtdb_r232", "tax-1", *BACILLOTA, 5),
        ]
        grouped = list(group_rows(scan))
        assert [assembly for assembly, _ in grouped] == ["asm-1", "asm-2"]
        assert [len(batch) for _, batch in grouped] == [2, 1]
        assert grouped[0][1][0] == LineageRow("orf_lca_v1", PSEUDO, None, 3)
        assert grouped[1][1][0].taxonomy_id == "tax-1"

    def test_emits_nothing_for_an_empty_scan(self):
        assert list(group_rows([])) == []
