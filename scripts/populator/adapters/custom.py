import re
from pathlib import Path
from typing import Iterator
from ..core.record import Record
from ..ids import scoped
from .archive import archive_stem, derive_alias, load_json
from .antismash_json import parse_regions
from ._antismash_emit import emit_antismash
from .anchors import region_anchor_map
from . import customs_metadata, mfd_metadata

def source_name(dataset: str) -> str:
    return "custom_" + re.sub(r"[^0-9a-z]+", "_", dataset.lower()).strip("_")

def emit_archive(archive_path: str, dataset: str) -> Iterator[Record]:
    src = source_name(dataset)
    alias = derive_alias(archive_stem(archive_path))
    nk = scoped(src, alias)
    file_path = str(Path(archive_path).resolve())

    data = load_json(archive_path)
    regions = list(parse_regions(data))
    anchor_map = region_anchor_map(file_path)

    # Microflora Danica samples (alias == MFDxxxxx barcode) get the shared MFD enrichment.
    is_mfd = src == mfd_metadata.CUSTOM_SOURCE_NAME
    sample_fields = None
    source_url = None
    if is_mfd:
        sample_fields = mfd_metadata.enrichment_for(alias, "custom")
        source_url = mfd_metadata.MFD_SOURCE_URL
    # Datasets loaded with their BioSample metadata (customs_metadata.EMIT_SOURCES); the older
    # customs are filled after the load by tools/backfill_customs_metadata.py instead.
    emitted = customs_metadata.emit_enrichment(src, alias)
    if emitted:
        sample_fields, source_url = emitted

    yield from emit_antismash(
        source=src, source_type="custom",
        source_description=f"Custom dataset: {dataset}", source_url=source_url,
        nk=nk, name=alias, base_name=alias, file_path=file_path,
        regions=regions, run_name=archive_stem(file_path),
        sample_fields=sample_fields, anchor_map=anchor_map)

    # Same study nk as the long-read MAGs, so they dedup to one PRJEB58634 study.
    if is_mfd:
        st_nk, study_payload = mfd_metadata.mfd_study("custom")
        yield Record("studies", st_nk, study_payload, {})
        yield Record("study_samples", f"{st_nk}|{nk}", {},
                     refs={"study_id": ("studies", st_nk), "sample_id": ("samples", nk)})
