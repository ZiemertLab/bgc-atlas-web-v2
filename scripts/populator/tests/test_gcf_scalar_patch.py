import pytest

from scripts.populator.tools.gcf_scalar_patch import carried_settings, load_map, parse_args


def write_map(tmp_path, text):
    path = tmp_path / "map.tsv"
    path.write_text(text, encoding="utf-8")
    return str(path)


def test_list_column_splits_on_the_unit_separator_and_keeps_strings(tmp_path):
    """Numeric-looking labels stay strings; the separator is \\x1f because real labels
    contain commas, colons and pipes."""
    path = write_map(tmp_path, "gcf_id\tbiome_terms\tlength_est\n"
                               "a\troot:Host-associated\x1fmarine, pelagic\x1f3\t2200\n")
    fields, values = load_map(path, {"biome_terms"})
    assert fields == ["biome_terms", "length_est"]
    assert values["a"] == {"biome_terms": ["root:Host-associated", "marine, pelagic", "3"],
                           "length_est": 2200}


def test_empty_list_value_removes_the_field_rather_than_writing_an_empty_array(tmp_path):
    path = write_map(tmp_path, "gcf_id\tbiome_terms\nb\t\n")
    _, values = load_map(path, {"biome_terms"})
    # Mapped (so the swap guard counts it) but carrying nothing to write.
    assert values["b"] == {}


def test_scalar_columns_are_unchanged_without_list(tmp_path):
    path = write_map(tmp_path, "gcf_id\tdom_ecosystem_l3\nc\tMarine\n")
    _, values = load_map(path)
    assert values["c"] == {"dom_ecosystem_l3": "Marine"}


def test_list_naming_a_missing_column_is_refused(tmp_path):
    path = write_map(tmp_path, "gcf_id\tbiome_terms\n")
    with pytest.raises(SystemExit, match="biome_trems"):
        load_map(path, {"biome_trems"})


def test_options_may_precede_positionals():
    args = parse_args(["--type", "biome_terms:keyword", "--list", "biome_terms",
                       "m.tsv", "http://os:9200/", "src", "dst"])
    assert args[:4] == ("m.tsv", "http://os:9200", "src", "dst")
    assert args[4] == {"biome_terms": "keyword"}
    assert args[5] == {"biome_terms"}


def test_json_column_is_written_as_the_object_it_encodes(tmp_path):
    """Written as a string it would still index (enabled:false) and break every reader."""
    path = write_map(tmp_path, 'gcf_id\tproduct_type_distribution\n'
                               'a\t{"NRPS": 60.0, "T1PKS": 40.0}\n'
                               'b\t{}\n')
    _, values = load_map(path, jsons={"product_type_distribution"})
    assert values["a"] == {"product_type_distribution": {"NRPS": 60.0, "T1PKS": 40.0}}
    # '{}' stays an empty object, as the corpus writes it -- not a removed field.
    assert values["b"] == {"product_type_distribution": {}}


def test_the_result_window_survives_the_copy():
    """Without it the patched index serves /gcfs only to offset 10,000, silently."""
    src = {"number_of_shards": "1", "max_result_window": "1250000",
           "uuid": "x", "creation_date": "1", "provided_name": "gcf_browse_v1"}
    assert carried_settings(src) == {"number_of_shards": "1", "max_result_window": "1250000"}


def test_an_index_on_the_default_window_stays_on_it():
    assert carried_settings({"number_of_shards": "1"}) == {"number_of_shards": "1"}


def test_other_browse_indexes_name_their_id_field_and_alias(tmp_path):
    """sample_browse is keyed on sample_id."""
    args = parse_args(["m.tsv", "http://os:9200", "src", "dst",
                       "--id-field", "sample_id", "--alias", "sample_browse"])
    assert args[9:] == ("sample_id", "sample_browse")
    assert parse_args(["m.tsv", "http://os:9200", "src", "dst"])[9:] == ("gcf_id", "gcf_browse")
    path = write_map(tmp_path, "sample_id\tcheckm_tool\ns1\tCheckM2\n")
    _, values = load_map(path, id_field="sample_id")
    assert values == {"s1": {"checkm_tool": "CheckM2"}}
