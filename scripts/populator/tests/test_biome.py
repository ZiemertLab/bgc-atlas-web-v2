from scripts.populator.adapters.biome import biome_nodes


def test_multi_segment_lineage_splits_into_prefix_nodes():
    nodes = biome_nodes("root:Host-associated:Mammals")
    assert nodes == [
        ("root", 0, None),
        ("root:Host-associated", 1, "root"),
        ("root:Host-associated:Mammals", 2, "root:Host-associated"),
    ]


def test_single_term_is_one_root_node():
    nodes = biome_nodes("root")
    assert nodes == [("root", 0, None)]


def test_empty_and_whitespace_segments_dropped():
    nodes = biome_nodes("root: :Mammals: ")
    assert nodes == [
        ("root", 0, None),
        ("root:Mammals", 1, "root"),
    ]


def test_surrounding_whitespace_stripped_per_segment():
    nodes = biome_nodes(" root : Host ")
    assert nodes == [
        ("root", 0, None),
        ("root:Host", 1, "root"),
    ]


def test_empty_string_yields_no_nodes():
    assert biome_nodes("") == []
