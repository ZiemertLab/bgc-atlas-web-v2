"""Reader and JSON:API helpers for the MGnify metadata dump bundles.

Always read the bundles via `iter_entities`: streaming a tarball takes seconds, while
scanning the unpacked dir on ceph takes over 15 minutes.
"""
import json
import os
import tarfile
from typing import Iterator, List, Optional, Tuple


def iter_entities(tar_path: "str | os.PathLike") -> Iterator[Tuple[str, dict]]:
    with tarfile.open(tar_path, "r:*") as tar:
        for member in tar:
            if not member.isfile() or not member.name.endswith(".json"):
                continue
            f = tar.extractfile(member)
            if f is None:
                continue
            try:
                obj = json.load(f)
            except json.JSONDecodeError as e:
                raise ValueError(f"{tar_path}:{member.name}: {e}") from e
            accession = os.path.basename(member.name)[: -len(".json")]
            yield accession, obj


def _rel(obj: dict, rel: str) -> dict:
    rels = obj.get("relationships")
    if not isinstance(rels, dict):
        return {}
    r = rels.get(rel)
    return r if isinstance(r, dict) else {}


def attr(obj: dict, key: str):
    attrs = obj.get("attributes")
    return attrs.get(key) if isinstance(attrs, dict) else None


def self_link(obj: dict) -> Optional[str]:
    links = obj.get("links")
    return links.get("self") if isinstance(links, dict) else None


def rel_one(obj: dict, rel: str) -> Optional[str]:
    d = _rel(obj, rel).get("data")
    return d.get("id") if isinstance(d, dict) else None


def rel_type(obj: dict, rel: str) -> Optional[str]:
    d = _rel(obj, rel).get("data")
    return d.get("type") if isinstance(d, dict) else None


def rel_many(obj: dict, rel: str) -> List[str]:
    d = _rel(obj, rel).get("data")
    if not isinstance(d, list):
        return []
    return [e["id"] for e in d if isinstance(e, dict) and "id" in e]


def links_related(obj: dict, rel: str) -> Optional[str]:
    links = _rel(obj, rel).get("links")
    return links.get("related") if isinstance(links, dict) else None
