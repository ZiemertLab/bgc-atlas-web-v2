from scripts.populator.tools.gcf_dominant_taxon import (
    TAXONOMIC_RANKS,
    dominant_fields,
    dominant_taxon,
)


def test_picks_the_largest_taxon_and_reports_its_share():
    taxon, share = dominant_taxon({"p__Cyanobacteriota": 95.59, "p__Unknown": 4.41})
    assert taxon == "p__Cyanobacteriota"
    assert share == 95.59


# *__Unknown marks members unassigned at that rank; at species it averages 42.9% of a family.
def test_never_lets_unknown_win_even_when_it_is_the_largest_share():
    taxon, share = dominant_taxon({"s__Unknown": 54.41, "s__Nodularia spumigena": 42.65, "s__Nostoc sp015714725": 2.94})
    assert taxon == "s__Nodularia spumigena"
    assert share == 42.65


def test_reports_no_taxon_when_only_unknown_is_present():
    assert dominant_taxon({"g__Unknown": 100.0}) == (None, None)


def test_reports_no_taxon_for_a_missing_or_empty_distribution():
    assert dominant_taxon(None) == (None, None)
    assert dominant_taxon({}) == (None, None)


def test_ties_break_deterministically_on_the_taxon_name():
    tied = {"p__Bacillota": 50.0, "p__Actinomycetota": 50.0}
    first = dominant_taxon(tied)
    assert first == dominant_taxon(dict(reversed(list(tied.items()))))
    assert first[0] in tied


def test_emits_a_share_not_a_dominance_flag_so_the_cutoff_stays_in_the_ui():
    # whether 21% counts as dominant is the UI's call
    taxon, share = dominant_taxon({"p__A": 21.0, "p__B": 20.0, "p__C": 19.0, "p__Unknown": 40.0})
    assert (taxon, share) == ("p__A", 21.0)


def test_dominant_fields_covers_every_rank_present():
    fields = dominant_fields({
        "phylum": {"p__Cyanobacteriota": 95.59, "p__Unknown": 4.41},
        "genus": {"g__Nodularia": 50.0, "g__Unknown": 47.06, "g__Nostoc": 2.94},
    })
    assert fields == {
        "dom_phylum": "p__Cyanobacteriota", "dom_phylum_pct": 95.59,
        "dom_genus": "g__Nodularia", "dom_genus_pct": 50.0,
    }


# The query side uses `exists` to separate "not resolved" from "no majority".
def test_unresolved_ranks_are_omitted_rather_than_written_as_null():
    fields = dominant_fields({"phylum": {"p__X": 100.0}, "species": {"s__Unknown": 100.0}})
    assert "dom_species" not in fields
    assert "dom_species_pct" not in fields
    assert fields["dom_phylum"] == "p__X"


def test_dominant_fields_handles_a_document_with_no_taxonomy_at_all():
    assert dominant_fields(None) == {}
    assert dominant_fields({}) == {}


def test_ranks_are_the_seven_gtdb_ranks_in_order():
    assert TAXONOMIC_RANKS == ("domain", "phylum", "class", "order", "family", "genus", "species")


def test_ignores_non_numeric_shares_rather_than_crashing():
    assert dominant_taxon({"p__A": None, "p__B": 12.0}) == ("p__B", 12.0)
