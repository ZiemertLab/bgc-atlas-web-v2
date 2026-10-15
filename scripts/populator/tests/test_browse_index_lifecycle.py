import pathlib
import subprocess
import sys

from scripts.populator.tools.browse_index_lifecycle import alias_actions, versioned_index_name


def test_versioned_index_name_rejects_unsafe_versions():
    assert versioned_index_name("sample_browse", "v3") == "sample_browse_v3"
    try:
        versioned_index_name("sample_browse", "v3/delete")
    except ValueError as error:
        assert "version" in str(error)
    else:
        raise AssertionError("expected invalid version error")


def test_alias_actions_remove_current_alias_before_adding_new_index():
    assert alias_actions("sample_browse", "sample_browse_v3", ["sample_browse_v2"]) == {
        "actions": [
            {"remove": {"index": "sample_browse_v2", "alias": "sample_browse"}},
            {"add": {"index": "sample_browse_v3", "alias": "sample_browse"}},
        ],
    }


def test_lifecycle_script_runs_directly_from_the_repository_root():
    script = pathlib.Path(__file__).parents[1] / "tools" / "browse_index_lifecycle.py"
    result = subprocess.run([sys.executable, str(script), "--help"], capture_output=True, text=True)
    assert result.returncode == 0, result.stderr
