"""Skip, rather than fail, tests whose third-party data is absent.

The files below are gitignored because we may not redistribute them (THIRD_PARTY.md).
A fresh clone lacks them, so a test that opens one is skipped until they are restored.
"""

from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parent.parent

THIRD_PARTY_PATHS = (
    REPO_ROOT / "docs" / "GOLDs5levelEcosystemClassificationPaths.xlsx",
    REPO_ROOT / "scripts" / "populator" / "data",
    REPO_ROOT / "bgc-atlas" / "src" / "lib" / "wordlists" / "petname",
)


def is_third_party(path) -> bool:
    if not path:
        return False
    p = Path(path).resolve()
    return any(p == root or root in p.parents for root in THIRD_PARTY_PATHS)


def needs_third_party(*paths):
    """Mark a test that degrades silently, rather than raising, without the data."""
    missing = [str(Path(p).relative_to(REPO_ROOT)) for p in paths if not Path(p).exists()]
    return pytest.mark.skipif(bool(missing), reason=f"third-party data absent: {', '.join(missing)}")


def _skip_if_third_party_missing(exc: FileNotFoundError):
    if is_third_party(exc.filename):
        rel = Path(exc.filename).resolve().relative_to(REPO_ROOT)
        pytest.skip(f"third-party data absent: {rel} (see THIRD_PARTY.md)")


@pytest.hookimpl(wrapper=True)
def pytest_runtest_setup(item):
    try:
        return (yield)
    except FileNotFoundError as exc:
        _skip_if_third_party_missing(exc)
        raise


@pytest.hookimpl(wrapper=True)
def pytest_runtest_call(item):
    try:
        return (yield)
    except FileNotFoundError as exc:
        _skip_if_third_party_missing(exc)
        raise
