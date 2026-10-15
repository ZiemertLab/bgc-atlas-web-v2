import logging
from pathlib import Path
from typing import Iterator
from ..core.record import Record
from ..ids import scoped
from .antismash_json import parse_regions
from .archive import archive_stem, load_regions_json
from ._antismash_emit import bgc_records, antismash_run_record, assembly_analyses_record
from .anchors import region_anchor_map

log = logging.getLogger("populator")

SOURCE = "mgnify"                     # unit.key, nk scoping
SOURCE_TYPE = "third_party"
# Must match the production data_sources row exactly.
DATA_SOURCE = "MGnify"
DATA_SOURCE_DESC = "MGnify - EMBL-EBI metagenomics analysis platform"
DATA_SOURCE_URL = "https://www.ebi.ac.uk/metagenomics/"

# Assembly and analysis nks are scoped("mgnify", <accession>), split from
# run_key.partition("_"). The metadata dump emitters must key the same way, or the
# junction FKs orphan.


def _emit_run_records(run_key: str, regions: list, file_path: str,
                      metadata_dir=None) -> Iterator[Record]:
    """The minimal assembly/analysis rows are FK targets and a fallback for assemblies
    absent from the dump; the dump's rich rows overwrite them (last write wins).

    analysis = the MGYA part before the first "_"; assembly = the rest, e.g. "ERZ312747"
    or "FAUS01000001-FAUS01000008".
    """
    # metadata_dir is unused; kept so the AdapterSpec can keep threading `dataset` through.
    analysis_acc, _, assembly_acc = run_key.partition("_")
    if not assembly_acc:
        raise ValueError(f"mgnify run_key {run_key!r} has no assembly part after '_'")
    a_nk = scoped(SOURCE, analysis_acc)
    asm_nk = scoped(SOURCE, assembly_acc)

    yield Record("data_sources", DATA_SOURCE,
                 {"name": DATA_SOURCE, "source_type": SOURCE_TYPE,
                  "description": DATA_SOURCE_DESC, "source_url": DATA_SOURCE_URL}, {})
    yield Record("assemblies", asm_nk,
                 {"accession": assembly_acc, "name": assembly_acc,
                  "source_type": "metagenome"}, {})
    yield Record("analyses", a_nk,
                 {"accession": analysis_acc, "name": analysis_acc,
                  "analysis_type": "antismash", "tool_name": "antiSMASH"}, {})
    yield antismash_run_record(file_path, run_key, len(regions),
                               (regions[0].taxon if regions else None), asm_nk, a_nk)
    yield assembly_analyses_record(asm_nk, a_nk)
    anchor_map = region_anchor_map(file_path)
    yield from bgc_records(run_key, regions, asm_nk, a_nk, file_path, anchor_map=anchor_map)


def emit_run_archive(archive_path: str, metadata_dir=None) -> Iterator[Record]:
    """The tarball stem is the run_key and must keep the <analysis>_<assembly> shape."""
    run_key = archive_stem(archive_path)
    data = load_regions_json(archive_path)
    regions = list(parse_regions(data))
    file_path = str(Path(archive_path).resolve())
    yield from _emit_run_records(run_key, regions, file_path, metadata_dir)


def emit_metadata_dump(metadata_dir) -> Iterator[Record]:
    """Authoritative metadata; runs after the BGC tarballs so its rows overwrite the
    placeholders (last write wins)."""
    from .mgnify_dump import iter_entities
    from . import mgnify_dump_emit as de
    base = Path(metadata_dir)
    stages = [("assemblies.tar.gz", de.emit_assembly), ("analyses.tar.gz", de.emit_analysis),
              ("runs.tar.gz", de.emit_run), ("samples.tar.gz", de.emit_sample),
              ("studies.tar.gz", de.emit_study)]
    for fname, emit in stages:
        p = base / fname
        if not p.exists():
            log.warning("mgnify dump: %s missing under %s — skipping", fname, base)
            continue
        for acc, obj in iter_entities(p):
            yield from emit(acc, obj)
