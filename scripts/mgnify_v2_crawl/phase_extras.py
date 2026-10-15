"""Phase D: biomes, publications, super_studies, genome_catalogues and genomes.

Each sub-crawl is guarded, so one failing collection does not abort the rest.
List-level types are written straight from the list and skip keys already on disk;
they do not touch the resume log.
"""

import itertools
import shutil
from pathlib import Path

from scripts.mgnify_v2_crawl import config
from scripts.mgnify_v2_crawl.client import get_json
from scripts.mgnify_v2_crawl.fetch import fetch_entities
from scripts.mgnify_v2_crawl.paginate import iter_pages
from scripts.mgnify_v2_crawl.writer import BundleWriter, read_keys


def _capped_pages(list_path, *, get, max_pages):
    it = iter_pages(list_path, get=get)
    if max_pages is not None:
        it = itertools.islice(it, max_pages)
    return it


def _write_list_collection(out_dir, entity_type, list_path, key_field, *, get, max_pages=None):
    """Keys are stringified (pubmed ids are ints) for a stable skip-set. An item missing
    ``key_field`` is skipped with a warning, or it would wedge every rerun.
    """
    bundle_path = out_dir / f"{entity_type}.jsonl.gz"
    part_path = out_dir / f"{entity_type}.jsonl.gz.part"
    skip = read_keys(bundle_path) | read_keys(part_path)

    # Seed .part from an existing finalized bundle so finalize is a superset.
    if bundle_path.exists() and not part_path.exists():
        shutil.copyfile(bundle_path, part_path)

    endpoint = config.BASE_URL + list_path
    writer = BundleWriter(out_dir, entity_type)
    requested = written = skipped = skipped_malformed = 0
    try:
        for item in _capped_pages(list_path, get=get, max_pages=max_pages):
            requested += 1
            raw_key = item.get(key_field)
            if raw_key is None:
                skipped_malformed += 1
                snippet = repr(item)[:200]
                print(
                    f"[phase_extras] WARN {entity_type}: item missing "
                    f"'{key_field}', skipping: {snippet}"
                )
                continue
            key = str(raw_key)
            if key in skip:
                skipped += 1
                continue
            writer.write(key, endpoint, item)
            skip.add(key)  # in-stream duplicates
            written += 1
    finally:
        writer.finalize()
    return {
        "requested": requested,
        "written": written,
        "skipped": skipped,
        "skipped_malformed": skipped_malformed,
    }


def _detail_collection(out_dir, entity_type, list_path, key_field, detail_path_fn, resume, *, get, max_pages=None):
    keys = [item[key_field] for item in _capped_pages(list_path, get=get, max_pages=max_pages)]
    return fetch_entities(entity_type, keys, detail_path_fn, resume, out_dir, get=get)


def _sub_biomes(out_dir, resume, get, max_pages):
    return _write_list_collection(out_dir, "biomes", "biomes/", "lineage", get=get, max_pages=max_pages)


def _sub_publications(out_dir, resume, get, max_pages):
    return _write_list_collection(out_dir, "publications", "publications/", "pubmed_id", get=get, max_pages=max_pages)


def _sub_super_studies(out_dir, resume, get, max_pages):
    return _detail_collection(
        out_dir, "super_studies", "super-studies/", "slug",
        lambda s: f"super-studies/{s}", resume, get=get, max_pages=max_pages,
    )


def _sub_genome_catalogues(out_dir, resume, get, max_pages):
    return _detail_collection(
        out_dir, "genome_catalogues", "genomes/catalogues/", "catalogue_id",
        lambda i: f"genomes/catalogues/{i}", resume, get=get, max_pages=max_pages,
    )


def _sub_genomes(out_dir, resume, get, max_pages):
    return _write_list_collection(out_dir, "genomes", "genomes/", "accession", get=get, max_pages=max_pages)


_SUBTYPES = (
    ("biomes", _sub_biomes),
    ("publications", _sub_publications),
    ("super_studies", _sub_super_studies),
    ("genome_catalogues", _sub_genome_catalogues),
    ("genomes", _sub_genomes),
)


def run(out_dir, resume, *, get=get_json, max_pages=None) -> dict:
    """``max_pages`` caps each LIST scan (dry-run). A failing sub-type is recorded as
    ``{"error": ...}`` and the rest still run.
    """
    out_dir = Path(out_dir)
    stats = {}
    for name, builder in _SUBTYPES:
        try:
            stats[name] = builder(out_dir, resume, get, max_pages)
        except Exception as exc:  # noqa: BLE001 - isolate each sub-type's failure
            stats[name] = {"error": str(exc)}
    return stats
