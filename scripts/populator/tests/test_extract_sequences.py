"""The extractor's per-source base_name must reproduce each adapter's bgc-filename
prefix, or FASTA/GBK headers won't join to bgcs.id."""
from pathlib import Path
from scripts.populator.tools.extract_sequences import base_name_for


def test_gtdb_base_name_keeps_trailing_version():
    # archive_stem would strip the ".1"; gtdb uses the dir name.
    assert base_name_for("gtdb", Path("/x/gtdb_gbks/GB_GCA_000003955.1")) == "GB_GCA_000003955.1"
    assert base_name_for("gtdb", Path("/x/RS_GCF_000007325.1")) == "RS_GCF_000007325.1"


def test_metalog_mgnify_base_name_is_archive_stem():
    assert base_name_for("metalog", Path("/x/5O_Y1.1.tar.gz")) == "5O_Y1.1"
    assert base_name_for("metalog", Path("/x/SAMN10351066.tar.gz")) == "SAMN10351066"
    assert base_name_for("mgnify", Path("/x/MGYA00131981.tar.gz")) == "MGYA00131981"


def test_custom_base_name_strips_dataset_suffix():
    # custom uses derive_alias(archive_stem(...)) via its alias_fn
    assert base_name_for("custom", Path("/x/Foo_S1-contigs.tar.gz")) == "Foo_S1"
