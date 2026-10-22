import pytest

import io
import json
import urllib.error

from scripts.populator.tools import gcf_scalar_patch
from scripts.populator.tools.gcf_scalar_patch import (
    carried_settings, create_destination, load_map, parse_args, plan_properties,
)


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
    assert args[9:11] == ("sample_id", "sample_browse")
    assert parse_args(["m.tsv", "http://os:9200", "src", "dst"])[9:11] == ("gcf_id", "gcf_browse")
    path = write_map(tmp_path, "sample_id\tcheckm_tool\ns1\tCheckM2\n")
    _, values = load_map(path, id_field="sample_id")
    assert values == {"s1": {"checkm_tool": "CheckM2"}}


def test_dry_run_and_sample_are_off_by_default_and_parsed():
    assert parse_args(["m.tsv", "http://os:9200", "src", "dst"])[11:] == (False, 3, False)
    args = parse_args(["--dry-run", "m.tsv", "http://os:9200", "src", "dst", "--sample", "5",
                       "--resume"])
    assert args[11:] == (True, 5, True)


def test_a_disabled_object_is_stored_but_never_indexed():
    """product_type_member_share is keyed by ~100 antiSMASH
    products; `object` alone would put every key into the dynamic mapping."""
    props, errors = plan_properties({}, ["product_type_member_share"],
                                    {"product_type_member_share": "object-disabled"}, "src")
    assert errors == []
    assert props["product_type_member_share"] == {"type": "object", "enabled": False}


def test_a_new_field_without_a_type_is_refused():
    _, errors = plan_properties({}, ["eco_l3_ge50"], {}, "src")
    assert errors and "eco_l3_ge50" in errors[0]


def test_an_existing_field_is_rewritten_only_under_its_own_mapping():
    src = {"max_pct_l3": {"type": "float"},
           "biome_distribution_l3": {"type": "object", "enabled": False}}
    props, errors = plan_properties(src, ["max_pct_l3", "biome_distribution_l3"],
                                    {"biome_distribution_l3": "object-disabled"}, "src")
    assert errors == [] and props == src
    _, errors = plan_properties(src, ["max_pct_l3"], {"max_pct_l3": "keyword"}, "src")
    assert errors and "contradicts" in errors[0]


POSITIONALS = ["m.tsv", "http://os:9200", "src", "dst"]


@pytest.mark.parametrize("typo", ["--dryrun", "--dry_run", "-n", "--json-field"])
def test_an_unknown_option_is_refused_never_taken_for_a_positional(typo):
    """`--dryrun` must not start a real patch."""
    with pytest.raises(SystemExit) as exit_:
        parse_args([*POSITIONALS, typo])
    assert exit_.value.code == 2


@pytest.mark.parametrize("argv", [POSITIONALS[:3], [*POSITIONALS, "extra"]])
def test_exactly_four_positionals(argv):
    with pytest.raises(SystemExit) as exit_:
        parse_args(argv)
    assert exit_.value.code == 2


def test_an_option_missing_its_value_or_a_bare_type_is_refused():
    with pytest.raises(SystemExit):
        parse_args([*POSITIONALS, "--list"])
    with pytest.raises(SystemExit):
        parse_args([*POSITIONALS, "--type", "eco_l3_ge50"])


def http_error(code, body):
    return urllib.error.HTTPError("http://os/dst", code, "err", {},
                                  io.BytesIO(json.dumps(body).encode()))


def fake_put(monkeypatch, error=None):
    calls = []

    def req(method, path, body=None, **_):
        calls.append((method, path))
        if error is not None:
            raise error
        return {"acknowledged": True}
    monkeypatch.setattr(gcf_scalar_patch, "req", req)
    return calls


EXISTS = {"error": {"type": "resource_already_exists_exception", "reason": "index exists"},
          "status": 400}


def test_a_new_destination_is_created(monkeypatch):
    calls = fake_put(monkeypatch)
    assert create_destination("dst", {}, resume=False) is True
    assert calls == [("PUT", "/dst")]


def test_an_existing_destination_is_refused_without_resume(monkeypatch):
    fake_put(monkeypatch, http_error(400, EXISTS))
    assert create_destination("dst", {}, resume=False) is False


def test_an_existing_destination_is_continued_only_with_resume(monkeypatch):
    fake_put(monkeypatch, http_error(400, EXISTS))
    assert create_destination("dst", {}, resume=True) is True


@pytest.mark.parametrize("resume", [False, True])
def test_any_other_400_aborts_even_with_resume(monkeypatch, resume):
    """auto_create_index is on: carrying on to _bulk would build dst on a guessed mapping."""
    fake_put(monkeypatch, http_error(400, {"error": {"type": "mapper_parsing_exception"},
                                           "status": 400}))
    assert create_destination("dst", {}, resume=resume) is False


def test_a_400_is_not_retried(monkeypatch):
    attempts = []

    def urlopen(*_, **__):
        attempts.append(1)
        raise http_error(400, EXISTS)
    monkeypatch.setattr(gcf_scalar_patch.urllib.request, "urlopen", urlopen)
    monkeypatch.setattr(gcf_scalar_patch, "OS", "http://os")
    with pytest.raises(urllib.error.HTTPError):
        gcf_scalar_patch.req("PUT", "/dst", {})
    assert len(attempts) == 1
