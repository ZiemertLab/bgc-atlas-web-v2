"""Tier 1 GTDB metadata from a GTDB release table, for genomes the EAV dump lacks
(the dump holds no archaea).

Builds the dump-shaped object from a release row (``ar53_metadata_r<N>.tsv.gz``).
Keys were checked against R232 columns: all but those in ``RENAMED`` share the
column name. ``hq_*`` and enrichment keys written by later passes are left out.
``none`` is dropped as in the dump; ``na`` is kept.
"""
from __future__ import annotations

SAME_NAME = (
    "ambiguous_bases", "checkm_marker_count", "checkm_strain_heterogeneity", "coding_bases",
    "coding_density", "contig_count", "gc_percentage", "genome_size",
    "gtdb_genome_representative", "gtdb_representative", "gtdb_taxonomy",
    "gtdb_type_designation_ncbi_taxa", "gtdb_type_species_of_genus", "l50_contigs",
    "l50_scaffolds", "longest_contig", "longest_scaffold", "lsu_23s_count", "lsu_23s_length",
    "lsu_5s_count", "lsu_5s_length", "mean_contig_length", "mean_scaffold_length",
    "mimag_high_quality", "mimag_low_quality", "mimag_medium_quality", "n50_contigs",
    "n50_scaffolds", "ncbi_assembly_level", "ncbi_assembly_type", "ncbi_biosample",
    "ncbi_contig_count", "ncbi_contig_n50", "ncbi_isolate", "ncbi_isolation_source",
    "ncbi_protein_count", "ncbi_rrna_count", "ncbi_submitter", "ncbi_taxonomy",
    "ncbi_taxonomy_unfiltered", "ncbi_trna_count", "ncbi_type_material_designation",
    "scaffold_count", "ssu_count", "ssu_length", "total_gap_length", "trna_aa_count",
    "trna_count", "trna_selenocysteine_count",
)

# The dump's checkm_completeness / checkm_contamination are GTDB's CheckM2 values;
# checkm_marker_count / checkm_strain_heterogeneity are CheckM1's.
RENAMED = {
    "checkm_completeness": "checkm2_completeness",
    "checkm_contamination": "checkm2_contamination",
    "quality_model": "checkm2_model",
}
CONSTANT = {"quality_tool": "CheckM2"}

EMPTY = {"", "none"}


def release_metadata(row: dict[str, str]) -> dict[str, str]:
    """One release row (column -> string) -> the dump-shaped metadata object."""
    missing = [c for c in (*SAME_NAME, *RENAMED.values()) if c not in row]
    if missing:
        raise ValueError(f"release row lacks columns {missing}")
    md = {key: row[key] for key in SAME_NAME}
    md.update({key: row[column] for key, column in RENAMED.items()})
    md = {k: v for k, v in md.items() if v.strip().lower() not in EMPTY}
    md.update(CONSTANT)
    return md
