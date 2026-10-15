"""Naming and listing rules for the gcfs load table."""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from build_gcfs import gcf_uuid, is_listed  # noqa: E402
from gcf_pet_name import gcf_name  # noqa: E402


class TestNaming:
    def test_seed_name_has_no_tier_marker(self):
        assert gcf_name("seed", 42) == "GCF-000042"

    def test_fragmented_name_is_offset_by_400000(self):
        assert gcf_name("fragmented", 42) == "GCF-F-400042"

    def test_endpoints_stay_six_digits(self):
        assert gcf_name("seed", 1) == "GCF-000001"
        assert gcf_name("seed", 371_651) == "GCF-371651"
        assert gcf_name("fragmented", 1) == "GCF-F-400001"
        assert gcf_name("fragmented", 394_134) == "GCF-F-794134"

    def test_unknown_tier_is_an_error(self):
        with pytest.raises(ValueError):
            gcf_name("residual", 42)


class TestListing:
    def test_fragmented_singleton_is_not_listed(self):
        assert is_listed("fragmented", 1) is False

    def test_fragmented_pair_is_listed(self):
        assert is_listed("fragmented", 2) is True

    def test_seed_singleton_is_still_listed(self):
        assert is_listed("seed", 1) is True

    def test_seed_family_with_no_primary_member_is_not_listed(self):
        # Exists only as a secondary hit: needs a gcfs row for the FK, but no page.
        assert is_listed("seed", 0) is False


class TestUuid:
    def test_is_deterministic(self):
        assert gcf_uuid("GCF-000042") == gcf_uuid("GCF-000042")

    def test_differs_per_name(self):
        assert gcf_uuid("GCF-000042") != gcf_uuid("GCF-F-400042")

    def test_is_a_uuid5_of_the_name(self):
        import uuid
        assert gcf_uuid("GCF-000042") == str(uuid.uuid5(uuid.NAMESPACE_URL, "GCF-000042"))
