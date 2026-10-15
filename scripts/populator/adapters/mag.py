import json
import re
from pathlib import Path
from typing import Iterator, Optional

from ..core.record import Record
from ..ids import scoped
from .antismash_gbk import parse_region_tar
from ._antismash_emit import emit_antismash
from .anchors import region_anchor_map
from . import mfd_metadata
from . import omd_metadata
from . import gem_metadata
from . import smag_metadata
from . import spire_metadata
from . import tpmc_metadata
from . import owc_metadata

# slug -> (name, description, url). The slug is also the nk scope, so a genome in two
# catalogs is two identities (they are different deposits).
COLLECTIONS = {
    "gem":    ("GEM",   "Genomes from Earth's Microbiomes (JGI/IMG)",
               "https://genome.jgi.doe.gov/portal/GEMs/GEMs.home.html"),
    "spire":  ("SPIRE MAGs", "SPIRE metagenome-assembled genomes",
               "https://spire.embl.de/"),
    "smag":   ("SMAG",  "SMAG metagenome-assembled genomes",
               smag_metadata.SMAG_SOURCE_URL),
    "mfd-lr": ("Microflora Danica (long-read)", "Microflora Danica long-read MAGs",
               mfd_metadata.MFD_SOURCE_URL),
    "mfd-sr": ("Microflora Danica (short-read)", "Microflora Danica short-read MAGs",
               mfd_metadata.MFD_SOURCE_URL),
    "owc":    ("OWC",   "Old Woman Creek wetland MAGs", owc_metadata.OWC_SOURCE_URL),
    "tpmc":   ("TPMC",  "TPMC metagenome-assembled genomes",
               tpmc_metadata.TPMC_SOURCE_URL),
    "omd-v2": ("Ocean Microbiomics Database v2",
               "Ocean Microbiomics Database v2 metagenome-assembled genomes",
               "https://microbiomics.io/ocean/"),
}

# Genome names embed a BioSample, e.g. 'ACIN21-1_SAMN05421555_MAG_00000001'.
BIOSAMPLE_COLLECTIONS = {"omd-v2"}
_BIOSAMPLE_RE = re.compile(r"SAM(?:N|EA|D)\d+")

SOURCE_TYPE = "third_party"
# Default only: omd-v2 also bundles reference genomes (`..._GENO_...`), mostly isolates,
# whose type is not derivable from the name. Callers pass a {genome_id: source_type} map
# built by tools/backfill_omd_geno_source_type; unmapped genomes keep the default.
GENOME_SOURCE_TYPE = "MAG"
VALID_GENOME_SOURCE_TYPES = ("metagenome", "MAG", "SAG", "isolate")

# SPIRE's `specI_v4_*` genomes are proGenomes isolate reference genomes shipped among its MAGs.
SPIRE_ISOLATE_PREFIX = "specI_v4_"


def default_genome_source_type(collection: str, genome: str) -> str:
    if collection == spire_metadata.SPIRE_COLLECTION_SLUG and genome.startswith(SPIRE_ISOLATE_PREFIX):
        return "isolate"
    return GENOME_SOURCE_TYPE


def _extract_biosample(name: str) -> Optional[str]:
    m = _BIOSAMPLE_RE.search(name or "")
    return m.group(0) if m else None


def emit_mag_tarball(tarball_path, collection: str,
                     genome_source_types: Optional[dict] = None) -> Iterator[Record]:
    """One genome tarball; the genome is sample, assembly and analysis at once. Catalog
    contigs are kept verbatim in bgc filenames, even when already genome-prefixed.
    """
    try:
        ds_name, ds_desc, ds_url = COLLECTIONS[collection]
    except KeyError:
        raise ValueError(
            f"unknown MAG collection {collection!r}; "
            f"expected one of {sorted(COLLECTIONS)}")
    from .archive import archive_stem
    genome = archive_stem(tarball_path)
    # Validated here: at COPY time a bad value fails the bulk load with no genome named.
    genome_source_type = (genome_source_types or {}).get(
        genome, default_genome_source_type(collection, genome))
    if genome_source_type not in VALID_GENOME_SOURCE_TYPES:
        raise ValueError(
            f"invalid assemblies.source_type {genome_source_type!r} for genome "
            f"{genome!r}; expected one of {list(VALID_GENOME_SOURCE_TYPES)}")
    nk = scoped(collection, genome)
    regions = parse_region_tar(tarball_path)
    file_path = str(Path(tarball_path).resolve())
    # Elsewhere accession defaults to the genome id (set in emit_antismash).
    sample_fields = None
    if collection in BIOSAMPLE_COLLECTIONS:
        bs = _extract_biosample(genome)
        if bs:
            sample_fields = {"accession": bs,
                             "metadata": json.dumps({"biosample": bs},
                                                    separators=(",", ":"))}
            if collection == omd_metadata.OMD_COLLECTION_SLUG:
                env = omd_metadata.enrichment_for(bs)
                if env:
                    merged = dict(env)
                    # Non-None PANGAEA physicochemistry (Tara samples) overrides the ENA values.
                    physico = omd_metadata.physicochem_for(bs)
                    if physico:
                        for key, value in physico.items():
                            if key != "metadata" and value is not None:
                                merged[key] = value
                        if physico["metadata"]:
                            combined = json.loads(env["metadata"])
                            combined.update(json.loads(physico["metadata"]))
                            merged["metadata"] = json.dumps(
                                combined, separators=(",", ":"))
                    sample_fields = {**merged, "accession": bs}
    elif collection in mfd_metadata.MAG_COLLECTION_SLUGS:
        sample_fields = mfd_metadata.enrichment_for(genome, collection)
    elif collection == gem_metadata.GEM_COLLECTION_SLUG:
        env = gem_metadata.enrichment_for(genome)
        if env:
            sample_fields = env
    elif collection == smag_metadata.SMAG_COLLECTION_SLUG:
        env = smag_metadata.enrichment_for(genome)
        if env:
            sample_fields = env
    elif collection == tpmc_metadata.TPMC_COLLECTION_SLUG:
        env = tpmc_metadata.enrichment_for(genome)
        if env:
            sample_fields = env
    elif collection == spire_metadata.SPIRE_COLLECTION_SLUG:
        # Unlike omd-v2, the biosample does not overwrite the accession.
        env = spire_metadata.enrichment_for(genome)
        if env:
            sample_fields = env
        # Independent of the geo enrichment above, which may be absent.
        eco = spire_metadata.ecosystem_for(genome)
        if eco:
            if sample_fields is None:
                sample_fields = {}
            sample_fields["gold_ecosystem_path"] = eco["gold_ecosystem_path"]
            if sample_fields.get("metadata"):
                combined = json.loads(sample_fields["metadata"])
                combined.update(json.loads(eco["metadata"]))
                sample_fields["metadata"] = json.dumps(combined, separators=(",", ":"))
            else:
                sample_fields["metadata"] = eco["metadata"]
    elif collection == owc_metadata.OWC_COLLECTION_SLUG:
        # Single-site collection: uniform site metadata.
        sample_fields = owc_metadata.enrichment_for(genome)
    anchor_map = region_anchor_map(file_path)
    yield from emit_antismash(
        source=ds_name, source_type=SOURCE_TYPE, source_description=ds_desc,
        source_url=ds_url,
        nk=nk, name=genome, base_name=genome, file_path=file_path, regions=regions,
        run_name=genome, assembly_source_type=genome_source_type,
        sample_fields=sample_fields, taxonomy_lineage=None, taxonomy_fields=None,
        anchor_map=anchor_map)
    # Every MFD genome gets the study, enriched or not. The study nk is the unscoped
    # bioproject, so mfd-lr and the custom deposit dedup to one PRJEB58634 study.
    study = mfd_metadata.mfd_study(collection)
    if study is not None:
        st_nk, study_payload = study
        yield Record("studies", st_nk, study_payload, {})
        yield Record("study_samples", f"{st_nk}|{nk}", {},
                     refs={"study_id": ("studies", st_nk), "sample_id": ("samples", nk)})
