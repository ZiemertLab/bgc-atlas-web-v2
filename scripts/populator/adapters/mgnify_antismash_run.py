"""Adapter for net-new MGnify antiSMASH runs (``ERZ<acc>.tar.gz`` with a consolidated JSON).

The ERZ assemblies and their metadata are already loaded, so only BGC-side records are
emitted. The assembly nk scoped("mgnify", "ERZ<acc>") resolves to the loaded assembly's
UUID, and a fresh per-ERZ antiSMASH analysis is created (the MGnify pipeline analyses
are not antiSMASH, and there can be up to 40 per assembly).

The minimal ``assemblies`` Record exists only so ``assembly_analyses`` survives
``drop_dangling_junctions``; the incremental load does not copy it.
"""
import logging
from pathlib import Path
from typing import Iterator

from ..core.record import Record
from ..ids import scoped
from .antismash_json import parse_regions
from .archive import archive_stem, load_json
from ._antismash_emit import bgc_records, antismash_run_record, assembly_analyses_record
from .anchors import region_anchor_map
from .mgnify import (SOURCE, SOURCE_TYPE, DATA_SOURCE, DATA_SOURCE_DESC,
                     DATA_SOURCE_URL)

log = logging.getLogger("populator")

# Output subdir and _PROVENANCE key. SOURCE must stay "mgnify" so the UUIDs match the
# loaded rows.
UNIT_KEY = "mgnify_new"


def emit_run_archive(archive_path: str, dataset=None) -> Iterator[Record]:
    """``dataset`` is ignored; accepted so the AdapterSpec can thread it uniformly."""
    run_key = archive_stem(archive_path)                 # "ERZ<acc>"
    data = load_json(archive_path)
    regions = list(parse_regions(data))
    file_path = str(Path(archive_path).resolve())

    asm_nk = scoped(SOURCE, run_key)
    an_nk = scoped(SOURCE, f"{run_key}|antismash")

    yield Record("data_sources", DATA_SOURCE,
                 {"name": DATA_SOURCE, "source_type": SOURCE_TYPE,
                  "description": DATA_SOURCE_DESC, "source_url": DATA_SOURCE_URL}, {})
    yield Record("assemblies", asm_nk,
                 {"accession": run_key, "name": run_key,
                  "source_type": "metagenome"}, {})
    yield Record("analyses", an_nk,
                 {"accession": run_key, "name": f"{run_key} antiSMASH",
                  "analysis_type": "antismash", "tool_name": "antiSMASH"}, {})
    yield antismash_run_record(file_path, run_key, len(regions),
                               (regions[0].taxon if regions else None), asm_nk, an_nk)
    yield assembly_analyses_record(asm_nk, an_nk)
    anchor_map = region_anchor_map(file_path)
    yield from bgc_records(run_key, regions, asm_nk, an_nk, file_path, anchor_map=anchor_map)
