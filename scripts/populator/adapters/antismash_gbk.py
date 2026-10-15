from __future__ import annotations
import logging
import re
import tarfile
from pathlib import Path
from typing import List, Optional
from .antismash_json import Region

log = logging.getLogger("populator")

_REGION_LOC = re.compile(r"<?(\d+)\.\.>?(\d+)")
# A region GBK is a slice of the record; only these COMMENT lines carry the genomic offset.
_ORIG_START = re.compile(r"Orig\.\s+start\s*::\s*(\d+)")
_ORIG_END = re.compile(r"Orig\.\s+end\s*::\s*(\d+)")
_CORE_LOC = re.compile(r"\[<?(\d+):>?(\d+)\]")
_PROD_FEATURES = {"region", "cand_cluster", "protocluster", "proto_core"}
_REGION_FILE = re.compile(r"^(?P<contig>.+)\.region(?P<num>\d+)\.gbk$")


def _qval(stripped_line: str) -> str:
    return stripped_line.split("=", 1)[1].strip().strip('"')


def parse_region_gbk(gbk_text: str, contig: str, region_number: int,
                     taxon: Optional[str] = None) -> Optional[Region]:
    """Products come only from _PROD_FEATURES (a CDS /product is a gene name).
    Returns None when there is no ``region`` feature, so no 0-length BGC is ingested."""
    in_features = False
    cur_type = None
    start = end = None
    products: list = []
    categories: list = []
    core_s = core_e = None
    is_complete = True
    num_cds = 0
    in_continuation = False
    orig_start = orig_end = None
    for line in gbk_text.split("\n"):
        if line.startswith("FEATURES"):
            in_features = True
            continue
        if not in_features:
            if orig_start is None:
                m = _ORIG_START.search(line)
                if m:
                    orig_start = int(m.group(1))
            if orig_end is None:
                m = _ORIG_END.search(line)
                if m:
                    orig_end = int(m.group(1))
            continue
        if line.startswith("ORIGIN") or line.startswith("//"):
            break
        if len(line) > 5 and line[:5] == "     " and line[5] != " ":
            in_continuation = False
            parts = line[5:].split(None, 1)
            cur_type = parts[0]
            loc = parts[1] if len(parts) > 1 else ""
            if cur_type == "region":
                m = _REGION_LOC.search(loc)
                if m:
                    start, end = int(m.group(1)), int(m.group(2))
            elif cur_type == "CDS":
                num_cds += 1
            continue
        s = line.strip()
        if in_continuation:
            if s.count('"') % 2 == 1:
                in_continuation = False
            continue
        if cur_type in _PROD_FEATURES:
            if s.startswith("/product="):
                v = _qval(s)
                if v and v not in products:
                    products.append(v)
            elif s.startswith("/category="):
                v = _qval(s)
                if v and v not in categories:
                    categories.append(v)
            elif s.startswith("/contig_edge=") and cur_type == "region":
                if _qval(s).lower() in ("true", "1", "yes"):
                    is_complete = False
            elif s.startswith("/core_location="):
                m = _CORE_LOC.search(s)
                if m:
                    cs, ce = int(m.group(1)), int(m.group(2))
                    core_s = cs if core_s is None else min(core_s, cs)
                    core_e = ce if core_e is None else max(core_e, ce)
        # An unclosed quote begins a multi-line value.
        if s.startswith("/") and s.count('"') % 2 == 1:
            in_continuation = True
    if start is None:
        log.warning("antismash_gbk: no 'region' feature for contig=%s region=%s; skipping",
                    contig, region_number)
        return None
    # GenBank 1-based inclusive -> 0-based half-open, as everywhere downstream.
    rel_start = start - 1
    rel_end = end if end is not None else 0

    # `Orig. start`/`Orig. end` are already 0-based half-open. A whole-record GBK has
    # no such header and its locations are already absolute.
    if orig_start is not None and orig_end is not None:
        if orig_end - orig_start != rel_end - rel_start:
            log.warning(
                "antismash_gbk: contig=%s region=%s header span %d..%d (%d bp) "
                "disagrees with region feature (%d bp); using the header",
                contig, region_number, orig_start, orig_end,
                orig_end - orig_start, rel_end - rel_start)
        offset = orig_start
        abs_start, abs_end = orig_start, orig_end
    else:
        log.debug("antismash_gbk: no Orig. start/end for contig=%s region=%s; "
                  "treating feature locations as absolute", contig, region_number)
        offset = 0
        abs_start, abs_end = rel_start, rel_end

    return Region(
        contig=contig, region_number=region_number,
        start_pos=abs_start,
        end_pos=abs_end,
        # /core_location is slice-relative too.
        core_start_pos=(core_s + offset if core_s is not None else None),
        core_end_pos=(core_e + offset if core_e is not None else None),
        product=products, product_category=categories,
        is_complete=is_complete, num_cds_features=num_cds, taxon=taxon)


def parse_region_dir(dir_path, taxon: Optional[str] = None) -> List[Region]:
    """Contig name and region number come from the filename."""
    regions: List[Region] = []
    for f in sorted(Path(dir_path).glob("*.region*.gbk")):
        m = _REGION_FILE.match(f.name)
        if not m:
            continue
        reg = parse_region_gbk(f.read_text(), m.group("contig"),
                               int(m.group("num")), taxon=taxon)
        if reg is not None:
            regions.append(reg)
    return regions


def parse_region_tar(tar_path, taxon: Optional[str] = None) -> List[Region]:
    """Contig name and region number come from the basename, so region GBKs nested
    anywhere are matched and the consolidated ``<genome>.gbk`` is ignored."""
    regions: List[Region] = []
    with tarfile.open(tar_path, "r:*") as tf:
        for member in sorted(tf.getmembers(), key=lambda mb: mb.name):
            if not member.isfile():
                continue
            m = _REGION_FILE.match(Path(member.name).name)
            if not m:
                continue
            fh = tf.extractfile(member)
            if fh is None:
                continue
            text = fh.read().decode("utf-8", "replace")
            reg = parse_region_gbk(text, m.group("contig"),
                                   int(m.group("num")), taxon=taxon)
            if reg is not None:
                regions.append(reg)
    return regions
