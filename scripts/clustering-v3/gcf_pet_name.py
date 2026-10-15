#!/usr/bin/env python3
"""Human-readable GCF aliases (v3 name format).

Must stay behaviourally identical to bgc-atlas/src/lib/gcf-pet-name.ts and read the same
vendored wordlists; a divergence surfaces as a UNIQUE violation on `gcfs.pet_name`.
tests/test_gcf_pet_name.py pins golden values generated from the TS module.

    GCF-000042      seed tier,       integer = gcf_04
    GCF-F-400042    fragmented tier, integer = 400000 + residual_gcf_04

v2 names (GCF-04-000042 / GCF-CC-04-400042) are still accepted.

A re-clustering numbers its families from 1 again, so its names carry the data release the
clustering first shipped in -- GCF-v2b2-000042 / GCF-v2b2-F-400042 -- and the bare form is the
first v3 clustering's. The tag is `v` + the release in compact form (v2b2, v2, v2.1, v2.1b1),
never two bare digits, so it cannot be read as a v2 resolution segment.

PET_OFFSET shifts each clustering's numbers before the bijection, so its aliases are drawn from
a different part of the 1,260,296-alias space. Tags naming the same clustering map to the same
offset, so aliases survive a rename. The space is smaller than two clusterings' families, so
aliases are unique within a clustering, not across them.

The alias is display-only; there is no decode path.
"""
from __future__ import annotations

import functools
import os
import re

_WORDLIST_DIR = os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
    "bgc-atlas", "src", "lib", "wordlists", "petname",
)

# petname `medium`, Apache-2.0 -- see the repo-root NOTICE.
_EXPECTED_SIZES = {"adjectives.txt": 1198, "names.txt": 1052}

# Coprime to N = 2^3 * 263 * 599, so id -> x is a bijection.
_K = 2654435761

MAX_ID = 999_999

# Use fullmatch: `$` would also accept a trailing newline, which the TS side rejects.
_NAME_PATTERN = re.compile(r"GCF-(?:(v\d+(?:\.\d+)?(?:[ab]\d+)?)-)?(?:(?:CC-)?\d{2}-|F-)?(\d{6})")

# Offset into the alias space per clustering, keyed by the name tag ('' = the first v3
# clustering and v2). Each clustering starts after the previous one's largest number
# (400,000 + its largest fragmented id), so a new clustering's seed aliases avoid the previous
# one's. A dropped clustering keeps its entry so its offset is never handed out again.
PET_OFFSET = {"": 0, "v2b2": 794_186, "v2b4": 1_586_754, "v2b5": 2_379_180, "v2b6": 3_174_143}

# gcf_04 and residual_gcf_04 are independent counters; the offset keeps them disjoint.
FRAGMENTED_OFFSET = 400_000


@functools.lru_cache(maxsize=1)
def wordlists() -> tuple[tuple[str, ...], tuple[str, ...]]:
    lists = []
    for filename, expected in _EXPECTED_SIZES.items():
        path = os.path.join(_WORDLIST_DIR, filename)
        with open(path, encoding="utf-8") as handle:
            words = tuple(line.strip() for line in handle if line.strip())
        if len(words) != expected:
            raise RuntimeError(
                f"{path}: expected {expected} entries, found {len(words)}. The wordlists "
                "are load-bearing -- changing them re-aliases every family. This is a "
                "data migration, not a dependency bump."
            )
        lists.append(words)
    return lists[0], lists[1]


def pet_name_for_id(int_id: int, offset: int = 0) -> str:
    """`offset` (PET_OFFSET of the name's tag) moves the id before the bijection; ids stay
    distinct within a clustering because (id + offset) mod n is injective on 1..MAX_ID."""
    if not isinstance(int_id, int) or isinstance(int_id, bool) or not 1 <= int_id <= MAX_ID:
        raise ValueError(f"GCF id out of representable range (1..{MAX_ID}): {int_id!r}")
    adjectives, nouns = wordlists()
    n = len(adjectives) * len(nouns)  # 1,260,296 > 999,999
    x = ((int_id + offset) * _K) % n
    return f"{adjectives[x % len(adjectives)]}-{nouns[x // len(adjectives)]}"


def pet_name_for_gcf_name(gcf_name: str | None) -> str | None:
    """None for an unparseable name, so a future format never aborts a clustering run."""
    if not gcf_name:
        return None
    match = _NAME_PATTERN.fullmatch(gcf_name)
    if not match:
        return None
    tag, int_id = match.group(1) or "", int(match.group(2))
    if tag not in PET_OFFSET:
        return None
    return pet_name_for_id(int_id, PET_OFFSET[tag]) if 1 <= int_id <= MAX_ID else None


def gcf_name(family_class: str, int_id: int, tag: str = "") -> str:
    """`int_id` is the raw BiG-SLICE id from the tier's own data.db; the offset is applied here."""
    prefix = f"GCF-{tag}-" if tag else "GCF-"
    if tag and tag not in PET_OFFSET:
        raise ValueError(f"tag {tag!r} has no PET_OFFSET entry")
    if family_class == "seed":
        return f"{prefix}{int_id:06d}"
    if family_class == "fragmented":
        return f"{prefix}F-{FRAGMENTED_OFFSET + int_id:06d}"
    raise ValueError(f"unknown family_class: {family_class!r}")
