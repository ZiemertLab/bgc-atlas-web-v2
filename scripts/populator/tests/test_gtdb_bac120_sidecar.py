import io
import pytest
from scripts.populator.prep.build_gtdb_bac120_sidecar import project_bac120, SIDECAR_COLUMNS


def _bac120_like(rows_extra_cols=True):
    # a tiny bac120-shaped TSV with the needed columns + decoy extras interleaved
    cols = ["accession", "checkm2_completeness", "ncbi_organism_name",
            "ncbi_isolation_source", "ncbi_lat_lon", "ncbi_country", "gtdb_taxonomy",
            "gtdb_representative", "ncbi_taxonomy", "ncbi_taxid", "ncbi_species_taxid",
            "ncbi_bioproject", "ncbi_submitter", "ncbi_genome_representation",
            "ncbi_taxonomy_unfiltered"]
    header = "\t".join(cols)
    r1 = "\t".join(["RS_GCF_1.1", "99.4", "Escherichia coli", "gut", "32.24 N 119.26 E",
                    "China", "d__Bacteria", "t", "d__Bacteria", "562", "562",
                    "PRJNA1", "JGI", "full", "junk"])
    r2 = "\t".join(["GB_GCA_2.1", "88.0", "Bacillus sp.", "none", "none",
                    "none", "d__Bacteria;p__Bacillota", "f", "d__Bacteria", "1", "1",
                    "PRJNA2", "EMBL", "full", "junk2"])
    return io.StringIO(header + "\n" + r1 + "\n" + r2 + "\n")


def test_projects_only_sidecar_columns_in_order():
    out = io.StringIO()
    n = project_bac120(_bac120_like(), out)
    assert n == 2
    lines = out.getvalue().splitlines()
    assert lines[0].split("\t") == SIDECAR_COLUMNS
    # decoy columns are dropped
    assert "checkm2_completeness" not in lines[0]
    assert "ncbi_taxonomy_unfiltered" not in lines[0]


def test_preserves_values_by_name():
    out = io.StringIO()
    project_bac120(_bac120_like(), out)
    import csv
    rows = list(csv.DictReader(io.StringIO(out.getvalue()), delimiter="\t"))
    assert rows[0]["accession"] == "RS_GCF_1.1"
    assert rows[0]["ncbi_organism_name"] == "Escherichia coli"
    assert rows[0]["ncbi_lat_lon"] == "32.24 N 119.26 E"
    assert rows[0]["ncbi_country"] == "China"
    assert rows[1]["accession"] == "GB_GCA_2.1"
    assert rows[1]["ncbi_lat_lon"] == "none"            # passthrough; parsing happens at load


def test_missing_expected_column_raises():
    bad = io.StringIO("accession\tncbi_organism_name\nRS_GCF_1.1\tE. coli\n")  # missing most cols
    with pytest.raises(ValueError, match="missing expected columns"):
        project_bac120(bad, io.StringIO())
