#!/usr/bin/env python3
"""Canonical-GTDB helpers for the taxonomy v2 build.

taxonomy_assignments.parquet drops rank prefixes, calls the domain 'superkingdom', and
writes GTDB polyphyly suffixes with a space ('Bacillus A' for 'Bacillus_A'); unfixed, every
taxonomy facet splits into a real entry and a phantom one.
"""
import re
from typing import List, Optional, Sequence

RANKS = ["domain", "phylum", "class", "order", "family", "genus", "species"]
PREFIXES = ["d__", "p__", "c__", "o__", "f__", "g__", "s__"]

# A short run of capitals as its own token ('Bacillus A'); lowercase epithets and
# hyphenated placeholders ('MGIIa-L1') do not match.
_SUFFIX = re.compile(r" ([A-Z]{1,3})(?= |$)")


def restore_suffix(name: Optional[str]) -> Optional[str]:
    if not name:
        return name
    return _SUFFIX.sub(r"_\1", name)


def canonical_lineage(ranks: Sequence[Optional[str]]) -> str:
    """Stops at the first missing rank; ranks below a gap are dropped, not emitted out of position."""
    parts: List[str] = []
    for prefix, value in zip(PREFIXES, ranks):
        if not value:
            break
        parts.append(prefix + restore_suffix(value))
    return ";".join(parts)


def split_gtdb_lineage(lineage: str) -> List[Optional[str]]:
    """Empty ranks (`c__`) come back as None so they round-trip through canonical_lineage()."""
    values: List[Optional[str]] = [None] * len(RANKS)
    for i, component in enumerate(lineage.split(";")):
        if i >= len(RANKS):
            break
        stripped = component[3:] if component[:3] in PREFIXES else component
        values[i] = stripped or None
    return values


def rank_depth(lineage: str) -> int:
    return len([c for c in lineage.split(";") if c]) if lineage else 0


def is_partial(lineage: str) -> bool:
    return rank_depth(lineage) < len(RANKS)
