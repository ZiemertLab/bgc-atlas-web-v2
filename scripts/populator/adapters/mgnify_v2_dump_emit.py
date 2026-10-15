"""Native-v2 replacements for the MGnify dump emitters, producing the same Records as v1.

The v1 cleaning rules are imported, not reimplemented. samples.metadata keeps the v1
4-key shape for the app, and samples are keyed by the ENA secondary so ids match v1.
"""
import json
from typing import Iterator

from ..core.record import Record
from ..ids import entity_id, scoped
from .biome import biome_nodes
from .mgnify_dump_emit import _clean, _coerce_float, _coerce_int, _DATE_RE  # noqa: F401
from .mgnify_v2_dump import biosample_accessions, sample_natural_key  # noqa: F401

SOURCE = "mgnify"


def _date(v):
    if isinstance(v, str) and _DATE_RE.match(v):
        return v
    return None


def _biosample(data: dict) -> str:
    bios = biosample_accessions(data.get("ena_accessions"))
    return bios[0] if bios else data.get("accession")


def _raw_metadata(m: dict) -> dict:
    """v1-shaped ``{key: {unit: None, value}}``, blanks dropped as in v1."""
    return {k: {"unit": None, "value": v} for k, v in m.items() if v not in (None, "")}


def emit_sample(data: dict) -> Iterator[Record]:
    key = sample_natural_key(data)
    if key is None:
        return
    nk = scoped(SOURCE, key)
    m = data.get("metadata") or {}
    f = {"external_id": key, "accession": key}

    def put(col, val):
        if val not in (None, ""):
            f[col] = val

    put("name", data.get("sample_title") or m.get("sample_title"))
    put("sample_alias", m.get("sample_alias"))
    put("geographic_location", m.get("country"))
    put("host_scientific_name", m.get("scientific_name"))

    lat = _coerce_float(m.get("lat"))
    if lat is not None:
        f["latitude"] = lat
    lon = _coerce_float(m.get("lon"))
    if lon is not None:
        f["longitude"] = lon

    cd = _date(m.get("collection_date_start")) or _date(m.get("collection_date"))
    if cd is not None:
        f["collection_date"] = cd
    cde = _date(m.get("collection_date_end"))
    if cde is not None:
        f["collection_date_end"] = cde

    env_biome = _clean(m.get("environment_biome") or m.get("broad_scale_environmental_context"))
    if env_biome is not None:
        f["environment_biome"] = env_biome
    env_feature = _clean(m.get("environment_feature") or m.get("local_environmental_context"))
    if env_feature is not None:
        f["environment_feature"] = env_feature
    env_material = _clean(m.get("environment_material") or m.get("environmental_medium"))
    if env_material is not None:
        f["environment_material"] = env_material

    for col, src in (("elevation_meters", "elevation"), ("depth", "depth"),
                     ("ph", "ph"), ("temperature", "temperature")):
        val = _coerce_float(m.get(src))
        if val is not None:
            f[col] = val

    htax = _coerce_int(m.get("host_tax_id"))
    if htax is not None:
        f["host_taxid"] = htax

    f["metadata"] = json.dumps({
        "biosample": _biosample(data),
        "last_update": data.get("updated_at"),
        "raw_metadata": _raw_metadata(m),
        "analysis_completed": None,
    }, separators=(",", ":"))

    yield Record("samples", nk, f, {})

    # ~80% of v2 samples have biome:null but carry their biome on an embedded
    # study; fall back to the first study lineage so biome coverage stays ~100%.
    lineage = (data.get("biome") or {}).get("lineage")
    if not lineage:
        for s in (data.get("studies") or []):
            sl = (s.get("biome") or {}).get("lineage")
            if sl:
                lineage = sl
                break
    if lineage:
        nodes = biome_nodes(lineage)
        for path, level, parent in nodes:
            refs = {"parent_id": ("biomes", parent)} if parent else {}
            yield Record("biomes", path, {"name": path, "level": level}, refs)
        if nodes:
            leaf = nodes[-1][0]
            yield Record("sample_biomes", f"{nk}|{leaf}", {},
                         refs={"sample_id": ("samples", nk), "biome_id": ("biomes", leaf)})


def emit_assembly(data: dict, samea2sec: dict) -> Iterator[Record]:
    """Mirrors the v1 emit_assembly exactly; the sample link is translated via ``samea2sec``."""
    acc = data.get("accession")
    if not acc:
        return
    nk = scoped(SOURCE, acc)
    yield Record("assemblies", nk,
                 {"accession": acc, "external_id": acc, "name": None,
                  "source_type": "metagenome",
                  "metadata": json.dumps({
                      "assembler_name": data.get("assembler_name"),
                      "assembler_version": data.get("assembler_version"),
                      "reads_study_accession": data.get("reads_study_accession"),
                      "assembly_study_accession": data.get("assembly_study_accession"),
                      "status": data.get("status"),
                      "updated_at": data.get("updated_at"),
                      "mgnify_v2": True,
                  }, separators=(",", ":"))},
                 {})
    run_accession = data.get("run_accession")
    if run_accession:
        r_nk = scoped(SOURCE, run_accession)
        yield Record("run_assemblies", f"{r_nk}|{nk}", {},
                     refs={"run_id": ("runs", r_nk), "assembly_id": ("assemblies", nk)})
    sample_accession = data.get("sample_accession")
    if sample_accession:
        sec = samea2sec.get(sample_accession, sample_accession)
        s_nk = scoped(SOURCE, sec)
        yield Record("sample_assemblies", f"{s_nk}|{nk}", {},
                     refs={"sample_id": ("samples", s_nk), "assembly_id": ("assemblies", nk)})


def emit_run(data: dict, samea2sec: dict) -> Iterator[Record]:
    """Mirrors the v1 emit_run; v2 has no secondary_accession. The sample link is
    translated via ``samea2sec``."""
    acc = data.get("accession")
    if not acc:
        return
    nk = scoped(SOURCE, acc)
    yield Record("runs", nk,
                 {"accession": acc,
                  "instrument_model": data.get("instrument_model"),
                  "instrument_platform": data.get("instrument_platform"),
                  "metadata": json.dumps({
                      "experiment_type": data.get("experiment_type"),
                      "study_accession": data.get("study_accession"),
                      "sample_accession": data.get("sample_accession"),
                      "mgnify_v2": True,
                  }, separators=(",", ":"))},
                 {})
    sample_accession = data.get("sample_accession")
    if sample_accession:
        sec = samea2sec.get(sample_accession, sample_accession)
        s_nk = scoped(SOURCE, sec)
        yield Record("sample_runs", f"{s_nk}|{nk}", {},
                     refs={"sample_id": ("samples", s_nk), "run_id": ("runs", nk)})
    study_accession = data.get("study_accession")
    if study_accession:
        st_nk = scoped(SOURCE, study_accession)
        yield Record("run_studies", f"{nk}|{st_nk}", {},
                     refs={"run_id": ("runs", nk), "study_id": ("studies", st_nk)})


def emit_study(data: dict) -> Iterator[Record]:
    """Mirrors the v1 emit_study, including the biome tree nodes."""
    acc = data.get("accession")
    if not acc:
        return
    nk = scoped(SOURCE, acc)
    f = {"accession": acc}
    title = data.get("title")
    if title:
        f["study_name"] = title                 # as in production
        f["title"] = title
    f["metadata"] = json.dumps({
        "updated_at": data.get("updated_at"),
        "first_accession": data.get("first_accession"),
        "mgnify_v2": True,
    }, separators=(",", ":"))
    biome = data.get("biome")
    if biome and biome.get("lineage"):
        f["biome_ids"] = [str(entity_id("biomes", biome["lineage"]))]
    yield Record("studies", nk, f, {})
    if biome and biome.get("lineage"):
        for path, level, parent in biome_nodes(biome["lineage"]):
            refs = {"parent_id": ("biomes", parent)} if parent else {}
            yield Record("biomes", path, {"name": path, "level": level}, refs)


def emit_analysis(data: dict, samea2sec: dict) -> Iterator[Record]:
    """Mirrors the v1 emit_analysis. Only the sample link is translated via ``samea2sec``."""
    acc = data.get("accession")
    if not acc:
        return
    nk = scoped(SOURCE, acc)
    yield Record("analyses", nk,
                 {"accession": acc, "name": acc,
                  "analysis_type": data.get("experiment_type"), "tool_name": "",
                  "metadata": json.dumps({
                      "pipeline_version": data.get("pipeline_version"),
                      "study_accession": data.get("study_accession"),
                      "mgnify_v2": True,
                  }, separators=(",", ":"))},
                 {})
    sample = data.get("sample")
    if sample and sample.get("accession"):
        sec = samea2sec.get(sample["accession"], sample["accession"])
        s_nk = scoped(SOURCE, sec)
        yield Record("sample_analyses", f"{s_nk}|{nk}", {},
                     refs={"sample_id": ("samples", s_nk), "analysis_id": ("analyses", nk)})
    assembly = data.get("assembly")
    if assembly and assembly.get("accession"):
        a_nk = scoped(SOURCE, assembly["accession"])
        yield Record("assembly_analyses", f"{a_nk}|{nk}", {},
                     refs={"assembly_id": ("assemblies", a_nk), "analysis_id": ("analyses", nk)})
    run = data.get("run")
    if run and run.get("accession"):
        r_nk = scoped(SOURCE, run["accession"])
        yield Record("run_analyses", f"{r_nk}|{nk}", {},
                     refs={"run_id": ("runs", r_nk), "analysis_id": ("analyses", nk)})
