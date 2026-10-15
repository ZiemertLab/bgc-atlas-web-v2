from scripts.populator.adapters._antismash_emit import emit_antismash
from scripts.populator.adapters.antismash_json import Region


def _region():
    return Region(contig="c1", region_number=1, start_pos=0, end_pos=100,
                  core_start_pos=None, core_end_pos=None, product=["x"],
                  product_category=[], is_complete=True, num_cds_features=1,
                  taxon=None)


def _emit(**kw):
    base = dict(source="src", source_type="third_party",
                source_description="desc", nk="src|s1", name="s1",
                base_name="s1", file_path="/x", regions=[_region()],
                run_name="s1")
    base.update(kw)
    return list(emit_antismash(**base))


def test_default_assembly_source_type_is_metagenome():
    recs = _emit()
    asm = next(r for r in recs if r.table == "assemblies")
    assert asm.fields["source_type"] == "metagenome"


def test_assembly_source_type_override():
    recs = _emit(assembly_source_type="isolate")
    asm = next(r for r in recs if r.table == "assemblies")
    assert asm.fields["source_type"] == "isolate"


def test_no_taxonomy_by_default():
    recs = _emit()
    assert not any(r.table == "taxonomies" for r in recs)
    bgcs = [r for r in recs if r.table == "bgcs"]
    assert bgcs
    assert all("taxonomy_id" not in r.refs for r in bgcs)


def test_taxonomy_emits_record_and_refs():
    lineage = "d__Bacteria;p__Bacillota;g__Bacillus"
    fields = {"gtdb_lineage": lineage, "domain": "d__Bacteria",
              "phylum": "p__Bacillota", "genus": "g__Bacillus",
              "source": "gtdb", "rank_depth": 3, "is_partial": True}
    recs = _emit(taxonomy_lineage=lineage, taxonomy_fields=fields)
    taxa = [r for r in recs if r.table == "taxonomies"]
    assert len(taxa) == 1
    assert taxa[0].natural_key == lineage
    assert taxa[0].fields["genus"] == "g__Bacillus"
    bgcs = [r for r in recs if r.table == "bgcs"]
    assert bgcs
    # Taxonomy v2: the lineage is a sibling bgc_taxonomy Record, not a ref on bgcs.
    assert all("taxonomy_id" not in r.refs for r in bgcs)
    bt = [r for r in recs if r.table == "bgc_taxonomy"]
    assert len(bt) == len(bgcs)
    assert {r.natural_key for r in bt} == {r.natural_key for r in bgcs}
    assert all(r.refs["taxonomy_id"] == ("taxonomies", taxa[0].natural_key) for r in bt)
    assert all(r.refs["bgc_id"][0] == "bgcs" for r in bt)
    # rank_depth 3 (d/p/g present)
    assert all(r.fields["rank"] == "class" for r in bt)
    assert all(r.fields["method"] == "mmseqs_v1" for r in bt)


def test_no_taxonomy_lineage_emits_no_bgc_taxonomy():
    recs = _emit()
    assert not any(r.table == "bgc_taxonomy" for r in recs)


def test_taxonomy_fields_default_to_lineage_only():
    lineage = "d__Bacteria"
    recs = _emit(taxonomy_lineage=lineage)
    tax = next(r for r in recs if r.table == "taxonomies")
    assert tax.fields["gtdb_lineage"] == lineage


def test_bgc_anchor_from_map():
    from scripts.populator.adapters._antismash_emit import bgc_records
    regs = [_region()]  # contig="c1", region_number=1
    recs = list(bgc_records("base", regs, "asm", "an", "/x",
                            anchor_map={("c1", 1): "r5c1"}))
    bgc = next(r for r in recs if r.table == "bgcs")
    assert bgc.fields["anchor"] == "r5c1"


def test_bgc_anchor_none_when_absent():
    from scripts.populator.adapters._antismash_emit import bgc_records
    recs = list(bgc_records("base", [_region()], "asm", "an", "/x", anchor_map={}))
    bgc = next(r for r in recs if r.table == "bgcs")
    assert bgc.fields["anchor"] is None
