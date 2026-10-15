"""Parse antiSMASH region .gbk bytes into the per-BGC feature dict used by scan_tar.py.

The tar members carry no path metadata, so everything except bgc_id and source comes from content.
"""
from __future__ import annotations

import re
from typing import Any

_LOCUS_RE = re.compile(rb"^LOCUS\s+(\S+)\s+(\d+)\s+bp", re.MULTILINE)
_DEF_RE = re.compile(rb"^DEFINITION\s+(.*?)(?=\n[A-Z])", re.MULTILINE | re.DOTALL)
# MEGAHIT: "len=182248"; SPAdes: "length-25758" / "length_25758"
_DEF_LEN_RE = re.compile(rb"\b(?:len|length)[=_\-](\d+)\b", re.IGNORECASE)
# antiSMASH <=7 and metaSMASH write "Orig. length" (the contig length). antiSMASH 8 writes only
# "Orig. start"/"Orig. end" (region coords; end is only a lower bound on the contig length).
_ORIG_LEN_RE = re.compile(rb"Orig\.\s*length\s*::\s*(\d+)")
_ORIG_START_RE = re.compile(rb"Orig\.\s*start\s*::\s*(\d+)")
_ORIG_END_RE = re.compile(rb"Orig\.\s*end\s*::\s*(\d+)")
_LOC_RANGE_RE = re.compile(rb"(\d+)\.\.(\d+)")

_FEAT_HEADER_PREFIX = b"     "
_QUAL_PREFIX = b"                     "


def _strip_quotes(b: bytes) -> str:
    s = b.strip()
    if len(s) >= 2 and s[:1] == b'"' and s[-1:] == b'"':
        s = s[1:-1]
    return s.decode("utf-8", errors="replace")


def parse_gbk_bytes(data: bytes) -> dict[str, Any]:
    out: dict[str, Any] = {
        "record_id": None,
        "region": None,
        "bgc_length": None,
        "contig_length": None,
        "orig_start": None,
        "orig_end": None,
        "contig_edge": None,
        "products": [],
        "categories": [],
        "cand_kinds": [],
        "n_protoclusters": 0,
        "proto_core_span_bp": 0,
        "cds_count": 0,
        "n_biosynthetic": 0,
        "n_biosynthetic_add": 0,
        "n_regulatory": 0,
        "n_transport": 0,
        "n_resistance": 0,
        "n_other": 0,
        "hypothetical_count": 0,
        "n_pfam_domain": 0,
        "n_asdomain": 0,
        "n_asmodule": 0,
        "asdomain_types_ordered": [],
        "sec_met_domains": [],
        "core_gene_types": [],
        "ordered_asdomain_string": "",
        "warnings": [],
    }

    m = _LOCUS_RE.search(data)
    if m:
        out["record_id"] = m.group(1).decode("utf-8", errors="replace")
        out["bgc_length"] = int(m.group(2))

    m = _DEF_RE.search(data)
    if m:
        defn = b" ".join(m.group(1).split())
        lm = _DEF_LEN_RE.search(defn)
        if lm:
            out["contig_length"] = int(lm.group(1))
    # Orig. length is authoritative and overrides the DEFINITION length.
    om = _ORIG_LEN_RE.search(data)
    if om:
        out["contig_length"] = int(om.group(1))
    sm = _ORIG_START_RE.search(data)
    if sm:
        out["orig_start"] = int(sm.group(1))
    em = _ORIG_END_RE.search(data)
    if em:
        out["orig_end"] = int(em.group(1))

    feat_marker = data.find(b"\nFEATURES ")
    if feat_marker == -1:
        out["warnings"].append("no-features-section")
        return out
    origin = data.find(b"\nORIGIN", feat_marker)
    if origin == -1:
        origin = len(data)
    feat = data[feat_marker:origin]
    lines = feat.split(b"\n")

    cur_type: bytes | None = None
    cur_loc: bytes = b""
    cur_quals: dict[bytes, list[bytes]] = {}
    cur_qname: bytes | None = None
    cur_qval_parts: list[bytes] = []

    sec_met_domain_seen: set[str] = set()
    core_gene_types_seen: set[str] = set()

    def flush_qualifier() -> None:
        nonlocal cur_qname, cur_qval_parts
        if cur_qname is not None:
            cur_quals.setdefault(cur_qname, []).append(b"".join(cur_qval_parts))
            cur_qname = None
            cur_qval_parts = []

    def flush_feature() -> None:
        nonlocal cur_type, cur_loc, cur_quals
        if cur_type is None:
            return
        flush_qualifier()
        t = cur_type

        if t == b"region":
            ce = cur_quals.get(b"contig_edge")
            if ce:
                out["contig_edge"] = _strip_quotes(ce[0]).lower() == "true"
            for v in cur_quals.get(b"product", []):
                out["products"].append(_strip_quotes(v))
            rn = cur_quals.get(b"region_number")
            if rn:
                try:
                    out["region"] = int(_strip_quotes(rn[0]))
                except ValueError:
                    pass

        elif t == b"cand_cluster":
            for v in cur_quals.get(b"kind", []):
                out["cand_kinds"].append(_strip_quotes(v))

        elif t == b"protocluster":
            out["n_protoclusters"] += 1
            for v in cur_quals.get(b"category", []):
                out["categories"].append(_strip_quotes(v))

        elif t == b"proto_core":
            for lm in _LOC_RANGE_RE.finditer(cur_loc):
                a, b_ = int(lm.group(1)), int(lm.group(2))
                out["proto_core_span_bp"] += max(0, b_ - a + 1)
                break

        elif t == b"CDS":
            out["cds_count"] += 1
            gk_list = cur_quals.get(b"gene_kind", [])
            gk = _strip_quotes(gk_list[0]) if gk_list else ""
            if gk == "biosynthetic":
                out["n_biosynthetic"] += 1
            elif gk == "biosynthetic-additional":
                out["n_biosynthetic_add"] += 1
            elif gk == "regulatory":
                out["n_regulatory"] += 1
            elif gk == "transport":
                out["n_transport"] += 1
            elif gk == "resistance":
                out["n_resistance"] += 1
            else:
                out["n_other"] += 1

            prod_list = cur_quals.get(b"product", [])
            if prod_list and _strip_quotes(prod_list[0]).lower().startswith("hypothetical"):
                out["hypothetical_count"] += 1

            for sm in cur_quals.get(b"sec_met_domain", []):
                v = _strip_quotes(sm).split("(", 1)[0].strip()
                if v:
                    if v not in sec_met_domain_seen:
                        sec_met_domain_seen.add(v)
                        out["sec_met_domains"].append(v)
                    if gk == "biosynthetic" and v not in core_gene_types_seen:
                        core_gene_types_seen.add(v)
                        out["core_gene_types"].append(v)

        elif t == b"aSDomain":
            out["n_asdomain"] += 1
            # Only nrps_pks_domains aSDomains form the assembly line; other tools (TIGRFAM,
            # RREfinder) would pollute the ordered architecture string.
            astool = cur_quals.get(b"aSTool")
            if astool and _strip_quotes(astool[0]) == "nrps_pks_domains":
                for v in cur_quals.get(b"aSDomain", []):
                    name = _strip_quotes(v)
                    if name:
                        out["asdomain_types_ordered"].append(name)

        elif t == b"PFAM_domain":
            out["n_pfam_domain"] += 1

        elif t == b"aSModule":
            out["n_asmodule"] += 1

        cur_type = None
        cur_loc = b""
        cur_quals = {}

    for line in lines:
        if line.startswith(_QUAL_PREFIX):
            payload = line[len(_QUAL_PREFIX):]
            if payload.startswith(b"/"):
                flush_qualifier()
                eq = payload.find(b"=")
                if eq == -1:
                    cur_qname = payload[1:]
                    cur_qval_parts = []
                else:
                    cur_qname = payload[1:eq]
                    cur_qval_parts = [payload[eq + 1:]]
            else:
                if cur_qname is not None:
                    cur_qval_parts.append(payload)
        elif line.startswith(_FEAT_HEADER_PREFIX):
            flush_feature()
            rest = line[len(_FEAT_HEADER_PREFIX):]
            sp = rest.find(b" ")
            if sp == -1:
                cur_type = rest
                cur_loc = b""
            else:
                cur_type = rest[:sp]
                cur_loc = rest[sp:].lstrip()

    flush_feature()
    out["ordered_asdomain_string"] = "-".join(out["asdomain_types_ordered"])
    return out


def parse_gbk_file(path: str) -> dict[str, Any]:
    with open(path, "rb") as f:
        return parse_gbk_bytes(f.read())
