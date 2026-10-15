import functools
import json
from pathlib import Path
from typing import Iterator
from ..core.record import Record
from ..ids import scoped
from .antismash_gbk import parse_region_dir, parse_region_tar
from ._antismash_emit import emit_antismash
from .anchors import region_anchor_map

# Bioproject values treated as "no study" -> GTDB_UNASSIGNED.
_UNASSIGNED_BIOPROJECT = {"na", "n/a", "none", "null", ""}

SOURCE = "gtdb"                       # unit.key, nk scoping
SOURCE_TYPE = "third_party"
# Must match the production data_sources row exactly.
DATA_SOURCE = "GTDB"
DATA_SOURCE_DESC = "GTDB High Quality Genomes"
DATA_SOURCE_URL = "https://gtdb.ecogenomic.org/"
DEFAULT_GENOME_SOURCE_TYPE = "isolate"

# Per-process caches keyed by path, so each big file loads once per worker.
_META_CACHE = {}
_BAC120_CACHE = {}
_ENRICH_CACHE = {}


def _get_meta(path):
    if path not in _META_CACHE:
        from .gtdb_metadata import load_gtdb_metadata
        _META_CACHE[path] = load_gtdb_metadata(path)
    return _META_CACHE[path]


def _get_bac120(path):
    if path not in _BAC120_CACHE:
        from .gtdb_metadata import load_bac120_sample_meta
        _BAC120_CACHE[path] = load_bac120_sample_meta(path)
    return _BAC120_CACHE[path]


def _get_enrichment(path):
    if path not in _ENRICH_CACHE:
        from .gtdb_metadata import load_gtdb_enrichment
        _ENRICH_CACHE[path] = load_gtdb_enrichment(path)
    return _ENRICH_CACHE[path]


def _unpack_dataset(dataset):
    """The hq_mimag path (str, back-compat) or a dict with keys metadata, bac120,
    enrichment (supersedes bac120), runs_tar_dir and rerun_tar_dir."""
    if isinstance(dataset, dict):
        return (dataset.get("metadata"), dataset.get("bac120"),
                dataset.get("enrichment"), dataset.get("runs_tar_dir"),
                dataset.get("rerun_tar_dir"))
    return dataset, None, None, None, None


@functools.lru_cache(maxsize=4)
def _rerun_genomes(rerun_tar_dir: str) -> frozenset:
    """Genomes with a re-run tarball, listed once rather than stat-ed per genome."""
    return frozenset(p.name[:-len(".tar.gz")] for p in Path(rerun_tar_dir).glob("*.tar.gz"))


def emit_genome_dir(genome_dir: str, dataset=None) -> Iterator[Record]:
    """A gtdb genome is an extracted dir of per-region GBKs (no JSON); the genome is
    sample, assembly and analysis at once.
    """
    metadata_path, bac120_path, enrichment_path, runs_tar_dir, rerun_tar_dir = _unpack_dataset(dataset)
    genome_dir = Path(genome_dir)
    genome = genome_dir.name
    nk = scoped(SOURCE, genome)
    if rerun_tar_dir and genome in _rerun_genomes(rerun_tar_dir):
        # The original run of this genome never happened (its dir is empty); the re-run's
        # tarball replaces it, as the run of the same sample/assembly/analysis.
        file_path = str(Path(rerun_tar_dir) / f"{genome}.tar.gz")
        regions = parse_region_tar(file_path)
    else:
        regions = parse_region_dir(genome_dir)
        # The Cluster Viewer extracts file_path with tar, and it is the run's natural key.
        # The tarball must be the same run as genome_dir: regions come from the dir, anchors
        # from the tarball's regions.js.
        file_path = (str(Path(runs_tar_dir) / f"{genome}.tar.gz")
                     if runs_tar_dir else str(genome_dir.resolve()))
    source_type = DEFAULT_GENOME_SOURCE_TYPE
    category = None
    taxonomy_lineage = None
    taxonomy_fields = None
    if metadata_path:
        hit = _get_meta(metadata_path).get(genome)
        if hit:
            source_type, lineage = hit
            category = source_type
            if lineage:
                from .gtdb_metadata import parse_gtdb_lineage
                taxonomy_fields = parse_gtdb_lineage(lineage)
                taxonomy_lineage = taxonomy_fields["gtdb_lineage"]
    sample_fields = None
    bioproject = None
    study_title = None
    if enrichment_path:
        # Only genomes with a real BioProject get a study here (no GTDB_UNASSIGNED).
        hit = _get_enrichment(enrichment_path).get(genome)
        if hit:
            sf_cols, md, bp, title = hit
            sample_fields = dict(sf_cols)
            if md:
                sample_fields["metadata"] = json.dumps(md, separators=(",", ":"))
            bioproject = bp or None
            study_title = title or None
    elif bac120_path:
        sf = _get_bac120(bac120_path).get(genome)
        if sf:
            md = json.loads(sf["metadata"]) if sf.get("metadata") else {}
            # A single accession (not comma-joined like metalog's), used verbatim.
            bp = (md.get("ncbi_bioproject") or "").strip()
            bioproject = bp if bp.lower() not in _UNASSIGNED_BIOPROJECT else "GTDB_UNASSIGNED"
            if category is not None:
                md["gtdb_genome_category"] = category
            sample_fields = {k: v for k, v in sf.items() if k != "metadata"}
            if md:
                sample_fields["metadata"] = json.dumps(md, separators=(",", ":"))
        else:
            # Production links every gtdb sample to a study.
            bioproject = "GTDB_UNASSIGNED"
    anchor_map = region_anchor_map(file_path)
    yield from emit_antismash(
        source=DATA_SOURCE, source_type=SOURCE_TYPE, source_description=DATA_SOURCE_DESC,
        source_url=DATA_SOURCE_URL,
        nk=nk, name=genome, base_name=genome, file_path=file_path, regions=regions,
        run_name=genome, assembly_source_type=source_type, sample_fields=sample_fields,
        taxonomy_lineage=taxonomy_lineage, taxonomy_fields=taxonomy_fields,
        anchor_map=anchor_map)
    if bioproject is not None:
        st_nk = scoped(SOURCE, bioproject)
        study_payload = {"external_id": bioproject, "accession": bioproject,
                         "bioproject": bioproject, "study_name": bioproject}
        if study_title:
            study_payload["title"] = study_title
        yield Record("studies", st_nk, study_payload, {})
        yield Record("study_samples", f"{st_nk}|{nk}", {},
                     refs={"study_id": ("studies", st_nk), "sample_id": ("samples", nk)})
