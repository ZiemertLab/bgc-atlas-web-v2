"""antiSMASH region anchors (e.g. "r7c1", the viewer's location hash) from regions.js,
keyed by (seq_id, idx) so no record ordinal has to be reconstructed."""
from __future__ import annotations

import json
import logging
import re
import tarfile
from typing import Dict, Optional, Tuple

log = logging.getLogger("populator")

# Only locates the start: descriptions can contain "];", so the array is read with
# raw_decode rather than a bracket-matching regex.
_RECORDDATA_START = re.compile(r"\brecordData\s*=\s*")


def parse_regions_js(text: str) -> Dict[Tuple[str, int], str]:
    m = _RECORDDATA_START.search(text)
    if not m:
        log.warning("anchors: no recordData in regions.js")
        return {}
    try:
        records, _ = json.JSONDecoder().raw_decode(text, m.end())
    except (ValueError, json.JSONDecodeError) as e:
        log.warning("anchors: recordData JSON parse failed: %s", e)
        return {}
    if not isinstance(records, list):
        return {}
    out: Dict[Tuple[str, int], str] = {}
    for rec in records:
        if not isinstance(rec, dict):
            continue
        contig = rec.get("seq_id")
        for reg in (rec.get("regions") or []):
            if not isinstance(reg, dict):
                continue
            idx, anchor = reg.get("idx"), reg.get("anchor")
            if contig is None or idx is None or not anchor:
                continue
            try:
                out[(contig, int(idx))] = anchor
            except (ValueError, TypeError):
                continue
    return out


def select_regions_js(names) -> Optional[str]:
    """Converted MGnify tarballs also hold a ``<name>_basic/`` prescreen with different
    record numbering; the site serves ``<name>/`` (findAntismashIndex in
    bgc-atlas/src/lib/api/antismash.ts), so de-prefer ``_basic``, then shortest path,
    then lexicographic. Never archive order. A lone ``_basic`` candidate is still used."""
    def _is_prescreen(name: str) -> bool:
        # Several sources store regions.js at the archive root with no parent.
        parts = name.rsplit("/", 2)
        return len(parts) >= 2 and parts[-2].endswith("_basic")

    candidates = sorted(names, key=lambda n: (n.count("/"), n))
    if not candidates:
        return None
    preferred = [n for n in candidates if not _is_prescreen(n)]
    if not preferred:
        log.warning("anchors: only prescreen (_basic) regions.js present: %s", candidates[0])
        return candidates[0]
    chosen = preferred[0]
    if len(candidates) > 1:
        log.info("anchors: %d regions.js candidates, chose %s (discarded %s)",
                 len(candidates), chosen, ", ".join(n for n in candidates if n != chosen))
    return chosen


def region_anchor_map_with_candidates(tarball_path):
    """Also returns every regions.js candidate, so callers needing the inventory avoid
    a second full gzip pass."""
    try:
        with tarfile.open(tarball_path, "r:*") as t:
            candidates = sorted(
                (mb.name for mb in t.getmembers()
                 if mb.isfile() and mb.name.rsplit("/", 1)[-1] == "regions.js"),
                key=lambda n: (n.count("/"), n),
            )
            member = select_regions_js(candidates)
            if not member:
                log.warning("anchors: no regions.js in %s", tarball_path)
                return {}, candidates
            fh = t.extractfile(member)
            if fh is None:
                return {}, candidates
            return parse_regions_js(fh.read().decode("utf-8", "replace")), candidates
    except (tarfile.TarError, OSError) as e:
        log.warning("anchors: cannot read %s: %s", tarball_path, e)
        return {}, []


def region_anchor_map(tarball_path) -> Dict[Tuple[str, int], str]:
    """{(contig, region_number): anchor}; any failure yields {}."""
    return region_anchor_map_with_candidates(tarball_path)[0]
