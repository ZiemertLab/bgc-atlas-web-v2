"""End-to-end test for the consolidated GTDB enrichment sidecar: build it from tiny
dump/geo/biosample inputs and check the Tier 1+2+3 precedence the populator will apply."""
import sys

from scripts.populator.tools import build_gtdb_enrichment_sidecar as B
from scripts.populator.adapters.gtdb_metadata import load_gtdb_enrichment

_DUMP = """sample_id\texternal_id\tkey\tvalue
u1\tACC1\tcheckm_completeness\t99
u1\tACC1\tncbi_biosample\tSAMTEST
u2\tACC2\tgenome_size\t5000
"""

_GEO = "ACC1\tGermany\t10 N 20 E\n"   # ACC2 absent from geo

_XML = """<?xml version="1.0" ?>
<BioSampleSet>
  <BioSample accession="SAMTEST">
    <Ids><Id db="BioSample" is_primary="1">SAMTEST</Id></Ids>
    <Attributes>
      <Attribute harmonized_name="env_broad_scale">soil biome</Attribute>
      <Attribute harmonized_name="collection_date">2015-06-01</Attribute>
      <Attribute harmonized_name="geo_loc_name">France</Attribute>
      <Attribute harmonized_name="lat_lon">50 N 60 E</Attribute>
      <Attribute harmonized_name="host">Homo sapiens</Attribute>
      <Attribute harmonized_name="isolation_source">dirt</Attribute>
    </Attributes>
  </BioSample>
</BioSampleSet>
"""


_BP = "ACC1\tPRJNATEST\n"   # ACC2 has no bioproject

_BP_XML = """<?xml version="1.0" ?>
<RecordSet>
  <DocumentSummary uid="1">
    <Project>
      <ProjectID><ArchiveID accession="PRJNATEST"/></ProjectID>
      <ProjectDescr><Title>Test Study</Title></ProjectDescr>
    </Project>
  </DocumentSummary>
</RecordSet>
"""


def _build(tmp_path):
    dump = tmp_path / "dump.tsv"; dump.write_text(_DUMP)
    geo = tmp_path / "geo.tsv"; geo.write_text(_GEO)
    cache = tmp_path / "cache"; cache.mkdir()
    (cache / "batch_00000.xml").write_text(_XML)
    bp = tmp_path / "bp.tsv"; bp.write_text(_BP)
    bpcache = tmp_path / "bpcache"; bpcache.mkdir()
    (bpcache / "bp_00000.xml").write_text(_BP_XML)
    out = tmp_path / "sidecar.tsv"
    argv = ["prog", "--dump", str(dump), "--geo", str(geo),
            "--cache-dir", str(cache), "--bioproject", str(bp),
            "--bp-cache-dir", str(bpcache), "--out", str(out)]
    old = sys.argv
    sys.argv = argv
    try:
        assert B.main() == 0
    finally:
        sys.argv = old
    return load_gtdb_enrichment(out)


def test_tier2_geo_wins_tier3_fills_gaps(tmp_path):
    enr = _build(tmp_path)
    sf, md, bp, title = enr["ACC1"]
    # Tier 2 geo wins over the biosample's France / 50,60
    assert sf["geographic_location"] == "Germany"
    assert round(sf["latitude"]) == 10 and round(sf["longitude"]) == 20
    # Tier 3 fills the net-new columns
    assert sf["environment_biome"] == "soil biome"
    assert sf["collection_date"] == "2015-06-01"
    assert sf["host_scientific_name"] == "Homo sapiens"


def test_metadata_is_dump_plus_biosample_extras(tmp_path):
    enr = _build(tmp_path)
    _, md, _, _ = enr["ACC1"]
    assert md["checkm_completeness"] == "99"
    assert md["ncbi_biosample"] == "SAMTEST"
    assert md["biosample_isolation_source"] == "dirt"   # _extras folded in, prefixed


def test_bioproject_and_title(tmp_path):
    enr = _build(tmp_path)
    _, _, bp, title = enr["ACC1"]
    assert bp == "PRJNATEST"
    assert title == "Test Study"


def test_genome_without_geo_or_biosample(tmp_path):
    enr = _build(tmp_path)
    sf, md, bp, title = enr["ACC2"]
    assert sf == {}
    assert md == {"genome_size": "5000"}
    assert bp == "" and title == ""   # ACC2 has no bioproject
