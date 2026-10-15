import json
from pathlib import Path
from typing import Iterator
from ..core.record import Record
from ..ids import scoped
from .archive import archive_stem, load_regions_json
from .antismash_json import parse_regions
from ._antismash_emit import emit_antismash
from .anchors import region_anchor_map

SOURCE = "metalog"                    # unit.key, nk scoping
SOURCE_TYPE = "third_party"
# Must match production exactly. metalog data comes via SPIRE, so each archive also
# declares the SPIRE data_source.
DATA_SOURCE = "metalog"
DATA_SOURCE_DESC = "Compiled environmental metadata (core/extended wide + long)"
DATA_SOURCE_URL = "https://metalog.embl.de/"
SPIRE_DESC = "SPIRE catalogs and MAG archives (placeholder assemblies)"
SPIRE_URL = "https://spire.embl.de"
MEASUREMENT_SOURCE = "metalog_long_all"

_ENV_CACHE = {}

def _get_env_lookup(path, measurements_path=None, key_by_code=(), required_codes=()):
    cache_key = (path, measurements_path, tuple(sorted(key_by_code)),
                 tuple(sorted(required_codes)))
    lk = _ENV_CACHE.get(cache_key)
    if lk is None:
        from .metalog_metadata import load_env_metadata
        lk = load_env_metadata(path, measurements_path, key_by_code, required_codes)
        _ENV_CACHE[cache_key] = lk
    return lk


def _unpack_dataset(dataset):
    """The env wide-file path (str, back-compat) or {"env": ..., "measurements": ...,
    "study_overrides": {"key_by_code": [code, ...], "existing": {code: study nk}}}."""
    if isinstance(dataset, dict):
        return (dataset.get("env"), dataset.get("measurements"),
                dataset.get("study_overrides") or {})
    return dataset, None, {}


def emit_archive(archive_path: str, dataset=None) -> Iterator[Record]:
    env_path, measurements_path, overrides = _unpack_dataset(dataset)
    sample = archive_stem(archive_path)          # e.g. "5O_Y1.1": no suffix strip
    nk = scoped(SOURCE, sample)
    file_path = str(Path(archive_path).resolve())
    sample_fields = None
    biome_links = []
    study_link = None
    study_code = None
    measurements = []
    if env_path:
        env = _get_env_lookup(env_path, measurements_path,
                              overrides.get("key_by_code") or (),
                              tuple(overrides.get("existing") or {}))
        sample_fields = env.fields_for(sample)
        biome_links = env.biomes_for(sample)
        study_link = env.study_for(sample)
        study_code = env.study_code_for(sample)
        measurements = env.measurements_for(sample)
        # setdefault: an explicit wide-file value wins over the KV fallback.
        if measurements:
            from .env_analytes import consolidate
            consolidated = consolidate(measurements)
            if consolidated:
                if sample_fields is None:
                    sample_fields = {}
                for col, val in consolidated.items():
                    sample_fields.setdefault(col, val)
    data = load_regions_json(archive_path)
    regions = list(parse_regions(data))
    anchor_map = region_anchor_map(file_path)
    yield from emit_antismash(
        source=DATA_SOURCE, source_type=SOURCE_TYPE, source_description=DATA_SOURCE_DESC,
        source_url=DATA_SOURCE_URL,
        nk=nk, name=sample, base_name=sample, file_path=file_path,
        regions=regions, run_name=sample, sample_fields=sample_fields,
        anchor_map=anchor_map)
    yield Record("data_sources", "SPIRE",
                 {"name": "SPIRE", "source_type": "third_party",
                  "description": SPIRE_DESC, "source_url": SPIRE_URL}, {})
    for b_nk, name, envo_id, from_field in biome_links:
        meta = json.dumps({"envo_id": envo_id, "from_field": from_field},
                          separators=(",", ":"))
        yield Record("biomes", b_nk, {"name": name, "metadata": meta}, {})
        yield Record("sample_biomes", f"{nk}|{b_nk}", {},
                     refs={"sample_id": ("samples", nk), "biome_id": ("biomes", b_nk)})
    if study_link:
        study_key, study_fields = study_link
        existing = (overrides.get("existing") or {}).get(study_code)
        if existing:
            # a study already in the DB under another source (e.g. the MGnify study of
            # the same BioProject): link to its nk; the fields-less stub row is inserted
            # ON CONFLICT DO NOTHING, so the existing row is never overwritten. A loader
            # must ASSERT every fields-less studies row already exists: a wrong target
            # would otherwise insert a nameless study.
            st_nk = existing
            study_fields = {}
        else:
            st_nk = scoped(SOURCE, study_key)
        yield Record("studies", st_nk, study_fields, {})
        yield Record("study_samples", f"{st_nk}|{nk}", {},
                     refs={"study_id": ("studies", st_nk), "sample_id": ("samples", nk)})
    # nk = sample|key keeps (sample, key) unique; the DB has no UNIQUE for it.
    for key, value in measurements:
        yield Record("sample_measurements", f"{nk}|{key}",
                     {"key": key, "value": value, "source": MEASUREMENT_SOURCE},
                     refs={"sample_id": ("samples", nk)})
