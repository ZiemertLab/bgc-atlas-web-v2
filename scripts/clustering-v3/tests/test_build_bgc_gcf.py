"""bgc_gcf has a partial unique index `(bgc_id) WHERE is_primary`; a violation passes COPY
and only fails at index build, so it is asserted on the rows here.
"""
from __future__ import annotations

import sys
from pathlib import Path


sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from build_bgc_gcf import rank_rows  # noqa: E402


class TestRanking:
    def test_primary_is_rank_zero(self):
        rows = rank_rows("bgc-a", [10, 20, 30])
        assert rows[0] == ("bgc-a", 10, 0, True)

    def test_secondaries_keep_gcf_04_all_order(self):
        # Order is gcf_04_all's (best bitscore first), not identity.
        rows = rank_rows("bgc-a", [10, 20, 30])
        assert [(r[1], r[2]) for r in rows] == [(10, 0), (20, 1), (30, 2)]

    def test_exactly_one_primary(self):
        rows = rank_rows("bgc-a", [10, 20, 30, 40])
        assert sum(1 for r in rows if r[3]) == 1

    def test_singleton_is_a_single_primary_row(self):
        assert rank_rows("bgc-a", [7]) == [("bgc-a", 7, 0, True)]

    def test_empty_membership_emits_nothing(self):
        assert rank_rows("bgc-a", []) == []
