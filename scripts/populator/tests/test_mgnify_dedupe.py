from pathlib import Path

from scripts.populator.populate import dedupe_mgnify_archives, load_keep_runs


def _paths(*stems):
    return [Path(f"/runs/{s}.tar.gz") for s in stems]


def test_single_analysis_per_assembly_passes_through():
    archives = _paths("MGYA00000001_ERZ1", "MGYA00000002_ERZ2")
    assert dedupe_mgnify_archives(archives, set()) == sorted(archives)


def test_keep_list_wins_over_newest():
    archives = _paths("MGYA00000005_ERZ7", "MGYA00000009_ERZ7")
    kept = dedupe_mgnify_archives(archives, {"MGYA00000005_ERZ7"})
    assert kept == _paths("MGYA00000005_ERZ7")


def test_unlisted_duplicate_keeps_the_highest_mgya():
    archives = _paths("MGYA00000010_ERZ3", "MGYA00000200_ERZ3", "MGYA00000099_ERZ3")
    assert dedupe_mgnify_archives(archives, set()) == _paths("MGYA00000200_ERZ3")


def test_names_that_are_not_run_keys_pass_through():
    archives = _paths("something_else", "MGYA00000001_ERZ1")
    assert dedupe_mgnify_archives(archives, set()) == sorted(archives)


def test_committed_keep_list_covers_the_cleanup():
    keep = load_keep_runs(str(Path(__file__).parents[1] / "data" / "mgnify" / "kept_duplicate_runs.txt"))
    assert len(keep) == 3302
    assert len({k.split("_", 1)[1] for k in keep}) == 3302
