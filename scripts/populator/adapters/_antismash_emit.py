from typing import Iterator, Optional
from ..core.record import Record

_RANKS = ["domain", "phylum", "class", "order", "family", "genus", "species"]

def bgc_filename(base_name: str, contig: str, region_number: int) -> str:
    return f"{base_name}_{contig}.region{region_number:03d}"

def antismash_run_record(file_path, run_name, num_bgcs, taxon, assembly_nk, analysis_nk):
    return Record("antismash_runs", file_path,
                  {"name": run_name, "file_path": file_path, "num_bgcs": num_bgcs,
                   "status": "completed", "taxon": taxon},
                  refs={"analysis_id": ("analyses", analysis_nk),
                        "assembly_id": ("assemblies", assembly_nk)})

def assembly_analyses_record(assembly_nk, analysis_nk):
    return Record("assembly_analyses", f"{assembly_nk}|{analysis_nk}", {},
                  refs={"assembly_id": ("assemblies", assembly_nk),
                        "analysis_id": ("analyses", analysis_nk)})

def rank_for_depth(rank_depth: int) -> str:
    """Keyed off rank_depth, not the deepest prefix present: the load gate asserts
    rank == RANKS[rank_depth - 1], and a sparse lineage would otherwise fail the batch.
    """
    return _RANKS[min(max(int(rank_depth or 1), 1), len(_RANKS)) - 1]


def bgc_records(base_name, regions, assembly_nk, analysis_nk, run_file_path,
                taxonomy_lineage: Optional[str] = None,
                anchor_map: Optional[dict] = None,
                taxonomy_rank: Optional[str] = None):
    """The bgc filename logic here is what bgcs.id derives from; keep it the single
    source of truth for all adapters. `anchor_map` is {(contig, region_number): anchor}.
    """
    rank = taxonomy_rank
    if taxonomy_lineage and rank is None:
        rank = rank_for_depth(len([p for p in taxonomy_lineage.split(";") if p.strip()]))
    for reg in regions:
        fn = bgc_filename(base_name, reg.contig, reg.region_number)
        refs = {"assembly": ("assemblies", assembly_nk),
                "analysis_id": ("analyses", analysis_nk),
                "antismash_run_id": ("antismash_runs", run_file_path)}
        yield Record("bgcs", fn,
                     {"filename": fn, "contig": reg.contig,
                      "start_pos": reg.start_pos, "end_pos": reg.end_pos,
                      "core_start_pos": reg.core_start_pos,
                      "core_end_pos": reg.core_end_pos,
                      "product": reg.product,
                      "product_category": reg.product_category,
                      "anchor": (anchor_map or {}).get((reg.contig, reg.region_number)),
                      "is_complete": reg.is_complete,
                      "num_cds_features": reg.num_cds_features},
                     refs=refs)
        if taxonomy_lineage:
            # The corpus-wide ORF-LCA pass writes 'orf_lca_v1'; keep the labels distinct.
            yield Record("bgc_taxonomy", fn,
                         {"rank": rank, "support": None, "method": "mmseqs_v1"},
                         refs={"bgc_id": ("bgcs", fn),
                               "taxonomy_id": ("taxonomies", taxonomy_lineage)})

def emit_antismash(*, source: str, source_type: str, source_description: str,
                   nk: str, name: str, base_name: str, file_path: str,
                   regions: list, run_name: str,
                   source_url: Optional[str] = None,
                   sample_fields: Optional[dict] = None,
                   assembly_source_type: str = "metagenome",
                   taxonomy_lineage: Optional[str] = None,
                   taxonomy_fields: Optional[dict] = None,
                   anchor_map: Optional[dict] = None) -> Iterator[Record]:
    """Standard antiSMASH-derived records. `nk` is the source-scoped natural key shared
    by sample/assembly/analysis; `base_name` is the bgc filename prefix."""
    ds_fields = {"name": source, "source_type": source_type,
                 "description": source_description}
    if source_url:
        ds_fields["source_url"] = source_url
    yield Record("data_sources", source, ds_fields, {})
    samp = {"external_id": nk, "name": name, "accession": name}
    if sample_fields:
        samp.update(sample_fields)
    yield Record("samples", nk, samp, {})
    yield Record("assemblies", nk,
                 {"accession": nk, "name": name, "source_type": assembly_source_type}, {})
    yield Record("analyses", nk,
                 {"accession": nk, "name": name,
                  "analysis_type": "antismash", "tool_name": "antiSMASH"}, {})
    yield antismash_run_record(file_path, run_name, len(regions),
                               (regions[0].taxon if regions else None), nk, nk)
    yield Record("sample_assemblies", f"{nk}|{nk}", {},
                 refs={"sample_id": ("samples", nk), "assembly_id": ("assemblies", nk)})
    yield Record("sample_analyses", f"{nk}|{nk}", {},
                 refs={"sample_id": ("samples", nk), "analysis_id": ("analyses", nk)})
    yield assembly_analyses_record(nk, nk)
    taxonomy_rank = None
    if taxonomy_lineage:
        tf = dict(taxonomy_fields or {"gtdb_lineage": taxonomy_lineage})
        tf.setdefault("gtdb_lineage", taxonomy_lineage)
        yield Record("taxonomies", taxonomy_lineage, tf, {})
        # Same rank_depth as the taxonomies row; the load gate compares them.
        taxonomy_rank = rank_for_depth(
            tf.get("rank_depth") or len([p for p in taxonomy_lineage.split(";") if p.strip()]))
    yield from bgc_records(base_name, regions, nk, nk, file_path,
                           taxonomy_lineage=taxonomy_lineage,
                           anchor_map=anchor_map,
                           taxonomy_rank=taxonomy_rank)
