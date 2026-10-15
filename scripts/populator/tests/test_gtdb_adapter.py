import pathlib
from scripts.populator.adapters import gtdb

FIX = pathlib.Path(__file__).parent / "fixtures"


def _make_genome_dir(tmp_path, genome="GB_GCA_000003955.1"):
    """A fake gtdb genome dir with 2 per-region GBKs from the region GBK fixture."""
    one = (FIX / "region_gbk_one.gbk").read_text()
    gdir = tmp_path / genome
    gdir.mkdir()
    (gdir / "CM000741.1.region001.gbk").write_text(one)
    (gdir / "CM000741.1.region002.gbk").write_text(one)
    return gdir


def test_runs_tar_dir_sets_tarball_file_path_and_identity(tmp_path):
    """With runs_tar_dir, file_path, the run's natural key and every bgc's
    antismash_run_id ref are the tarball the web viewer extracts, not the gbk dir."""
    genome = "GB_GCA_000003955.1"
    gdir = _make_genome_dir(tmp_path, genome)
    tar_dir = "/data/bgc-atlas/gtdb_genomes_runs_tar"
    recs = list(gtdb.emit_genome_dir(str(gdir), {"metadata": None, "runs_tar_dir": tar_dir}))
    run = next(r for r in recs if r.table == "antismash_runs")
    expected = f"{tar_dir}/{genome}.tar.gz"
    assert run.fields["file_path"] == expected
    assert run.natural_key == expected
    assert run.fields["name"] == genome
    bgcs = [r for r in recs if r.table == "bgcs"]
    assert bgcs and all(
        r.refs["antismash_run_id"] == ("antismash_runs", expected) for r in bgcs
    )


def test_no_runs_tar_dir_keeps_gbk_dir_file_path(tmp_path):
    """Without runs_tar_dir, file_path stays the resolved genome dir."""
    genome = "GB_GCA_000003955.1"
    gdir = _make_genome_dir(tmp_path, genome)
    run = next(r for r in gtdb.emit_genome_dir(str(gdir)) if r.table == "antismash_runs")
    assert run.fields["file_path"] == str(gdir.resolve())
    assert run.natural_key == str(gdir.resolve())


def test_gtdb_bgc_carries_anchor_from_regions_js(tmp_path, monkeypatch):
    """A sparse anchor map: region002, absent from it, stays None."""
    genome = "GB_GCA_000003955.1"
    gdir = _make_genome_dir(tmp_path, genome)      # CM000741.1 region001 + region002
    monkeypatch.setattr(gtdb, "region_anchor_map",
                        lambda p: {("CM000741.1", 1): "r7c1"})
    bgcs = {r.fields["filename"]: r
            for r in gtdb.emit_genome_dir(str(gdir)) if r.table == "bgcs"}
    assert bgcs[f"{genome}_CM000741.1.region001"].fields["anchor"] == "r7c1"
    assert bgcs[f"{genome}_CM000741.1.region002"].fields["anchor"] is None


def test_data_source_is_gtdb_third_party(tmp_path):
    gdir = _make_genome_dir(tmp_path)
    recs = list(gtdb.emit_genome_dir(str(gdir)))
    ds = next(r for r in recs if r.table == "data_sources")
    assert ds.fields["name"] == "GTDB"
    assert ds.fields["source_type"] == "third_party"


def test_assembly_source_type_is_isolate(tmp_path):
    gdir = _make_genome_dir(tmp_path)
    recs = list(gtdb.emit_genome_dir(str(gdir)))
    asm = next(r for r in recs if r.table == "assemblies")
    assert asm.fields["source_type"] == "isolate"


def test_bgc_filenames_use_genome_contig_region_convention(tmp_path):
    genome = "GB_GCA_000003955.1"
    gdir = _make_genome_dir(tmp_path, genome)
    recs = list(gtdb.emit_genome_dir(str(gdir)))
    fns = sorted(r.fields["filename"] for r in recs if r.table == "bgcs")
    assert fns == [f"{genome}_CM000741.1.region001",
                   f"{genome}_CM000741.1.region002"]


def test_emitted_records_finalize_and_validate(tmp_path):
    from scripts.populator.core.registry import Registry
    from scripts.populator.validate import validate_tables
    gdir = _make_genome_dir(tmp_path)
    reg = Registry()
    for r in gtdb.emit_genome_dir(str(gdir)):
        reg.add(r)
    tables = reg.finalize()
    assert tables["bgcs"] and tables["antismash_runs"] and tables["data_sources"]
    report = validate_tables(tables)
    assert not report.hard_errors
    assert not [i for i in report.domain_issues
                if i["table"] == "assemblies"]


def test_region_less_gbk_is_skipped(tmp_path):
    genome = "GB_GCA_000003955.1"
    one = (FIX / "region_gbk_one.gbk").read_text()
    no_region = (FIX / "region_gbk_no_region.gbk").read_text()
    gdir = tmp_path / genome
    gdir.mkdir()
    (gdir / "CM000741.1.region001.gbk").write_text(one)
    (gdir / "CM777777.1.region001.gbk").write_text(no_region)
    fns = sorted(r.fields["filename"] for r in gtdb.emit_genome_dir(str(gdir))
                 if r.table == "bgcs")
    assert fns == [f"{genome}_CM000741.1.region001"]


GTDB_HQ = FIX / "gtdb_hq_small.tsv"


def test_metadata_sets_real_source_type_and_taxonomy(tmp_path):
    genome = "GB_GCA_111111111.1"
    gdir = _make_genome_dir(tmp_path, genome)
    recs = list(gtdb.emit_genome_dir(str(gdir), str(GTDB_HQ)))
    asm = next(r for r in recs if r.table == "assemblies")
    assert asm.fields["source_type"] == "MAG"
    taxa = [r for r in recs if r.table == "taxonomies"]
    assert len(taxa) == 1
    # MAG fixture lineage is partial (empty genus/species)
    assert taxa[0].fields["is_partial"] is True
    # rank columns store the FULL prefixed value (live DB/app contract)
    assert taxa[0].fields["family"] == "f__CSP1-2"
    assert taxa[0].fields["source"] == "gtdb"
    # taxonomies nk == canonical gtdb_lineage carried in fields
    assert taxa[0].natural_key == taxa[0].fields["gtdb_lineage"]
    bgcs = [r for r in recs if r.table == "bgcs"]
    assert bgcs
    # Taxonomy v2: one bgc_taxonomy Record per bgc, whose taxonomy_id ref nk ==
    # the emitted taxonomies record nk (canonical).
    bt = [r for r in recs if r.table == "bgc_taxonomy"]
    assert {r.natural_key for r in bt} == {r.natural_key for r in bgcs}
    assert all(r.refs["taxonomy_id"] == ("taxonomies", taxa[0].natural_key) for r in bt)


def test_metadata_isolate_full_lineage_resolves_no_orphan(tmp_path):
    from scripts.populator.core.registry import Registry
    from scripts.populator.validate import validate_tables
    genome = "GB_GCA_000003955.1"
    gdir = _make_genome_dir(tmp_path, genome)
    reg = Registry()
    for r in gtdb.emit_genome_dir(str(gdir), str(GTDB_HQ)):
        reg.add(r)
    tables = reg.finalize()
    assert tables["taxonomies"]
    asm = tables["assemblies"][0]
    assert asm["source_type"] == "isolate"
    tax = tables["taxonomies"][0]
    assert tax["species"] == "s__Bacillus subtilis"
    assert tax["rank_depth"] == 7
    tax_ids = {t["id"] for t in tables["taxonomies"]}
    bgc_ids = {b["id"] for b in tables["bgcs"]}
    assert tables["bgc_taxonomy"]
    assert all(r["taxonomy_id"] in tax_ids for r in tables["bgc_taxonomy"])
    assert all(r["bgc_id"] in bgc_ids for r in tables["bgc_taxonomy"])
    assert {r["rank"] for r in tables["bgc_taxonomy"]} == {"species"}
    report = validate_tables(tables)
    assert not report.hard_errors


def test_no_metadata_keeps_isolate_default_and_no_taxonomy(tmp_path):
    gdir = _make_genome_dir(tmp_path, "GB_GCA_111111111.1")
    recs = list(gtdb.emit_genome_dir(str(gdir)))
    asm = next(r for r in recs if r.table == "assemblies")
    assert asm.fields["source_type"] == "isolate"
    assert not any(r.table == "taxonomies" for r in recs)
    assert not any(r.table == "bgc_taxonomy" for r in recs)


def test_genome_absent_from_metadata_gets_isolate_no_taxonomy(tmp_path):
    gdir = _make_genome_dir(tmp_path, "GB_GCA_999999999.9")
    recs = list(gtdb.emit_genome_dir(str(gdir), str(GTDB_HQ)))
    asm = next(r for r in recs if r.table == "assemblies")
    assert asm.fields["source_type"] == "isolate"
    assert not any(r.table == "taxonomies" for r in recs)


def test_sample_assembly_analysis_share_genome_identity(tmp_path):
    genome = "GB_GCA_000003955.1"
    gdir = _make_genome_dir(tmp_path, genome)
    recs = list(gtdb.emit_genome_dir(str(gdir)))
    samp = next(r for r in recs if r.table == "samples")
    asm = next(r for r in recs if r.table == "assemblies")
    ana = next(r for r in recs if r.table == "analyses")
    assert samp.natural_key == asm.natural_key == ana.natural_key
    assert samp.natural_key == f"gtdb|{genome}"
    assert samp.fields["name"] == genome


def _bac120_sidecar(tmp_path, genome, **vals):
    cols = ["accession", "ncbi_organism_name", "ncbi_isolation_source", "ncbi_lat_lon",
            "ncbi_country", "gtdb_taxonomy", "gtdb_representative", "ncbi_taxonomy",
            "ncbi_taxid", "ncbi_species_taxid", "ncbi_bioproject", "ncbi_submitter",
            "ncbi_genome_representation"]
    base = {c: "none" for c in cols}
    base["accession"] = genome
    base.update(vals)
    p = tmp_path / "sidecar.tsv"
    p.write_text("\t".join(cols) + "\n" + "\t".join(base[c] for c in cols) + "\n")
    return str(p)


def test_bac120_enriches_sample(tmp_path):
    import json
    genome = "GB_GCA_000003955.1"   # isolate in the hq fixture -> category 'isolate'
    gdir = _make_genome_dir(tmp_path, genome)
    sidecar = _bac120_sidecar(tmp_path, genome, ncbi_organism_name="Escherichia coli",
                              ncbi_isolation_source="gut", ncbi_lat_lon="23.33 S 46.37 W",
                              ncbi_country="Brazil", gtdb_representative="True")
    recs = list(gtdb.emit_genome_dir(str(gdir), {"metadata": str(GTDB_HQ), "bac120": sidecar}))
    samp = next(r for r in recs if r.table == "samples")
    assert samp.fields["latitude"] == -23.33 and samp.fields["longitude"] == -46.37
    assert samp.fields["geographic_location"] == "Brazil"
    assert samp.fields["name"] == genome
    md = json.loads(samp.fields["metadata"])
    assert md["ncbi_organism_name"] == "Escherichia coli"
    assert md["ncbi_isolation_source"] == "gut"
    assert md["gtdb_genome_category"] == "isolate"    # injected from hq_mimag source_type
    assert "ncbi_taxonomy" not in md


def test_bac120_absent_genome_leaves_sample_alias_only(tmp_path):
    genome = "GB_GCA_000003955.1"
    gdir = _make_genome_dir(tmp_path, genome)
    sidecar = _bac120_sidecar(tmp_path, "SOME_OTHER.1", ncbi_organism_name="X")
    recs = list(gtdb.emit_genome_dir(str(gdir), {"metadata": str(GTDB_HQ), "bac120": sidecar}))
    samp = next(r for r in recs if r.table == "samples")
    assert "latitude" not in samp.fields and "geographic_location" not in samp.fields


def test_bac120_str_dataset_back_compat(tmp_path):
    genome = "GB_GCA_111111111.1"
    gdir = _make_genome_dir(tmp_path, genome)
    recs = list(gtdb.emit_genome_dir(str(gdir), str(GTDB_HQ)))
    asm = next(r for r in recs if r.table == "assemblies")
    assert asm.fields["source_type"] == "MAG"
    samp = next(r for r in recs if r.table == "samples")
    assert "latitude" not in samp.fields


def test_bac120_cache_not_mutated_across_emits(tmp_path):
    """Category is injected into a copy, so the per-worker _BAC120_CACHE is never mutated."""
    import json
    genome = "GB_GCA_000003955.1"   # isolate in hq -> gtdb_genome_category injected
    gdir = _make_genome_dir(tmp_path, genome)
    sidecar = _bac120_sidecar(tmp_path, genome, ncbi_organism_name="E. coli")
    dataset = {"metadata": str(GTDB_HQ), "bac120": sidecar}
    md1 = json.loads(next(r for r in gtdb.emit_genome_dir(str(gdir), dataset)
                          if r.table == "samples").fields["metadata"])
    md2 = json.loads(next(r for r in gtdb.emit_genome_dir(str(gdir), dataset)
                          if r.table == "samples").fields["metadata"])
    assert md1 == md2 and md2["gtdb_genome_category"] == "isolate"
    assert "gtdb_genome_category" not in gtdb._BAC120_CACHE[sidecar][genome]["metadata"]


def test_gtdb_study_from_bioproject(tmp_path):
    from scripts.populator.ids import scoped
    genome = "GB_GCA_000003955.1"
    gdir = _make_genome_dir(tmp_path, genome)
    sidecar = _bac120_sidecar(tmp_path, genome, ncbi_organism_name="E. coli",
                              ncbi_bioproject="PRJNA12345")
    recs = list(gtdb.emit_genome_dir(str(gdir), {"metadata": str(GTDB_HQ), "bac120": sidecar}))
    st = next(r for r in recs if r.table == "studies")
    assert st.natural_key == "gtdb|PRJNA12345"
    assert st.fields == {"external_id": "PRJNA12345", "accession": "PRJNA12345",
                         "bioproject": "PRJNA12345",
                         "study_name": "PRJNA12345"}      # external_id=accession=bioproject=study_name
    ss = next(r for r in recs if r.table == "study_samples")
    assert ss.refs["study_id"] == ("studies", "gtdb|PRJNA12345")
    assert ss.refs["sample_id"] == ("samples", scoped("gtdb", genome))


def test_gtdb_study_unassigned_when_no_bioproject(tmp_path):
    genome = "GB_GCA_000003955.1"
    gdir = _make_genome_dir(tmp_path, genome)
    sidecar = _bac120_sidecar(tmp_path, genome, ncbi_organism_name="X")   # bioproject defaults "none"
    recs = list(gtdb.emit_genome_dir(str(gdir), {"metadata": str(GTDB_HQ), "bac120": sidecar}))
    st = next(r for r in recs if r.table == "studies")
    assert st.natural_key == "gtdb|GTDB_UNASSIGNED"
    assert st.fields["accession"] == "GTDB_UNASSIGNED"


def test_gtdb_no_bac120_emits_no_study(tmp_path):
    genome = "GB_GCA_000003955.1"
    gdir = _make_genome_dir(tmp_path, genome)
    recs = list(gtdb.emit_genome_dir(str(gdir), str(GTDB_HQ)))    # hq only, no bac120
    assert not any(r.table in ("studies", "study_samples") for r in recs)


def test_gtdb_genome_absent_from_bac120_gets_unassigned_study(tmp_path):
    # production links every gtdb sample to a study, so UNASSIGNED
    genome = "GB_GCA_000003955.1"
    gdir = _make_genome_dir(tmp_path, genome)
    sidecar = _bac120_sidecar(tmp_path, "SOME_OTHER.1", ncbi_organism_name="X")
    recs = list(gtdb.emit_genome_dir(str(gdir), {"metadata": str(GTDB_HQ), "bac120": sidecar}))
    samp = next(r for r in recs if r.table == "samples")
    assert "latitude" not in samp.fields
    st = next(r for r in recs if r.table == "studies")
    assert st.natural_key == "gtdb|GTDB_UNASSIGNED"
    assert any(r.table == "study_samples" for r in recs)


def test_gtdb_bioproject_nullish_and_whitespace(tmp_path):
    genome = "GB_GCA_000003955.1"
    for i, (raw, expected) in enumerate([("na", "gtdb|GTDB_UNASSIGNED"),
                                         ("NULL", "gtdb|GTDB_UNASSIGNED"),
                                         (" PRJNA9 ", "gtdb|PRJNA9")]):
        d = tmp_path / f"case{i}"; d.mkdir()
        gdir = _make_genome_dir(d, genome)
        sidecar = _bac120_sidecar(d, genome, ncbi_bioproject=raw)
        recs = list(gtdb.emit_genome_dir(str(gdir), {"metadata": str(GTDB_HQ), "bac120": sidecar}))
        st = next(r for r in recs if r.table == "studies")
        assert st.natural_key == expected, f"{raw!r} -> {st.natural_key}"


def _make_run_tar(path, genome):
    """A re-run tarball with one region GBK nested as antiSMASH writes it."""
    import io
    import tarfile
    data = (FIX / "region_gbk_one.gbk").read_bytes()
    with tarfile.open(path, "w:gz") as tf:
        info = tarfile.TarInfo(f"{genome}/{genome}/CM000741.1.region001.gbk")
        info.size = len(data)
        tf.addfile(info, io.BytesIO(data))


def test_rerun_tarball_replaces_an_empty_original_run(tmp_path):
    """A genome whose original run never happened has an empty dir; its re-run tarball is
    the run, with the same bgc ids the original derivation gives."""
    genome = "GB_GCA_001107505.1"
    gdir = tmp_path / "gbks" / genome
    gdir.mkdir(parents=True)
    rerun = tmp_path / "rerun"
    rerun.mkdir()
    _make_run_tar(rerun / f"{genome}.tar.gz", genome)
    gtdb._rerun_genomes.cache_clear()
    recs = list(gtdb.emit_genome_dir(str(gdir), {"metadata": None, "runs_tar_dir": "/x/runs_tar",
                                                 "rerun_tar_dir": str(rerun)}))
    run = next(r for r in recs if r.table == "antismash_runs")
    assert run.fields["file_path"] == str(rerun / f"{genome}.tar.gz")
    assert run.fields["num_bgcs"] == 1
    bgc = next(r for r in recs if r.table == "bgcs")
    assert bgc.fields["filename"] == f"{genome}_CM000741.1.region001"


def test_genome_without_a_rerun_keeps_its_original_run(tmp_path):
    genome = "GB_GCA_000003955.1"
    gdir = _make_genome_dir(tmp_path, genome)
    rerun = tmp_path / "rerun"
    rerun.mkdir()
    gtdb._rerun_genomes.cache_clear()
    recs = list(gtdb.emit_genome_dir(str(gdir), {"metadata": None, "runs_tar_dir": "/x/runs_tar",
                                                 "rerun_tar_dir": str(rerun)}))
    run = next(r for r in recs if r.table == "antismash_runs")
    assert run.fields["file_path"] == f"/x/runs_tar/{genome}.tar.gz"
    assert run.fields["num_bgcs"] == 2
