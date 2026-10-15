from __future__ import annotations
import logging
import re
from dataclasses import dataclass
from typing import Iterator, List, Optional

log = logging.getLogger(__name__)


@dataclass
class Region:
    contig: str
    region_number: int
    start_pos: int
    end_pos: int
    core_start_pos: Optional[int]
    core_end_pos: Optional[int]
    product: List[str]
    product_category: List[str]
    is_complete: bool
    num_cds_features: int
    taxon: Optional[str]


_LOC = re.compile(r"\[<?(\d+):>?(\d+)\]")


def _loc_bounds(location: Optional[str]):
    # Compound/join(...) locations yield only the first fragment; fine for num_cds.
    m = _LOC.search(location or "")
    return (int(m.group(1)), int(m.group(2))) if m else (None, None)


def _q1(feat, key):
    if not feat:
        return None
    v = feat.get("qualifiers", {}).get(key)
    if isinstance(v, list):
        return v[0] if v else None
    return v


def parse_regions(data: dict) -> Iterator[Region]:
    """Each area is matched to its ``region`` feature by location bounds, not list index.
    With no match, region_number/is_complete fall back to 1/True.
    """
    taxon = data.get("taxon")
    for rec in data.get("records", []):
        contig = rec.get("id")
        features = rec.get("features", [])
        region_feats = {}
        for f in features:
            if f.get("type") == "region":
                bounds = _loc_bounds(f.get("location"))
                region_feats[bounds] = f
        cds = [f for f in features if f.get("type") == "CDS"]
        for area in rec.get("areas", []):
            start, end = int(area["start"]), int(area["end"])
            products = list(area.get("products", []))
            cats: List[str] = []
            core_s = core_e = None
            for pc in (area.get("protoclusters") or {}).values():
                cat = pc.get("category")
                if cat and cat not in cats:
                    cats.append(cat)
                if pc.get("core_start") is not None:
                    core_s = pc["core_start"] if core_s is None else min(core_s, pc["core_start"])
                if pc.get("core_end") is not None:
                    core_e = pc["core_end"] if core_e is None else max(core_e, pc["core_end"])
            rf = region_feats.get((start, end))
            if rf is None:
                log.warning(
                    "antiSMASH parse: area %s:%d-%d has no matching region "
                    "feature; region_number=1/is_complete=True defaulted",
                    contig, start, end,
                )
            rnum = _q1(rf, "region_number")
            edge = _q1(rf, "contig_edge")
            ncds = 0
            for c in cds:
                cs, ce = _loc_bounds(c.get("location"))
                if cs is None:
                    ncds += 1                      # unparseable location: count rather than drop
                elif cs < end and ce > start:
                    ncds += 1
            yield Region(
                contig=contig,
                region_number=int(rnum) if rnum else 1,
                start_pos=start, end_pos=end,
                core_start_pos=core_s, core_end_pos=core_e,
                product=products, product_category=cats,
                is_complete=(str(edge).lower() != "true"),
                num_cds_features=ncds,
                taxon=taxon,
            )
