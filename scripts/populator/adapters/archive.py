import json, tarfile
from pathlib import Path
from typing import Optional

_STRIP = ("-contigs", "-CONTIGS", "_assembly")

def derive_alias(stem: str) -> str:
    for suf in _STRIP:
        if stem.endswith(suf):
            return stem[: -len(suf)]
    return stem

def archive_stem(path) -> str:
    name = Path(path).name
    for suf in (".tar.gz", ".tgz", ".tar"):
        if name.endswith(suf):
            return name[: -len(suf)]
    return Path(name).stem

def find_json_member(tar: tarfile.TarFile) -> Optional[str]:
    """Prefer <topdir>/<topdir>.json; fall back to the first *.json not named *_regions.json."""
    best = None
    for m in tar.getmembers():
        if m.isfile() and m.name.endswith(".json") and not m.name.endswith("_regions.json"):
            base = m.name.rsplit("/", 1)[-1]
            top = m.name.split("/", 1)[0]
            if base == f"{top}.json":
                return m.name
            best = best or m.name
    return best

def load_json(path) -> dict:
    with tarfile.open(path, "r:gz") as t:
        member = find_json_member(t)
        if not member:
            raise FileNotFoundError(f"no antiSMASH JSON in {path}")
        with t.extractfile(member) as fh:
            return json.loads(fh.read().decode("utf-8"))

def find_regions_json_member(tar: tarfile.TarFile):
    for m in tar.getmembers():
        if m.isfile() and m.name.endswith("_regions.json"):
            return m.name
    return None

def load_regions_json(archive_path) -> dict:
    with tarfile.open(archive_path, "r:gz") as t:
        member = find_regions_json_member(t)
        if not member:
            raise FileNotFoundError(f"no *_regions.json in {archive_path}")
        with t.extractfile(member) as fh:
            return json.loads(fh.read().decode("utf-8"))
