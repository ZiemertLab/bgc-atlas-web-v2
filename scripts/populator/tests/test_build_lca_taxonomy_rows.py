import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "tools"))
from build_lca_taxonomy_rows import convert, parse_ranked  # noqa: E402


def row(rank, support, ranked):
    return ["b1", "1", rank, "x", "10", "10", "8", support, "", ranked]


def test_species_with_suffix_restored():
    r = convert(row("species", "0.800", "d_Bacteria;p_Bacillota;c_Bacilli;o_Bacillales;f_Bacillaceae;g_Bacillus A;s_Bacillus A cereus"))
    assert r[1] == "d__Bacteria;p__Bacillota;c__Bacilli;o__Bacillales;f__Bacillaceae;g__Bacillus_A;s__Bacillus_A cereus"
    assert r[2] == "species" and r[4] == "species"


def test_domain_only_maps_superkingdom():
    r = convert(row("superkingdom", "1.000", "d_Bacteria"))
    assert r[1] == "d__Bacteria" and r[2] == "domain" and r[4] == "domain"


def test_root_and_unclassified_skipped():
    assert convert(row("no rank", "1.000", "-_root")) == "no_domain"
    assert convert(row("no rank", "0.000", "")) == "unclassified"
    assert convert(row("genus", "0.490", "d_Bacteria;p_Bacillota")) == "unclassified"


def test_parse_ranked_ignores_unknown_prefixes():
    assert parse_ranked("d_Bacteria;x_foo;p_Bacillota") == ["Bacteria", "Bacillota", None, None, None, None, None]
