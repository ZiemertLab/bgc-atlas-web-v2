"""Unit tests for the DB-free logic in tools/backfill_mgnify_study_samples.py."""
import pytest

from scripts.populator.tools.backfill_mgnify_study_samples import (
    METHOD_ERZ,
    METHOD_SOLE,
    METHOD_TITLE,
    METHOD_UNRESOLVED,
    aliases_v1,
    aliases_v2,
    build_links,
    is_assembly_study,
    resolve,
)

# Real titles from bgc_atlas_v2, trimmed.
TPA = "EMG produced TPA metagenomics assembly of the Gut microbial dysbiosis in young adults with obesity."
ASM_METAGENOME = "Metagenome assembly of PRJEB50625 data set (MicroReset rabbit)"
ASM_METATRANSCRIPTOME = "Metatranscriptome assembly of PRJNA738385 data set (Metatranscriptomics of shellfish hatchery intake water)"
PARENT = "Gut microbial dysbiosis in young adults with obesity"
AMPLICON = "Amplicon sequencing of Tara Oceans DNA samples corresponding to size fractions for protists."


class TestIsAssemblyStudy:
    @pytest.mark.parametrize("title", [TPA, ASM_METAGENOME, ASM_METATRANSCRIPTOME])
    def test_generated_assembly_titles_match(self, title):
        assert is_assembly_study(title)

    @pytest.mark.parametrize("title", [PARENT, AMPLICON,
                                       "Shotgun Sequencing of Tara Oceans DNA samples",
                                       "MicroReset rabbit"])
    def test_human_written_parents_do_not_match(self, title):
        assert not is_assembly_study(title)

    @pytest.mark.parametrize("title", [None, "", "   "])
    def test_empty_titles_are_not_assemblies(self, title):
        assert not is_assembly_study(title)

    def test_leading_whitespace_is_tolerated(self):
        assert is_assembly_study(f"  {TPA}")

    def test_assembly_wording_mid_title_does_not_match(self):
        # anchored: these are structural prefixes, not free text
        assert not is_assembly_study("Notes on the Metagenome assembly of a data set")


class TestResolve:
    def test_erz_wins_over_every_other_candidate(self):
        candidates = {"MGYS1": TPA, "MGYS2": PARENT, "MGYS3": AMPLICON}
        chosen, method = resolve(candidates, {"MGYS1"})
        assert (chosen, method) == ({"MGYS1"}, METHOD_ERZ)

    def test_erz_keeps_both_when_two_assemblies_really_contributed(self):
        # the Tara metagenome + metatranscriptome case (156 samples)
        candidates = {"MGYS1": TPA, "MGYS2": TPA, "MGYS3": AMPLICON}
        chosen, method = resolve(candidates, {"MGYS1", "MGYS2"})
        assert (chosen, method) == ({"MGYS1", "MGYS2"}, METHOD_ERZ)

    def test_erz_studies_outside_candidates_are_ignored(self):
        chosen, method = resolve({"MGYS1": TPA, "MGYS2": PARENT}, {"MGYS1", "MGYS9"})
        assert (chosen, method) == ({"MGYS1"}, METHOD_ERZ)

    def test_falls_back_to_title_when_erz_disjoint(self):
        chosen, method = resolve({"MGYS1": TPA, "MGYS2": PARENT}, {"MGYS9"})
        assert (chosen, method) == ({"MGYS1"}, METHOD_TITLE)

    def test_title_rule_picks_the_lone_assembly_study(self):
        candidates = {"MGYS1": TPA, "MGYS2": PARENT, "MGYS3": AMPLICON}
        chosen, method = resolve(candidates, set())
        assert (chosen, method) == ({"MGYS1"}, METHOD_TITLE)

    def test_sole_candidate_needs_no_assembly_flag(self):
        chosen, method = resolve({"MGYS1": PARENT}, set())
        assert (chosen, method) == ({"MGYS1"}, METHOD_SOLE)

    def test_single_assembly_candidate_is_reported_as_the_title_method(self):
        # a lone assembly-study candidate is claimed by the title rule, not `sole`
        chosen, method = resolve({"MGYS1": TPA}, set())
        assert (chosen, method) == ({"MGYS1"}, METHOD_TITLE)

    def test_two_assembly_studies_without_erz_is_unresolved(self):
        chosen, method = resolve({"MGYS1": TPA, "MGYS2": ASM_METAGENOME}, set())
        assert (chosen, method) == (set(), METHOD_UNRESOLVED)

    def test_several_non_assembly_candidates_is_unresolved(self):
        chosen, method = resolve({"MGYS1": PARENT, "MGYS2": AMPLICON}, set())
        assert (chosen, method) == (set(), METHOD_UNRESOLVED)

    def test_no_candidates_is_unresolved(self):
        assert resolve({}, {"MGYS1"}) == (set(), METHOD_UNRESOLVED)

    def test_never_guesses_rather_than_returning_empty(self):
        # an empty set is the only "don't insert" signal build_links relies on
        chosen, _ = resolve({"MGYS1": PARENT, "MGYS2": AMPLICON}, set())
        assert chosen == set()


class TestAliases:
    def test_v2_carries_both_biosample_and_secondary_forms(self):
        data = {"accession": "SAMEA104335410",
                "ena_accessions": ["SAMEA104335410", "ERS1960388"]}
        assert aliases_v2(data) == {"SAMEA104335410", "ERS1960388"}

    def test_v2_accession_is_added_when_absent_from_ena_accessions(self):
        assert aliases_v2({"accession": "SAMN1", "ena_accessions": ["SRS1"]}) == {"SAMN1", "SRS1"}

    def test_v2_tolerates_missing_and_empty_fields(self):
        assert aliases_v2({}) == set()
        assert aliases_v2({"accession": None, "ena_accessions": None}) == set()
        assert aliases_v2({"accession": "S1", "ena_accessions": [None, ""]}) == {"S1"}

    def test_v1_uses_the_member_accession_plus_attribute_forms(self):
        obj = {"attributes": {"accession": "ERS1", "biosample": "SAMEA1"}}
        assert aliases_v1("ERS1", obj) == {"ERS1", "SAMEA1"}

    def test_v1_tolerates_missing_attributes(self):
        assert aliases_v1("ERS1", {}) == {"ERS1"}
        assert aliases_v1("ERS1", {"attributes": None}) == {"ERS1"}


class TestBuildLinks:
    def _state(self):
        samples = {"ERS1": "uuid-s1", "ERS2": "uuid-s2", "ERS3": "uuid-s3"}
        studies = {"MGYS1": ("uuid-a1", TPA),
                   "MGYS2": ("uuid-a2", PARENT),
                   "MGYS3": ("uuid-a3", AMPLICON)}
        return samples, studies

    def test_counts_each_method_once_per_sample_not_per_link(self):
        samples, studies = self._state()
        rows, counts, unresolved = build_links(
            samples, studies,
            sample_erz={"uuid-s1": {"ERZ1", "ERZ2"}},
            alias_studies={"ERS1": {"MGYS1", "MGYS2"},
                           "ERS2": {"MGYS1", "MGYS2"},
                           "ERS3": {"MGYS2"}},
            erz_studies={"ERZ1": "MGYS1", "ERZ2": "MGYS2"})
        # s1 resolves by ERZ to TWO studies -> 2 rows but 1 sample counted
        assert counts == {METHOD_ERZ: 1, METHOD_TITLE: 1, METHOD_SOLE: 1}
        assert len(rows) == 4
        assert unresolved == []

    def test_study_accessions_absent_from_the_db_are_not_candidates(self):
        samples, studies = self._state()
        rows, counts, unresolved = build_links(
            samples={"ERS3": "uuid-s3"}, studies=studies, sample_erz={},
            alias_studies={"ERS3": {"MGYS2", "MGYS_NOT_IN_DB"}}, erz_studies={})
        assert [r[3] for r in rows] == ["MGYS2"]
        assert counts == {METHOD_SOLE: 1}

    def test_unresolved_samples_produce_no_rows(self):
        samples, studies = self._state()
        rows, counts, unresolved = build_links(
            samples={"ERS3": "uuid-s3"}, studies=studies, sample_erz={},
            alias_studies={"ERS3": {"MGYS2", "MGYS3"}}, erz_studies={})
        assert rows == []
        assert unresolved == ["ERS3"]
        assert counts == {METHOD_UNRESOLVED: 1}

    def test_sample_with_no_link_in_either_bundle_is_unresolved(self):
        samples, studies = self._state()
        rows, counts, unresolved = build_links(
            samples={"ERS9": "uuid-s9"}, studies=studies,
            sample_erz={}, alias_studies={}, erz_studies={})
        assert rows == [] and unresolved == ["ERS9"]

    def test_rows_carry_the_uuids_the_insert_uses(self):
        samples, studies = self._state()
        rows, _, _ = build_links(
            samples={"ERS1": "uuid-s1"}, studies=studies,
            sample_erz={"uuid-s1": {"ERZ1"}},
            alias_studies={"ERS1": {"MGYS1", "MGYS2"}},
            erz_studies={"ERZ1": "MGYS1"})
        assert rows == [("uuid-s1", "uuid-a1", "ERS1", "MGYS1", METHOD_ERZ)]

    def test_erz_assemblies_not_in_the_map_fall_through_to_the_title_rule(self):
        samples, studies = self._state()
        _, counts, _ = build_links(
            samples={"ERS1": "uuid-s1"}, studies=studies,
            sample_erz={"uuid-s1": {"ERZ_UNKNOWN"}},
            alias_studies={"ERS1": {"MGYS1", "MGYS2"}}, erz_studies={})
        assert counts == {METHOD_TITLE: 1}
