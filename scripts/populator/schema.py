from __future__ import annotations
from dataclasses import dataclass, field
from types import MappingProxyType
from typing import Dict, List

@dataclass(frozen=True)
class Table:
    name: str
    columns: tuple
    natural_key_cols: tuple
    fks: "MappingProxyType" = field(default_factory=lambda: MappingProxyType({}))
    # Literal emitted for None in NOT NULL DEFAULT columns; \N would abort the COPY.
    none_defaults: "MappingProxyType" = field(default_factory=lambda: MappingProxyType({}))

    def __post_init__(self):
        object.__setattr__(self, "columns", tuple(self.columns))
        object.__setattr__(self, "natural_key_cols", tuple(self.natural_key_cols))
        object.__setattr__(self, "fks", MappingProxyType(dict(self.fks)))
        object.__setattr__(self, "none_defaults", MappingProxyType(dict(self.none_defaults)))

TABLES: Dict[str, Table] = {
    # data_sources.name has no DB UNIQUE constraint; dedup is populator-side only.
    "data_sources": Table(
        "data_sources",
        ["id", "source_type", "name", "description", "source_url", "user_upload_id"],
        ["name"],
    ),
    "samples": Table(
        "samples",
        ["id", "external_id", "name", "accession", "sample_alias",
         "latitude", "longitude", "geographic_location", "geolocation_name",
         "location_resolution", "collection_date", "collection_date_end",
         "environment_material", "environment_biome", "environment_feature",
         "environmental_package", "gold_ecosystem_path",
         "elevation_meters", "depth", "depth_min_meters",
         "depth_max_meters", "ph", "temperature",
         "current_precipitation_mm", "mean_annual_precipitation_mm",
         "mean_annual_temperature", "host_taxid", "host_scientific_name",
         # genome_quality is the MIMAG tier; genome_size is assembly length in bases.
         "checkm_completeness", "checkm_contamination", "genome_quality", "genome_size",
         "salinity", "salinity_unit",
         "dissolved_oxygen", "dissolved_oxygen_unit",
         "nitrate", "nitrate_unit", "nitrite", "nitrite_unit",
         "ammonium", "ammonium_unit", "phosphate", "phosphate_unit",
         "conductivity", "conductivity_unit",
         "dissolved_organic_carbon", "dissolved_organic_carbon_unit",
         "filtration_lower_threshold_um", "filtration_upper_threshold_um",
         "data_source_ids", "metadata"],
        ["external_id"],
        none_defaults={"metadata": "{}", "data_source_ids": "{}"},
    ),
    "studies": Table(
        "studies",
        ["id", "external_id", "accession", "study_name", "title", "abstract",
         "study_type", "bioproject", "secondary_accession", "center_name",
         "data_source_ids", "biome_ids", "metadata"],
        ["accession"],
        none_defaults={"metadata": "{}", "data_source_ids": "{}", "biome_ids": "{}"},
    ),
    "biomes": Table(
        "biomes",
        ["id", "name", "description", "parent_id", "level", "metadata"],
        ["name"],
        fks={"parent_id": "biomes"},          # self-referential tree
        none_defaults={"metadata": "{}"},
    ),
    "assemblies": Table(
        "assemblies",
        ["id", "external_id", "name", "source_type", "accession",
         "data_source_ids", "metadata"],
        ["accession"],
        none_defaults={"metadata": "{}", "data_source_ids": "{}"},
    ),
    "analyses": Table(
        "analyses",
        ["id", "external_id", "name", "analysis_type", "tool_name", "accession",
         "data_source_ids", "metadata"],
        ["accession"],
        none_defaults={"metadata": "{}", "data_source_ids": "{}"},
    ),
    # created_at/updated_at omitted so they take their DB default. No data_source_ids
    # column in production's runs table.
    "runs": Table(
        "runs",
        ["id", "external_id", "name", "instrument_model", "instrument_platform",
         "accession", "secondary_accession", "metadata"],
        ["accession"],
        none_defaults={"metadata": "{}"}),
    "antismash_runs": Table(
        "antismash_runs",
        ["id", "name", "file_path", "analysis_id", "assembly_id", "num_bgcs",
         "pipeline_version", "antismash_version", "taxon", "status"],
        ["file_path"],
        fks={"analysis_id": "analyses", "assembly_id": "assemblies"},
    ),
    # `anchor` is read verbatim from antiSMASH's regions.js (adapters/anchors.py) so it
    # matches the HTML viewer's #hash; DB column is VARCHAR(15).
    # GCF membership and taxonomy are assigned corpus-wide by downstream pipelines and
    # are not columns here; load.py's `\copy bgcs (<columns>)` fails on any column bgcs lacks.
    "bgcs": Table(
        "bgcs",
        ["id", "filename", "assembly", "analysis_id", "antismash_run_id", "contig",
         "start_pos", "end_pos", "core_start_pos", "core_end_pos",
         "product_category", "product", "anchor", "is_complete",
         "num_cds_features"],
        ["filename"],
        fks={"assembly": "assemblies", "analysis_id": "analyses",
             "antismash_run_id": "antismash_runs"},
        none_defaults={"product_category": "{}", "product": "{}"},
    ),
    # No `gcfs` table: GCFs and bgc_gcf membership are owned by clustering, which has
    # columns the populator cannot produce.
    "taxonomies": Table(
        "taxonomies",
        ["id", "gtdb_lineage", "domain", "phylum", "class", "order_name",
         "family", "genus", "species", "source", "is_partial", "rank_depth"],
        ["gtdb_lineage"],
    ),
    # `method` keeps the corpus-wide ORF-LCA rows distinguishable from per-ingest mmseqs ones.
    "bgc_taxonomy": Table(
        "bgc_taxonomy",
        ["bgc_id", "taxonomy_id", "rank", "support", "method"],
        ["bgc_id"],
        fks={"bgc_id": "bgcs", "taxonomy_id": "taxonomies"},
    ),
    "sample_assemblies": Table(
        "sample_assemblies", ["sample_id", "assembly_id"], ["sample_id", "assembly_id"],
        fks={"sample_id": "samples", "assembly_id": "assemblies"}),
    "sample_analyses": Table(
        "sample_analyses", ["sample_id", "analysis_id"], ["sample_id", "analysis_id"],
        fks={"sample_id": "samples", "analysis_id": "analyses"}),
    "assembly_analyses": Table(
        "assembly_analyses", ["assembly_id", "analysis_id"], ["assembly_id", "analysis_id"],
        fks={"assembly_id": "assemblies", "analysis_id": "analyses"}),
    "study_samples": Table(
        "study_samples", ["study_id", "sample_id"], ["study_id", "sample_id"],
        fks={"study_id": "studies", "sample_id": "samples"}),
    "sample_runs": Table(
        "sample_runs", ["sample_id", "run_id"], ["sample_id", "run_id"],
        fks={"sample_id": "samples", "run_id": "runs"}),
    "run_assemblies": Table(
        "run_assemblies", ["run_id", "assembly_id"], ["run_id", "assembly_id"],
        fks={"run_id": "runs", "assembly_id": "assemblies"}),
    "run_analyses": Table(
        "run_analyses", ["run_id", "analysis_id"], ["run_id", "analysis_id"],
        fks={"run_id": "runs", "analysis_id": "analyses"}),
    "run_studies": Table(
        "run_studies", ["run_id", "study_id"], ["run_id", "study_id"],
        fks={"run_id": "runs", "study_id": "studies"}),
    "sample_biomes": Table(
        "sample_biomes", ["sample_id", "biome_id"], ["sample_id", "biome_id"],
        fks={"sample_id": "samples", "biome_id": "biomes"}),
    # (sample_id, key) has no DB UNIQUE constraint; dedup is populator-side via the nk.
    "sample_measurements": Table(
        "sample_measurements",
        ["id", "sample_id", "key", "value", "unit", "source", "metadata"],
        ["sample_id", "key"],
        fks={"sample_id": "samples"},
        none_defaults={"metadata": "{}"}),
    # mgnify_genomes references mgnify_genome_catalogues, so loads after it.
    "mgnify_publications": Table(
        "mgnify_publications",
        ["id", "pubmed_id", "title", "published_year", "metadata"],
        ["pubmed_id"],
        none_defaults={"metadata": "{}"}),
    "mgnify_super_studies": Table(
        "mgnify_super_studies",
        ["id", "slug", "title", "description", "logo_url", "metadata"],
        ["slug"],
        none_defaults={"metadata": "{}"}),
    "mgnify_genome_catalogues": Table(
        "mgnify_genome_catalogues",
        ["id", "catalogue_id", "name", "version", "description", "biome_lineage",
         "genome_count", "unclustered_genome_count", "ftp_url", "result_directory",
         "pipeline_version_tag", "catalogue_biome_label", "catalogue_type",
         "updated_at", "metadata"],
        ["catalogue_id"],
        none_defaults={"metadata": "{}"}),
    "mgnify_genomes": Table(
        "mgnify_genomes",
        ["id", "accession", "genome_catalogue_id", "ena_genome_accession",
         "ena_sample_accession", "ena_study_accession", "ncbi_genome_accession",
         "img_genome_accession", "length", "num_contigs", "n_50", "gc_content",
         "type", "completeness", "contamination", "taxon_lineage",
         "geographic_origin", "biome_lineage", "updated_at", "metadata"],
        ["accession"],
        fks={"genome_catalogue_id": "mgnify_genome_catalogues"},
        none_defaults={"metadata": "{}"}),
}

# Columns patched onto already-emitted rows, so load_order() may place their parent
# after the child.
PATCH_COLUMNS: Dict[str, List[str]] = {}

def load_order() -> List[str]:
    """Topological order over the FK graph (parents before children); raises
    ValueError on a cycle."""
    order: List[str] = []
    visiting, done = set(), set()
    def visit(t: str):
        if t in done:
            return
        visiting.add(t)
        for col, parent in TABLES[t].fks.items():
            if parent in TABLES:
                if parent == t:
                    continue          # self-referential FK is not a cycle
                if parent in visiting:
                    raise ValueError(f"FK cycle detected: {t}.{col} -> {parent}")
                visit(parent)
        visiting.discard(t)
        done.add(t)
        order.append(t)
    for t in TABLES:
        visit(t)
    return order
