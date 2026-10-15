import io
import pathlib
import tarfile

import pytest

from scripts.populator.adapters import mag
from scripts.populator.ids import entity_id, scoped

FIX = pathlib.Path(__file__).parent / "fixtures"


def _make_tar(tar_path, members):
    with tarfile.open(tar_path, "w:gz") as tf:
        for arcname, text in members.items():
            data = text.encode("utf-8")
            info = tarfile.TarInfo(name=arcname)
            info.size = len(data)
            tf.addfile(info, io.BytesIO(data))


def _owc_tar(tmp_path, genome="OWC_9999", regions_js="var x = 1;"):
    """A MAG-collection genome tarball mirroring the real layout. The default
    ``regions_js`` has no ``recordData``; pass a real one to exercise anchors."""
    one = (FIX / "region_gbk_one.gbk").read_text()
    tar_path = tmp_path / f"{genome}.tar.gz"
    _make_tar(tar_path, {
        f"{genome}/{genome}/ctg1.region001.gbk": one,
        f"{genome}/{genome}/ctg2.region001.gbk": one,
        f"{genome}/{genome}/{genome}.gbk": one,
        f"{genome}/{genome}/index.html": "<html></html>",
        f"{genome}/{genome}/regions.js": regions_js,
    })
    return tar_path


def test_data_source_is_the_collection(tmp_path):
    tar = _owc_tar(tmp_path)
    recs = list(mag.emit_mag_tarball(str(tar), "owc"))
    ds = next(r for r in recs if r.table == "data_sources")
    assert ds.fields["name"] == "OWC"
    assert ds.fields["source_type"] == mag.SOURCE_TYPE
    assert ds.fields["description"] == "Old Woman Creek wetland MAGs"


def test_assembly_source_type_is_mag(tmp_path):
    tar = _owc_tar(tmp_path)
    recs = list(mag.emit_mag_tarball(str(tar), "owc"))
    asm = next(r for r in recs if r.table == "assemblies")
    assert asm.fields["source_type"] == "MAG"


def test_assembly_accession_is_genome_id(tmp_path):
    tar = _owc_tar(tmp_path)
    recs = list(mag.emit_mag_tarball(str(tar), "owc"))
    asm = next(r for r in recs if r.table == "assemblies")
    assert asm.fields["accession"] == scoped("owc", "OWC_9999")
    assert asm.fields["name"] == "OWC_9999"


def test_sample_external_id_and_accession(tmp_path):
    tar = _owc_tar(tmp_path)
    recs = list(mag.emit_mag_tarball(str(tar), "owc"))
    samp = next(r for r in recs if r.table == "samples")
    assert samp.fields["external_id"] == scoped("owc", "OWC_9999")
    assert samp.fields["accession"] == "OWC_9999"
    assert samp.fields["name"] == "OWC_9999"


def test_emits_full_genome_record_set(tmp_path):
    tar = _owc_tar(tmp_path)
    recs = list(mag.emit_mag_tarball(str(tar), "owc"))
    from collections import Counter
    counts = Counter(r.table for r in recs)
    assert counts == {
        "data_sources": 1,
        "samples": 1,
        "assemblies": 1,
        "analyses": 1,
        "antismash_runs": 1,
        "sample_assemblies": 1,
        "sample_analyses": 1,
        "assembly_analyses": 1,
        "bgcs": 2,
    }


def test_antismash_run_record_present(tmp_path):
    tar = _owc_tar(tmp_path)
    recs = list(mag.emit_mag_tarball(str(tar), "owc"))
    run = next(r for r in recs if r.table == "antismash_runs")
    assert run.fields["num_bgcs"] == 2
    assert run.fields["status"] == "completed"


def test_bgc_filenames_use_genome_contig_region_convention(tmp_path):
    tar = _owc_tar(tmp_path)
    recs = list(mag.emit_mag_tarball(str(tar), "owc"))
    fns = sorted(r.fields["filename"] for r in recs if r.table == "bgcs")
    assert fns == ["OWC_9999_ctg1.region001", "OWC_9999_ctg2.region001"]


def test_taxonomy_absent_and_gcf_unset(tmp_path):
    tar = _owc_tar(tmp_path)
    recs = list(mag.emit_mag_tarball(str(tar), "owc"))
    assert not any(r.table == "taxonomies" for r in recs)
    assert not any(r.table == "studies" for r in recs)
    for b in (r for r in recs if r.table == "bgcs"):
        assert "taxonomy_id" not in b.refs
        assert "gcf" not in b.refs and "gcf_id" not in b.refs
        assert b.fields.get("gcf_id") is None


def test_natural_keys_are_collection_scoped(tmp_path):
    tar = _owc_tar(tmp_path)
    recs = list(mag.emit_mag_tarball(str(tar), "owc"))
    nk = scoped("owc", "OWC_9999")
    samp = next(r for r in recs if r.table == "samples")
    asm = next(r for r in recs if r.table == "assemblies")
    ana = next(r for r in recs if r.table == "analyses")
    assert samp.natural_key == asm.natural_key == ana.natural_key == nk
    assert entity_id("samples", samp.natural_key) == entity_id("samples", nk)
    assert entity_id("assemblies", asm.natural_key) == entity_id("assemblies", nk)
    assert entity_id("analyses", ana.natural_key) == entity_id("analyses", nk)


def test_genome_present_in_two_catalogs_is_two_identities(tmp_path):
    tar = _owc_tar(tmp_path, genome="OWC_9999")
    owc = next(r for r in mag.emit_mag_tarball(str(tar), "owc")
               if r.table == "assemblies")
    gem = next(r for r in mag.emit_mag_tarball(str(tar), "gem")
               if r.table == "assemblies")
    assert owc.natural_key != gem.natural_key
    assert entity_id("assemblies", owc.natural_key) != \
        entity_id("assemblies", gem.natural_key)


def test_unknown_collection_raises(tmp_path):
    tar = _owc_tar(tmp_path)
    with pytest.raises(Exception):
        list(mag.emit_mag_tarball(str(tar), "not-a-catalog"))


def test_empty_regions_emits_genome_minus_bgcs(tmp_path):
    # zero region GBKs -> still the genome's entities and a run with 0 bgcs
    one = (FIX / "region_gbk_one.gbk").read_text()
    tar = tmp_path / "OWC_8888.tar.gz"
    _make_tar(tar, {
        "OWC_8888/OWC_8888/OWC_8888.gbk": one,
        "OWC_8888/OWC_8888/index.html": "<html></html>",
    })
    recs = list(mag.emit_mag_tarball(str(tar), "owc"))
    from collections import Counter
    counts = Counter(r.table for r in recs)
    assert counts == {
        "data_sources": 1,
        "samples": 1,
        "assemblies": 1,
        "analyses": 1,
        "antismash_runs": 1,
        "sample_assemblies": 1,
        "sample_analyses": 1,
        "assembly_analyses": 1,
    }
    assert not any(r.table == "bgcs" for r in recs)
    run = next(r for r in recs if r.table == "antismash_runs")
    assert run.fields["num_bgcs"] == 0
    assert run.fields["taxon"] is None


def test_collections_map_has_eight_catalogs(tmp_path):
    assert set(mag.COLLECTIONS) == {
        "gem", "spire", "smag", "mfd-lr", "mfd-sr", "owc", "tpmc", "omd-v2"}
    for slug, (name, desc, url) in mag.COLLECTIONS.items():
        assert isinstance(name, str) and name
        assert isinstance(desc, str)
        assert isinstance(url, str)
    assert mag.COLLECTIONS["omd-v2"][0] == "Ocean Microbiomics Database v2"


def test_extract_biosample():
    assert mag._extract_biosample("ACIN21-1_SAMN05421555_MAG_00000001") == "SAMN05421555"
    assert mag._extract_biosample("KOBI21-1_SAMD00231442_MAG_00000005") == "SAMD00231442"
    assert mag._extract_biosample("STN_SAMEA2737690_MAG_00000010") == "SAMEA2737690"
    assert mag._extract_biosample("3300029133_10") is None
    assert mag._extract_biosample("") is None


def test_omd_v2_captures_biosample(tmp_path):
    import json
    genome = "ACIN21-1_SAMN05421555_MAG_00000001"
    tar = _owc_tar(tmp_path, genome=genome)
    recs = list(mag.emit_mag_tarball(str(tar), "omd-v2"))
    samp = next(r for r in recs if r.table == "samples")
    assert samp.fields["accession"] == "SAMN05421555"
    assert samp.fields["name"] == genome
    assert samp.fields["external_id"] == scoped("omd-v2", genome)
    assert json.loads(samp.fields["metadata"])["biosample"] == "SAMN05421555"


def test_omd_v2_without_biosample_stays_minimal(tmp_path):
    # ~6% of omd-v2 names carry no SAM accession
    genome = "NOBIOSAMPLE_MAG_00000009"
    tar = _owc_tar(tmp_path, genome=genome)
    recs = list(mag.emit_mag_tarball(str(tar), "omd-v2"))
    samp = next(r for r in recs if r.table == "samples")
    assert samp.fields["accession"] == genome
    assert "metadata" not in samp.fields


def test_non_biosample_collection_does_not_capture(tmp_path):
    # only omd-v2 is in BIOSAMPLE_COLLECTIONS
    genome = "SRR_SAMN05421555rbin.7"
    tar = _owc_tar(tmp_path, genome=genome)
    recs = list(mag.emit_mag_tarball(str(tar), "smag"))
    samp = next(r for r in recs if r.table == "samples")
    assert samp.fields["accession"] == genome
    assert "metadata" not in samp.fields


def test_omd_v2_merges_env_enrichment(tmp_path):
    """Uses a real committed biosample (SAMD00070310, YOSH21-1, Japan:Tohoku)."""
    import json
    genome = "YOSH21-1_SAMD00070310_MAG_00000001"
    tar = _owc_tar(tmp_path, genome=genome)
    samp = next(r for r in mag.emit_mag_tarball(str(tar), "omd-v2")
                if r.table == "samples")
    assert samp.fields["latitude"] == pytest.approx(38.0022)
    assert samp.fields["gold_ecosystem_path"] == "Environmental:Aquatic:Marine:Pelagic"
    assert samp.fields["geographic_location"] == "Japan:Tohoku, A-line"
    assert samp.fields["environment_material"] == "sea water"
    assert samp.fields["accession"] == "SAMD00070310"
    meta = json.loads(samp.fields["metadata"])
    assert meta["biosample"] == "SAMD00070310"
    assert meta["omd"]["dataset"] == "YOSH21-1"


def test_omd_v2_merges_physicochem_enrichment(tmp_path):
    """SAMEA2591108's ENA temperature is blank, so the PANGAEA median (20.4425) fills
    it without nulling the Phase-1 geo columns."""
    import json
    genome = "TOPC_SAMEA2591108_MAG_00000001"
    tar = _owc_tar(tmp_path, genome=genome)
    samp = next(r for r in mag.emit_mag_tarball(str(tar), "omd-v2")
                if r.table == "samples")
    assert samp.fields["salinity"] == pytest.approx(39.4231)
    assert samp.fields["salinity_unit"] == "psu"
    assert samp.fields["nitrate"] == pytest.approx(0.188705)
    assert samp.fields["nitrate_unit"] == "µmol/L"
    assert samp.fields["temperature"] == pytest.approx(20.4425)
    assert samp.fields["latitude"] == pytest.approx(33.9179)
    assert samp.fields["gold_ecosystem_path"] == "Environmental:Aquatic:Marine:Pelagic"
    assert samp.fields["accession"] == "SAMEA2591108"
    meta = json.loads(samp.fields["metadata"])
    assert meta["biosample"] == "SAMEA2591108"
    assert meta["omd"]["dataset"] == "TOPC"
    assert meta["omd_physicochem"]["silicate"] == pytest.approx(0.816)
    assert meta["omd_physicochem"]["chlorophyll"] == pytest.approx(0.01488)


def test_omd_v2_no_physicochem_keeps_phase1_only(tmp_path):
    """SAMD00070310 (YOSH21-1) is a non-Tara OMD sample: Phase-1 env only."""
    import json
    genome = "YOSH21-1_SAMD00070310_MAG_00000001"
    tar = _owc_tar(tmp_path, genome=genome)
    samp = next(r for r in mag.emit_mag_tarball(str(tar), "omd-v2")
                if r.table == "samples")
    assert samp.fields["gold_ecosystem_path"] == "Environmental:Aquatic:Marine:Pelagic"
    assert samp.fields["salinity"] is None
    assert "nitrate" not in samp.fields
    meta = json.loads(samp.fields["metadata"])
    assert "omd_physicochem" not in meta
    assert meta["biosample"] == "SAMD00070310"


def test_omd_v2_unknown_biosample_stays_minimal_capture(tmp_path):
    import json
    genome = "FAKE-DS_SAMN99999999_MAG_00000001"
    tar = _owc_tar(tmp_path, genome=genome)
    samp = next(r for r in mag.emit_mag_tarball(str(tar), "omd-v2")
                if r.table == "samples")
    assert samp.fields["accession"] == "SAMN99999999"
    assert "latitude" not in samp.fields
    assert "gold_ecosystem_path" not in samp.fields
    assert json.loads(samp.fields["metadata"]) == {"biosample": "SAMN99999999"}


def test_mag_bgc_carries_anchor_from_tarball_regions_js(tmp_path):
    """No monkeypatch: the real region_anchor_map reads the tarball's regions.js."""
    genome = "OWC_9999"
    regions_js = (
        "var recordData = [ "
        '{"length": 1000, "seq_id": "ctg1", "regions": [{"idx": 1, "anchor": "r1c1"}]}, '
        '{"length": 1000, "seq_id": "ctg2", "regions": [{"idx": 1, "anchor": "r2c1"}]} '
        "];")
    tar = _owc_tar(tmp_path, genome=genome, regions_js=regions_js)
    bgcs = {r.fields["contig"]: r for r in mag.emit_mag_tarball(str(tar), "owc")
            if r.table == "bgcs"}
    assert bgcs["ctg1"].fields["anchor"] == "r1c1"
    assert bgcs["ctg2"].fields["anchor"] == "r2c1"


def test_mag_bgc_anchor_none_without_recorddata_in_regions_js(tmp_path):
    """The default regions.js has no recordData, so every anchor is None."""
    tar = _owc_tar(tmp_path)
    bgcs = [r for r in mag.emit_mag_tarball(str(tar), "owc") if r.table == "bgcs"]
    assert bgcs and all(r.fields["anchor"] is None for r in bgcs)


def test_gem_attaches_env_enrichment(tmp_path):
    """Uses a real committed genome (2061766007_144: Mammals/Digestive system, HQ)."""
    import json
    genome = "2061766007_144"
    tar = _owc_tar(tmp_path, genome=genome)
    samp = next(r for r in mag.emit_mag_tarball(str(tar), "gem")
                if r.table == "samples")
    assert samp.fields["gold_ecosystem_path"] == "Host-associated:Mammals:Digestive system"
    assert samp.fields["checkm_completeness"] == pytest.approx(94.38)
    assert samp.fields["genome_quality"] == "high"
    assert samp.fields["accession"] == genome
    assert json.loads(samp.fields["metadata"])["gem"]["genome_id"] == genome


def test_gem_unknown_genome_stays_minimal(tmp_path):
    genome = "9999999999_1"
    tar = _owc_tar(tmp_path, genome=genome)
    samp = next(r for r in mag.emit_mag_tarball(str(tar), "gem")
                if r.table == "samples")
    assert "gold_ecosystem_path" not in samp.fields
    assert "checkm_completeness" not in samp.fields
    assert samp.fields["accession"] == genome


def test_gem_genome_qc_reaches_written_tsv(tmp_path):
    tar = _owc_tar(tmp_path, genome="2061766007_144")
    cols, row = _samples_tsv_row(tmp_path, tar, "gem")
    for c in ("checkm_completeness", "checkm_contamination",
              "genome_quality", "genome_size"):
        assert c in cols, c
    assert row["gold_ecosystem_path"] == "Host-associated:Mammals:Digestive system"
    assert row["checkm_completeness"] == "94.38"
    assert row["checkm_contamination"] == "1.31"
    assert row["genome_quality"] == "high"
    assert row["genome_size"] == "1398911"


def test_spire_attaches_env_enrichment(tmp_path):
    """Uses a real committed genome: spire_mag_00000001 -> SAMEA104408696 (Baltic Sea).
    SPIRE keeps the genome id as accession, unlike omd-v2."""
    import json
    genome = "spire_mag_00000001"
    tar = _owc_tar(tmp_path, genome=genome)
    samp = next(r for r in mag.emit_mag_tarball(str(tar), "spire")
                if r.table == "samples")
    assert samp.fields["latitude"] == pytest.approx(57.32277778)
    assert samp.fields["longitude"] == pytest.approx(20.06055556)
    assert samp.fields["location_resolution"] == "point"
    assert samp.fields["geographic_location"] == "Baltic Sea"
    assert samp.fields["accession"] == genome
    assert samp.fields["gold_ecosystem_path"] == "Environmental:Aquatic:Marine"
    meta = json.loads(samp.fields["metadata"])
    assert meta["spire"]["biosample"] == "SAMEA104408696"
    assert "aquatic:marine" in meta["microntology"]


def test_spire_unmapped_genome_stays_minimal(tmp_path):
    # e.g. a specI cluster or a no-biosample MAG
    genome = "specI_v4_99999999"
    tar = _owc_tar(tmp_path, genome=genome)
    samp = next(r for r in mag.emit_mag_tarball(str(tar), "spire")
                if r.table == "samples")
    assert samp.fields["accession"] == genome
    assert "latitude" not in samp.fields
    assert "gold_ecosystem_path" not in samp.fields
    assert "metadata" not in samp.fields


def test_smag_attaches_env_enrichment(tmp_path):
    """Uses a real committed MAG: BL1bin.1 (sample BL1bin, Forest / Belgium)."""
    import json
    genome = "BL1bin.1"
    tar = _owc_tar(tmp_path, genome=genome)
    samp = next(r for r in mag.emit_mag_tarball(str(tar), "smag")
                if r.table == "samples")
    assert samp.fields["gold_ecosystem_path"] == "Environmental:Terrestrial:Soil:Forest soil"
    assert samp.fields["latitude"] == pytest.approx(50.86)
    assert samp.fields["geographic_location"] == "Belgium"
    assert samp.fields["checkm_completeness"] == pytest.approx(66.73)
    assert samp.fields["genome_quality"] == "medium"
    assert samp.fields["accession"] == genome
    assert json.loads(samp.fields["metadata"])["smag"]["biosample"] == "SAMN35729406"


def test_smag_qc_only_genome_still_gets_soil_gold(tmp_path):
    # DRR101463bin.1: absent from the geo table but in QC; all SMAG genomes are soil.
    genome = "DRR101463bin.1"
    tar = _owc_tar(tmp_path, genome=genome)
    samp = next(r for r in mag.emit_mag_tarball(str(tar), "smag")
                if r.table == "samples")
    assert samp.fields["gold_ecosystem_path"] == "Environmental:Terrestrial:Soil"
    assert samp.fields["checkm_completeness"] is not None
    assert "latitude" not in samp.fields
    assert samp.fields["accession"] == genome


def test_smag_unknown_genome_stays_minimal(tmp_path):
    genome = "9999999999bin.9"
    tar = _owc_tar(tmp_path, genome=genome)
    samp = next(r for r in mag.emit_mag_tarball(str(tar), "smag")
                if r.table == "samples")
    assert "gold_ecosystem_path" not in samp.fields
    assert "checkm_completeness" not in samp.fields
    assert "metadata" not in samp.fields
    assert samp.fields["accession"] == genome


def test_tpmc_attaches_env_enrichment(tmp_path):
    """Uses a real committed sample with salinity: 2020_BBH1-W1 (River)."""
    import json
    genome = "2020_BBH1-W1_bin.3"
    tar = _owc_tar(tmp_path, genome=genome)
    samp = next(r for r in mag.emit_mag_tarball(str(tar), "tpmc")
                if r.table == "samples")
    assert samp.fields["gold_ecosystem_path"] == "Environmental:Aquatic:Freshwater:River"
    assert samp.fields["salinity"] == pytest.approx(0.35)
    assert samp.fields["salinity_unit"] == "psu"
    assert samp.fields["latitude"] == pytest.approx(38.108773)
    assert samp.fields["geographic_location"] == "Qilian Mountains"
    assert samp.fields["accession"] == genome
    assert json.loads(samp.fields["metadata"])["tpmc"]["biosample"] == "SAMC2804618"


def test_tpmc_source_url_points_at_portal(tmp_path):
    tar = _owc_tar(tmp_path, genome="2019_TBCBL-01_bin.1")
    ds = next(r for r in mag.emit_mag_tarball(str(tar), "tpmc")
              if r.table == "data_sources")
    assert ds.fields["source_url"] == mag.tpmc_metadata.TPMC_SOURCE_URL
    assert mag.COLLECTIONS["tpmc"][2] == mag.tpmc_metadata.TPMC_SOURCE_URL


def test_tpmc_unknown_genome_stays_minimal(tmp_path):
    genome = "9999_NOPE_bin.9"
    tar = _owc_tar(tmp_path, genome=genome)
    samp = next(r for r in mag.emit_mag_tarball(str(tar), "tpmc")
                if r.table == "samples")
    assert "gold_ecosystem_path" not in samp.fields
    assert "salinity" not in samp.fields
    assert "metadata" not in samp.fields
    assert samp.fields["accession"] == genome


def test_mfd_sr_attaches_env_enrichment(tmp_path):
    """Barcode resolved from the genome id (``MFD00001_ilm_asm_bin4`` -> ``MFD00001``)."""
    genome = "MFD00001_ilm_asm_bin4"
    tar = _owc_tar(tmp_path, genome=genome)
    samp = next(r for r in mag.emit_mag_tarball(str(tar), "mfd-sr")
                if r.table == "samples")
    assert samp.fields["latitude"] == pytest.approx(55.6771)
    assert samp.fields["gold_ecosystem_path"] == "Environmental:Terrestrial:Soil:Forest soil"
    assert samp.fields["geographic_location"] == "Denmark"
    # enrichment does NOT overwrite the accession (stays the genome id)
    assert samp.fields["accession"] == genome


def test_mfd_lr_attaches_env_enrichment_via_ena_map(tmp_path):
    """Barcode resolved via the committed ENA map (``GCA_963695025`` -> ``MFD10113``)."""
    genome = "GCA_963695025"
    tar = _owc_tar(tmp_path, genome=genome)
    samp = next(r for r in mag.emit_mag_tarball(str(tar), "mfd-lr")
                if r.table == "samples")
    assert samp.fields["geographic_location"] == "Denmark"
    assert samp.fields["gold_ecosystem_path"]


def test_mfd_sr_unknown_bin_stays_minimal(tmp_path):
    genome = "unknown_ilm_asm_bin3"
    tar = _owc_tar(tmp_path, genome=genome)
    samp = next(r for r in mag.emit_mag_tarball(str(tar), "mfd-sr")
                if r.table == "samples")
    assert "latitude" not in samp.fields
    assert "gold_ecosystem_path" not in samp.fields
    assert samp.fields["accession"] == genome


def test_mfd_sr_coordless_barcode_enriches_without_coords(tmp_path):
    # MFD04008 has no coords in MFD
    genome = "MFD04008_ilm_asm_bin1"
    tar = _owc_tar(tmp_path, genome=genome)
    samp = next(r for r in mag.emit_mag_tarball(str(tar), "mfd-sr")
                if r.table == "samples")
    assert samp.fields["latitude"] is None
    assert samp.fields["gold_ecosystem_path"]


def test_owc_collection_gets_uniform_wetland_enrichment(tmp_path):
    # OWC is single-site: the opaque OWC_NNNN accession carries no per-MAG signal.
    tar = _owc_tar(tmp_path)
    samp = next(r for r in mag.emit_mag_tarball(str(tar), "owc")
                if r.table == "samples")
    assert samp.fields["gold_ecosystem_path"] == "Environmental:Terrestrial:Soil:Wetlands"
    assert samp.fields["latitude"] == 41.38 and samp.fields["longitude"] == -82.51
    assert samp.fields["geographic_location"] == "USA: Ohio"


def _samples_tsv_row(tmp_path, tar, collection):
    """The single samples.tsv row as {column: raw COPY TEXT cell} (NULL == '\\N')."""
    from scripts.populator.core.registry import Registry
    from scripts.populator.core.writer import write_tables
    from scripts.populator.schema import TABLES
    reg = Registry()
    for r in mag.emit_mag_tarball(str(tar), collection):
        reg.add(r)
    write_tables(reg.finalize(), tmp_path, emit_tsv=True)
    cols = list(TABLES["samples"].columns)
    cells = (tmp_path / "samples.tsv").read_text().splitlines()[0].split("\t")
    return cols, dict(zip(cols, cells))


def test_mfd_sr_env_reaches_written_tsv(tmp_path):
    tar = _owc_tar(tmp_path, genome="MFD00001_ilm_asm_bin4")
    cols, row = _samples_tsv_row(tmp_path, tar, "mfd-sr")
    assert "gold_ecosystem_path" in cols and "geolocation_name" in cols
    assert row["gold_ecosystem_path"] == "Environmental:Terrestrial:Soil:Forest soil"
    assert row["geolocation_name"]
    assert row["geographic_location"] == "Denmark"
    assert row["latitude"] == "55.6771"


def test_owc_wetland_metadata_reaches_written_tsv(tmp_path):
    tar = _owc_tar(tmp_path)
    _cols, row = _samples_tsv_row(tmp_path, tar, "owc")
    assert row["gold_ecosystem_path"] == "Environmental:Terrestrial:Soil:Wetlands"
    assert row["latitude"] == "41.38"
    assert row["geolocation_name"] == r"\N"


def test_mfd_sr_emits_study_and_study_samples(tmp_path):
    genome = "MFD00001_ilm_asm_bin4"
    tar = _owc_tar(tmp_path, genome=genome)
    recs = list(mag.emit_mag_tarball(str(tar), "mfd-sr"))
    study = next(r for r in recs if r.table == "studies")
    assert study.natural_key == "PRJNA1071982"
    assert study.fields["accession"] == "PRJNA1071982"
    assert study.fields["study_name"] == "Microflora Danica (short-read)"
    assert study.fields["data_source_ids"] == [
        str(entity_id("data_sources", "Microflora Danica (short-read)"))]
    link = next(r for r in recs if r.table == "study_samples")
    assert link.refs["study_id"] == ("studies", "PRJNA1071982")
    assert link.refs["sample_id"] == ("samples", scoped("mfd-sr", genome))


def test_mfd_sr_data_source_points_at_nature(tmp_path):
    tar = _owc_tar(tmp_path, genome="MFD00001_ilm_asm_bin4")
    ds = next(r for r in mag.emit_mag_tarball(str(tar), "mfd-sr")
              if r.table == "data_sources")
    assert ds.fields["source_url"] == mag.mfd_metadata.MFD_SOURCE_URL
    assert mag.COLLECTIONS["mfd-sr"][2] == mag.mfd_metadata.MFD_SOURCE_URL
    assert mag.COLLECTIONS["mfd-lr"][2] == mag.mfd_metadata.MFD_SOURCE_URL


def test_mfd_lr_emits_shared_prjeb_study(tmp_path):
    tar = _owc_tar(tmp_path, genome="GCA_963695025")
    recs = list(mag.emit_mag_tarball(str(tar), "mfd-lr"))
    study = next(r for r in recs if r.table == "studies")
    assert study.natural_key == "PRJEB58634"
    assert study.fields["study_name"] == "Microflora Danica (long-read)"
    assert study.fields["secondary_accession"] == "ERP143702"


def test_mfd_sr_unresolved_genome_still_belongs_to_study(tmp_path):
    # membership is by data source, not enrichment
    genome = "unknown_ilm_asm_bin3"
    tar = _owc_tar(tmp_path, genome=genome)
    recs = list(mag.emit_mag_tarball(str(tar), "mfd-sr"))
    study = next(r for r in recs if r.table == "studies")
    assert study.natural_key == "PRJNA1071982"
    link = next(r for r in recs if r.table == "study_samples")
    assert link.refs["sample_id"] == ("samples", scoped("mfd-sr", genome))


# omd-v2's `_GENO_` entries are reference genomes, not MAGs, and the type cannot be
# derived from the name, so the caller supplies it.

def _omd_geno_tar(tmp_path, genome="RSGB23-1_GCF-002895405-V1_GENO_10000001"):
    return _owc_tar(tmp_path, genome=genome)


def test_genome_source_types_override_wins(tmp_path):
    tar = _omd_geno_tar(tmp_path)
    genome = "RSGB23-1_GCF-002895405-V1_GENO_10000001"
    recs = list(mag.emit_mag_tarball(str(tar), "omd-v2",
                                     genome_source_types={genome: "isolate"}))
    asm = next(r for r in recs if r.table == "assemblies")
    assert asm.fields["source_type"] == "isolate"


def test_override_can_also_say_sag(tmp_path):
    genome = "RSGB23-1_GCA-000353875-V1_GENO_10000001"
    tar = _omd_geno_tar(tmp_path, genome=genome)
    recs = list(mag.emit_mag_tarball(str(tar), "omd-v2",
                                     genome_source_types={genome: "SAG"}))
    asm = next(r for r in recs if r.table == "assemblies")
    assert asm.fields["source_type"] == "SAG"


def test_genome_absent_from_the_map_keeps_the_collection_default(tmp_path):
    """Unknown or IMG-oid genomes keep the catalog default rather than a guess."""
    tar = _omd_geno_tar(tmp_path)
    recs = list(mag.emit_mag_tarball(str(tar), "omd-v2",
                                     genome_source_types={"someone-else": "isolate"}))
    asm = next(r for r in recs if r.table == "assemblies")
    assert asm.fields["source_type"] == mag.GENOME_SOURCE_TYPE


def test_no_map_at_all_is_the_old_behaviour(tmp_path):
    tar = _owc_tar(tmp_path)
    recs = list(mag.emit_mag_tarball(str(tar), "owc"))
    asm = next(r for r in recs if r.table == "assemblies")
    assert asm.fields["source_type"] == "MAG"


def test_override_is_rejected_if_the_db_would_reject_it(tmp_path):
    """assemblies.source_type has a CHECK constraint; fail before the COPY."""
    genome = "RSGB23-1_GCF-002895405-V1_GENO_10000001"
    tar = _omd_geno_tar(tmp_path, genome=genome)
    with pytest.raises(ValueError, match="source_type"):
        list(mag.emit_mag_tarball(str(tar), "omd-v2",
                                  genome_source_types={genome: "reference"}))


def test_override_does_not_disturb_the_other_records(tmp_path):
    genome = "RSGB23-1_GCF-002895405-V1_GENO_10000001"
    tar = _omd_geno_tar(tmp_path, genome=genome)
    plain = list(mag.emit_mag_tarball(str(tar), "omd-v2"))
    typed = list(mag.emit_mag_tarball(str(tar), "omd-v2",
                                      genome_source_types={genome: "isolate"}))
    assert [r.table for r in plain] == [r.table for r in typed]
    assert [r.natural_key for r in plain] == [r.natural_key for r in typed]


# SPIRE ships proGenomes isolate reference genomes (`specI_v4_*`) among its MAGs.

def _spire_tar(tmp_path, monkeypatch, genome):
    monkeypatch.setattr(mag.spire_metadata, "enrichment_for", lambda g: None)
    monkeypatch.setattr(mag.spire_metadata, "ecosystem_for", lambda g: None)
    return _owc_tar(tmp_path, genome=genome)


def test_spire_speci_genome_is_an_isolate(tmp_path, monkeypatch):
    tar = _spire_tar(tmp_path, monkeypatch, "specI_v4_00042_GCA-000012345.1")
    recs = list(mag.emit_mag_tarball(str(tar), "spire"))
    asm = next(r for r in recs if r.table == "assemblies")
    assert asm.fields["source_type"] == "isolate"


def test_spire_mag_stays_a_mag(tmp_path, monkeypatch):
    tar = _spire_tar(tmp_path, monkeypatch, "spire_mag_02412046")
    recs = list(mag.emit_mag_tarball(str(tar), "spire"))
    asm = next(r for r in recs if r.table == "assemblies")
    assert asm.fields["source_type"] == "MAG"


def test_speci_prefix_only_counts_in_spire(tmp_path):
    tar = _owc_tar(tmp_path, genome="specI_v4_00042")
    recs = list(mag.emit_mag_tarball(str(tar), "owc"))
    asm = next(r for r in recs if r.table == "assemblies")
    assert asm.fields["source_type"] == "MAG"


def test_speci_matches_the_live_rule_literally():
    """The rule retyped `external_id LIKE 'spire|specI\\_v4\\_%'`: a literal prefix, case-sensitive."""
    assert mag.default_genome_source_type("spire", "specI_v4_1") == "isolate"
    assert mag.default_genome_source_type("spire", "specIxv4_1") == "MAG"
    assert mag.default_genome_source_type("spire", "speci_v4_1") == "MAG"
    assert mag.default_genome_source_type("spire", "specI_v4") == "MAG"

