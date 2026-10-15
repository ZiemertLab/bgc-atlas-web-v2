"""Emitters for the MGnify v2 entity kinds the v1 dump never had (publications,
super_studies, genome_catalogues, genomes)."""
import json
from typing import Iterator, Optional

from ..core.record import Record
from ..ids import scoped

SOURCE = "mgnify"


def _put(f: dict, col: str, val) -> None:
    """Omit None/"" so the column gets NULL / its DB default rather than a bad literal."""
    if val not in (None, ""):
        f[col] = val


def _int(v) -> Optional[int]:
    if v is None or v == "":
        return None
    try:
        return int(v)
    except (ValueError, TypeError):
        try:
            return int(float(v))
        except (ValueError, TypeError):
            return None


def _float(v) -> Optional[float]:
    if v is None or v == "":
        return None
    try:
        return float(v)
    except (ValueError, TypeError):
        return None


def _json(obj: dict) -> str:
    return json.dumps(obj, separators=(",", ":"))


def emit_publication(data: dict) -> Iterator[Record]:
    pubmed_id = data.get("pubmed_id")
    if pubmed_id in (None, ""):
        return
    pubmed_id = str(pubmed_id)
    f = {"pubmed_id": pubmed_id}
    _put(f, "title", data.get("title"))
    year = _int(data.get("published_year"))
    if year is not None:
        f["published_year"] = year
    f["metadata"] = _json(data.get("metadata") or {})
    yield Record("mgnify_publications", scoped(SOURCE, pubmed_id), f, {})


def emit_super_study(data: dict) -> Iterator[Record]:
    slug = data.get("slug")
    if slug in (None, ""):
        return
    f = {"slug": slug}
    _put(f, "title", data.get("title"))
    _put(f, "description", data.get("description"))
    _put(f, "logo_url", data.get("logo_url"))
    f["metadata"] = _json({
        "flagship_studies": data.get("flagship_studies"),
        "related_studies": data.get("related_studies"),
        "genome_catalogues": data.get("genome_catalogues"),
    })
    yield Record("mgnify_super_studies", scoped(SOURCE, slug), f, {})


def emit_genome_catalogue(data: dict) -> Iterator[Record]:
    catalogue_id = data.get("catalogue_id")
    if catalogue_id in (None, ""):
        return
    f = {"catalogue_id": catalogue_id}
    _put(f, "name", data.get("name"))
    _put(f, "version", data.get("version"))
    _put(f, "description", data.get("description"))
    _put(f, "biome_lineage", (data.get("biome") or {}).get("lineage"))
    gc = _int(data.get("genome_count"))
    if gc is not None:
        f["genome_count"] = gc
    ugc = _int(data.get("unclustered_genome_count"))
    if ugc is not None:
        f["unclustered_genome_count"] = ugc
    _put(f, "ftp_url", data.get("ftp_url"))
    _put(f, "result_directory", data.get("result_directory"))
    _put(f, "pipeline_version_tag", data.get("pipeline_version_tag"))
    _put(f, "catalogue_biome_label", data.get("catalogue_biome_label"))
    _put(f, "catalogue_type", data.get("catalogue_type"))
    _put(f, "updated_at", data.get("updated_at"))
    f["metadata"] = _json({
        "other_stats": data.get("other_stats"),
        "downloads": data.get("downloads"),
        "protein_catalogue_name": data.get("protein_catalogue_name"),
        "protein_catalogue_description": data.get("protein_catalogue_description"),
    })
    yield Record("mgnify_genome_catalogues", scoped(SOURCE, catalogue_id), f, {})


def emit_genome(data: dict) -> Iterator[Record]:
    accession = data.get("accession")
    if accession in (None, ""):
        return
    f = {"accession": accession}
    for col in ("ena_genome_accession", "ena_sample_accession",
                "ena_study_accession", "ncbi_genome_accession",
                "img_genome_accession", "type", "taxon_lineage",
                "geographic_origin", "updated_at"):
        _put(f, col, data.get(col))
    length = _int(data.get("length"))
    if length is not None:
        f["length"] = length
    num_contigs = _int(data.get("num_contigs"))
    if num_contigs is not None:
        f["num_contigs"] = num_contigs
    n_50 = _int(data.get("n_50"))
    if n_50 is not None:
        f["n_50"] = n_50
    for col, src in (("gc_content", "gc_content"),
                     ("completeness", "completeness"),
                     ("contamination", "contamination")):
        val = _float(data.get(src))
        if val is not None:
            f[col] = val
    _put(f, "biome_lineage", (data.get("biome") or {}).get("lineage"))
    f["metadata"] = _json({
        "geographic_range": data.get("geographic_range"),
        "num_genomes_total": data.get("num_genomes_total"),
        "patric_genome_accession": data.get("patric_genome_accession"),
    })
    refs = {}
    catalogue_id = data.get("catalogue_id")
    if catalogue_id:
        refs["genome_catalogue_id"] = (
            "mgnify_genome_catalogues", scoped(SOURCE, catalogue_id))
    yield Record("mgnify_genomes", scoped(SOURCE, accession), f, refs)
