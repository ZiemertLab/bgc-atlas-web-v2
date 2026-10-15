import pathlib

from scripts.populator.tools.gtdb_dump_load import iter_gtdb_dump, load_gtdb_dump

FIX = pathlib.Path(__file__).parent / "fixtures" / "gtdb_dump_small.tsv"


def test_groups_by_external_id():
    d = load_gtdb_dump(FIX)
    assert set(d) == {"RS_GCF_000001.1", "GB_GCA_000002.1", "RS_GCF_000003.1"}


def test_real_values_kept():
    d = load_gtdb_dump(FIX)
    assert d["RS_GCF_000001.1"]["checkm_completeness"] == "99.4"
    assert d["RS_GCF_000001.1"]["ncbi_biosample"] == "SAMN00000001"
    assert d["GB_GCA_000002.1"]["genome_size"] == "5000000"
    assert d["GB_GCA_000002.1"]["gtdb_taxonomy"] == "d__Bacteria;p__Bacillota"


def test_none_and_empty_dropped():
    d = load_gtdb_dump(FIX)
    # literal "none"/"None" and blank values are cleaned out (matches live _clean)
    assert "ncbi_isolation_source" not in d["RS_GCF_000001.1"]
    assert "gc_percentage" not in d["GB_GCA_000002.1"]


def test_all_empty_genome_yields_empty_dict():
    d = load_gtdb_dump(FIX)
    # every value was "none" -> still present as a genome, but with no fields
    assert d["RS_GCF_000003.1"] == {}


def test_iter_yields_each_genome_once():
    ids = [ext for ext, _ in iter_gtdb_dump(FIX)]
    assert ids == ["RS_GCF_000001.1", "GB_GCA_000002.1", "RS_GCF_000003.1"]
