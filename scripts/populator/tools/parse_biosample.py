"""Parse NCBI BioSample efetch XML into per-accession sample fields.

Only an unambiguous full ``collection_date`` becomes a date; coarser or unparseable
values go to ``_extras['collection_date_raw']`` rather than inventing a day.
"""
import re
import xml.etree.ElementTree as ET
from datetime import datetime
from typing import Dict, Optional, Tuple

from scripts.populator.adapters.gtdb_metadata import parse_lat_lon

# MIxS revisions use different names for the same field.
_HARM = {
    "collection_date": "collection_date",
    "geo_loc_name": "geo_loc_name",
    "lat_lon": "lat_lon",
    "env_broad_scale": "env_broad_scale", "env_biome": "env_broad_scale",
    "env_local_scale": "env_local_scale", "env_feature": "env_local_scale",
    "env_medium": "env_medium", "env_material": "env_medium",
    "host": "host",
    "depth": "depth",
    "isolation_source": "isolation_source",
}

_MISSING = {
    "", "none", "missing", "not applicable", "not collected", "n/a", "na", "null",
    "unknown", "not provided", "not available", "not determined", "-", "--",
    "uncalculated", "restricted access", "not specified", "not known",
}


def clean_attr(v: Optional[str]) -> Optional[str]:
    v = (v or "").strip()
    return v if v and v.lower() not in _MISSING else None


def parse_collection_date(s: Optional[str]) -> Tuple[Optional[str], Optional[str]]:
    """Return (iso_date, raw): iso_date only for an unambiguous full date, otherwise
    raw holds the cleaned original. Ranges 'a/b' use the start."""
    c = clean_attr(s)
    if c is None:
        return None, None
    head = c.split("/")[0].strip()            # date range -> start
    head = head.split("T")[0].strip()
    for fmt in ("%Y-%m-%d", "%Y/%m/%d", "%d-%b-%Y", "%d-%B-%Y", "%b-%d-%Y"):
        try:
            return datetime.strptime(head, fmt).strftime("%Y-%m-%d"), None
        except ValueError:
            continue
    return None, c                            # coarser than a day, or unparseable


def parse_depth(s: Optional[str]) -> dict:
    """Leading numeric metre value -> {'depth'}; an 'a-b' range -> depth_min/max_meters."""
    c = clean_attr(s)
    if c is None:
        return {}
    # no leading sign: a hyphen in "0-5 m" is a range separator, not a minus
    nums = re.findall(r"\d+(?:\.\d+)?", c)
    if len(nums) == 1:
        return {"depth": float(nums[0])}
    if len(nums) >= 2:
        lo, hi = float(nums[0]), float(nums[1])
        return {"depth_min_meters": min(lo, hi), "depth_max_meters": max(lo, hi)}
    return {}


# RefSeq annotation umbrella that GTDB lists for every RefSeq genome; not a real study.
REFSEQ_UMBRELLA = "PRJNA224116"


def parse_biosample_bioprojects(xml) -> Dict[str, str]:
    """{biosample_accession: bioproject} from the BioSample's own bioproject links
    (the submitter's project), preferring a non-umbrella one."""
    root = ET.fromstring(xml.encode() if isinstance(xml, str) else xml)
    out: Dict[str, str] = {}
    for bs in root.iter("BioSample"):
        acc = _biosample_accession(bs)
        if not acc:
            continue
        # only accept PRJ accessions (a few old records carry a bare numeric uid label)
        links = [l.get("label") for l in bs.findall("./Links/Link")
                 if l.get("target") == "bioproject"
                 and (l.get("label") or "").startswith("PRJ")]
        if not links:
            continue
        out[acc] = next((l for l in links if l != REFSEQ_UMBRELLA), links[0])
    return out


def _biosample_accession(bs) -> Optional[str]:
    acc = (bs.get("accession") or "").strip()
    if acc:
        return acc
    for idel in bs.findall("./Ids/Id"):
        if idel.get("db") == "BioSample" and (idel.text or "").strip():
            return idel.text.strip()
    return None


def parse_biosample_set(xml) -> Dict[str, dict]:
    """{biosample_accession: sample_fields}: column-ready keys plus ``_extras`` for
    the metadata JSONB. BioSamples with nothing usable are omitted."""
    root = ET.fromstring(xml.encode() if isinstance(xml, str) else xml)
    out: Dict[str, dict] = {}
    for bs in root.iter("BioSample"):
        acc = _biosample_accession(bs)
        if not acc:
            continue
        attrs: Dict[str, str] = {}
        for a in bs.findall("./Attributes/Attribute"):
            key = _HARM.get(a.get("harmonized_name") or "")
            val = clean_attr(a.text)
            if key and val is not None:
                attrs.setdefault(key, val)     # first non-empty wins across aliases
        f, extras = {}, {}
        if "geo_loc_name" in attrs:
            f["geographic_location"] = attrs["geo_loc_name"]
        if "lat_lon" in attrs:
            lat, lon = parse_lat_lon(attrs["lat_lon"])
            if lat is not None:
                f["latitude"], f["longitude"] = lat, lon
        if "env_broad_scale" in attrs:
            f["environment_biome"] = attrs["env_broad_scale"]
        if "env_local_scale" in attrs:
            f["environment_feature"] = attrs["env_local_scale"]
        if "env_medium" in attrs:
            f["environment_material"] = attrs["env_medium"]
        if "host" in attrs:
            f["host_scientific_name"] = attrs["host"]
        if "collection_date" in attrs:
            iso, raw = parse_collection_date(attrs["collection_date"])
            if iso:
                f["collection_date"] = iso
            elif raw:
                extras["collection_date_raw"] = raw
        if "depth" in attrs:
            f.update(parse_depth(attrs["depth"]))
        if "isolation_source" in attrs:
            extras["isolation_source"] = attrs["isolation_source"]
        if extras:
            f["_extras"] = extras
        if f:
            out[acc] = f
    return out
