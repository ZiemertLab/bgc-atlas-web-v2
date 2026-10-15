import gzip
import io
import json
import pathlib
import tarfile

from scripts.populator.adapters.antismash_facets import (
    find_results_json_member,
    parse_facets,
    stream_facets_from_tar,
)

FIX = pathlib.Path(__file__).parent / "fixtures"


def _load(name):
    return json.loads((FIX / name).read_text())


def _regions(name):
    return list(parse_facets(_load(name)))


def _only(name):
    regs = _regions(name)
    assert len(regs) == 1, f"expected 1 region, got {len(regs)}"
    return regs[0]


def test_empty_records_yields_nothing():
    assert _regions("facets_empty_records.json") == []


def test_region_key_and_coords():
    r = _only("facets_gtdb_region.json")
    assert r["contig"] == "NZ_CAXVNY010000007.1"
    assert r["start"] == 12279
    assert r["end"] == 32630
    assert r["region_number"] == 1


def test_region_products_and_category():
    r = _only("facets_gtdb_region.json")
    assert r["product_type"] == ["RRE-containing"]
    assert r["product_category"] == ["RiPP"]


def test_region_completeness_from_contig_edge():
    assert _only("facets_gtdb_region.json")["is_complete"] is True
    assert _only("facets_metalog_region.json")["is_complete"] is False


def test_region_gc_content():
    r = _only("facets_gtdb_region.json")
    assert abs(r["gc_content"] - 0.42394477) < 1e-6


def test_region_candidate_kind_and_protocluster_count():
    r = _only("facets_gtdb_region.json")
    assert r["candidate_kind"] == ["single"]
    assert r["num_protoclusters"] == 1


def test_region_detection_rules_present():
    r = _only("facets_gtdb_region.json")
    assert isinstance(r["detection_rules"], list)
    assert any("RRE" in rule for rule in r["detection_rules"])


def test_pfam_stripped_of_version():
    r = _only("facets_gtdb_region.json")
    assert "PF00156" in r["pfam"]
    assert "PF00156.30" not in r["pfam"]
    assert len(r["pfam"]) == 22
    assert len(_only("facets_metalog_region.json")["pfam"]) == 3


def test_tigrfam():
    assert "TIGR00048" in _only("facets_gtdb_region.json")["tigrfam"]
    assert len(_only("facets_gtdb_region.json")["tigrfam"]) == 10
    assert _only("facets_metalog_region.json")["tigrfam"] == []


def test_smcog():
    assert set(_only("facets_gtdb_region.json")["smcog"]) == {
        "SMCOG1032", "SMCOG1106", "SMCOG1112"
    }
    assert set(_only("facets_metalog_region.json")["smcog"]) == {"SMCOG1030"}


def test_go_terms_from_in_region_pfams():
    r = _only("facets_gtdb_region.json")
    assert "GO:0003700" in r["go_terms"]
    assert len(r["go_terms"]) == 22


def test_antismash_domains_empty_without_nrps_pks():
    # a RiPP region has no NRPS/PKS secondary-metabolite domains
    assert _only("facets_gtdb_region.json")["antismash_domains"] == []


def test_tta_codons_count():
    assert _only("facets_gtdb_region.json")["tta_codons"] == 0
    assert _only("facets_metalog_region.json")["tta_codons"] == 0


def test_nrps_pks_domains_captured_as_antismash_domains():
    r = _only("facets_nrps_pks_region.json")
    assert "AMP-binding" in r["antismash_domains"]
    assert "PKS_KS" in r["antismash_domains"]


def test_nrps_pks_monomers_and_substrates():
    r = _only("facets_nrps_pks_region.json")
    assert r["monomers"] == ["Ala"]  # nrps_pks.consensus
    assert "Ala" in r["substrates"]   # nrpys single_amino
    assert "Tyr" in r["substrates"]   # stachelhaus match


def test_nrps_pks_stachelhaus_at_kr():
    r = _only("facets_nrps_pks_region.json")
    assert r["stachelhaus_codes"] == ["DAEGIGAVMK"]
    assert r["at_specificity"] == ["Methylmalonyl-CoA"]
    assert r["kr_stereochemistry"] == ["C2"]


def test_nrps_pks_modules_and_trans_at():
    r = _only("facets_nrps_pks_region.json")
    assert r["num_modules"] == 2
    assert "Condensation_LCL-AMP-binding-PCP" in r["module_signatures"]
    assert r["pks_trans_at"] is False


def test_nrps_pks_predicted_structure():
    r = _only("facets_nrps_pks_region.json")
    assert r["predicted_smiles"] == ["NC(C)C(=O)NC(C)C(=O)O"]
    assert r["monomer_consensus"] == ["(Ala - Ala)"]


def test_nrps_pks_fields_empty_for_non_nrps_region():
    r = _only("facets_gtdb_region.json")
    assert r["monomers"] == []
    assert r["substrates"] == []
    assert r["num_modules"] == 0
    assert r["predicted_smiles"] == []
    assert r["pks_trans_at"] is False


def test_terpene_products_and_domains():
    r = _only("facets_metalog_region.json")
    assert r["terpene_products"] == ["C40_carotenoid"]
    assert r["terpene_domains"] == ["Lycopene_cycl"]


def test_terpene_empty_for_non_terpene_region():
    r = _only("facets_gtdb_region.json")
    assert r["terpene_products"] == []
    assert r["terpene_domains"] == []


def test_t2pks_class_starter_elongation():
    r = _only("facets_t2pks_region.json")
    assert r["pks_t2_class"] == ["angucycline", "anthracycline"]
    assert r["pks_t2_starter"] == ["acetyl-CoA"]
    assert r["pks_t2_elongation"] == ["malonyl-CoA"]


def test_t2pks_empty_for_non_t2pks_region():
    r = _only("facets_metalog_region.json")
    assert r["pks_t2_class"] == []
    assert r["pks_t2_starter"] == []


def test_ripp_class_and_subclass():
    r = _only("facets_ripp_region.json")
    assert r["ripp_class"] == ["lanthipeptide"]
    assert r["ripp_subclass"] == ["Class I"]


def test_ripp_core_and_leader_sequences():
    r = _only("facets_ripp_region.json")
    assert r["core_seq"] == ["LLFCGDFKIKIELIKSV"]
    assert r["leader_seq"] == ["MQDLTCSAHEVIIFEV"]


def test_ripp_mass_and_rodeo():
    r = _only("facets_ripp_region.json")
    assert r["ripp_mass"] == [1947.14]
    assert r["rodeo_score"] == [18]  # coerced from ["18"]


def test_ripp_comparippson_hits():
    r = _only("facets_ripp_region.json")
    assert r["comparippson_hits"] == ["BGC0000501.1"]


def test_ripp_fields_empty_for_non_ripp_region():
    r = _only("facets_metalog_region.json")
    assert r["ripp_class"] == []
    assert r["core_seq"] == []
    assert r["comparippson_hits"] == []


# Only categorical detailed_info values belong in `ripp_modifications`; numeric ones
# get their own typed fields.

def test_ripp_num_bridges_promoted_to_integer_field():
    r = _only("facets_ripp_region.json")
    assert r["ripp_num_bridges"] == [3]  # coerced from ["3"]


def test_ripp_cut_mass_and_weight_promoted_to_float_fields():
    r = _only("facets_ripp_lasso_region.json")
    assert r["ripp_cut_mass"] == [2278.065915]
    assert r["ripp_cut_weight"] == [2279.4099]


def test_ripp_macrolactam_promoted_to_sequence_field():
    r = _only("facets_ripp_lasso_region.json")
    assert r["ripp_macrolactam"] == ["GTPGFQTPD"]


def test_ripp_mature_weight_promoted_to_float_field():
    r = _only("facets_ripp_thio_region.json")
    assert r["ripp_mature_weight"] == [1116.19849, 1117.1462]


def test_ripp_modifications_keeps_only_categorical_keys():
    assert _only("facets_ripp_region.json")["ripp_modifications"] == [
        "predicted_additional_modifications:AviCys",
    ]
    assert _only("facets_ripp_thio_region.json")["ripp_modifications"] == [
        "macrocycle:26-member",
        "core_features:Central ring: pyridine trisubstituted",
        "tail_reaction:dealkylation of C-Terminal residue; amidation",
    ]


def test_ripp_modifications_drops_empty_values():
    # a bare "macrocycle:" carries no filtering signal
    r = _only("facets_ripp_thio_region.json")
    assert "macrocycle:" not in r["ripp_modifications"]


def test_ripp_modifications_excludes_numeric_and_sequence_keys():
    mods = _only("facets_ripp_lasso_region.json")["ripp_modifications"]
    assert mods == []


def test_ripp_split_fields_empty_for_non_ripp_region():
    r = _only("facets_metalog_region.json")
    assert r["ripp_num_bridges"] == []
    assert r["ripp_cut_mass"] == []
    assert r["ripp_cut_weight"] == []
    assert r["ripp_mature_weight"] == []
    assert r["ripp_macrolactam"] == []


def test_knowncluster_hits_and_compounds():
    r = _only("facets_clusterblast_region.json")
    assert r["knowncluster_hits"] == ["BGC0000642.3", "BGC0000633.1"]
    assert r["knowncluster_compounds"] == ["carotenoid", "lycopene"]
    assert r["num_knowncluster_hits"] == 2


def test_knowncluster_top_promoted_scalars():
    r = _only("facets_clusterblast_region.json")
    assert r["knowncluster_top"] == "BGC0000642.3"
    assert r["knowncluster_top_compound"] == "carotenoid"
    assert r["knowncluster_top_similarity"] == 28


def test_general_and_subcluster_hits():
    r = _only("facets_clusterblast_region.json")
    assert r["clusterblast_hits"] == ["NZ_AP018410"]
    assert r["subcluster_hits"] == []


def test_cluster_compare_mibig_top():
    r = _only("facets_clusterblast_region.json")
    assert r["mibig_comparison_top"] == "BGC0000836.5"
    assert abs(r["mibig_comparison_top_score"] - 0.4929) < 1e-9


def test_knowncluster_empty_when_no_hits():
    r = _only("facets_gtdb_region.json")
    assert r["knowncluster_hits"] == []
    assert r["knowncluster_top"] is None
    assert r["knowncluster_top_similarity"] is None
    assert r["num_knowncluster_hits"] == 0


def test_tfbs_regulators():
    r = _only("facets_gtdb_region.json")
    assert "ColR" in r["tfbs_regulators"]
    assert "PerR" in r["tfbs_regulators"]
    assert len(r["tfbs_regulators"]) == 9
    assert _only("facets_metalog_region.json")["tfbs_regulators"] == []


def test_find_member_regions_suffix():
    names = ["run/run/run_regions.json", "run/run/regions.js"]
    assert find_results_json_member(names) == "run/run/run_regions.json"


def test_find_member_under_antismash_dir():
    names = ["r/antismash/r.json", "r/antismash/index.html"]
    assert find_results_json_member(names) == "r/antismash/r.json"


def test_find_member_excludes_aux_json():
    names = ["r/r.json", "r/knownclusterblast/region1/ctg1.json"]
    assert find_results_json_member(names) == "r/r.json"


def test_find_member_none_when_no_json():
    assert find_results_json_member(["r/index.html", "r/regions.js"]) is None


def _make_targz(path, member_name, payload):
    raw = json.dumps(payload).encode()
    with gzip.open(path, "wb") as gz:
        with tarfile.open(fileobj=gz, mode="w") as tar:
            info = tarfile.TarInfo(member_name)
            info.size = len(raw)
            tar.addfile(info, io.BytesIO(raw))


def test_stream_facets_from_tar_yields_regions(tmp_path):
    payload = _load("facets_nrps_pks_region.json")
    arc = tmp_path / "RUN1.tar.gz"
    _make_targz(arc, "RUN1/RUN1/RUN1_regions.json", payload)
    regions = list(stream_facets_from_tar(str(arc)))
    assert len(regions) == 1
    assert regions[0]["contig"] == "ctg_nrps"
    assert regions[0]["monomers"] == ["Ala"]
