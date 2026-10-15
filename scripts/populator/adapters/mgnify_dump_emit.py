"""Emit entity and junction Records from the MGnify metadata dump (JSON:API rows).

These transforms reproduce the production rows exactly; the field sets, JSON-string
metadata and empty-list omission rules must not be tidied.
"""
import json
import re
from typing import Iterator

from ..core.record import Record
from ..ids import scoped
from .mgnify_dump import (
    attr, self_link, rel_one, rel_type, rel_many, links_related,
)

SOURCE = "mgnify"

# Value cleaning reverse-engineered from the production DB.
_SENTINELS = {"missing", "not collected", "not provided", "n/a", "na", "none",
              "null", "not applicable", "unknown", ""}


def _sentinel(v):
    if isinstance(v, str) and v.strip().lower() in _SENTINELS:
        return None
    return v


def _clean(v):
    """environment_* cleaning: strip surrounding quotes, non-ASCII -> space, collapse whitespace."""
    if v is None:
        return None
    s = str(v)
    if len(s) >= 2 and s[0] == '"' and s[-1] == '"':
        s = s[1:-1]
    s = "".join(c if ord(c) < 128 else " " for c in s)
    s = re.sub(r"\s+", " ", s).strip()
    return s or None


def _qstrip(v):
    """raw_metadata values: strip surrounding quotes only."""
    if isinstance(v, str) and len(v) >= 2 and v[0] == '"' and v[-1] == '"':
        return v[1:-1]
    return v


def _coerce_float(v):
    if v is None or v == "":
        return None
    try:
        return float(v)
    except (ValueError, TypeError):
        return None


def _coerce_int(v):
    try:
        return int(v)
    except (ValueError, TypeError):
        try:
            return int(float(v))
        except (ValueError, TypeError):
            return None


_GEO_COUNTRY = "geographic location (country and/or sea,region)"
# Fallback sample-metadata keys when the top-level attr is absent.
_ENV_RAW = {"environment_biome": "environment (biome)",
            "environment_feature": "environment (feature)",
            "environment_material": "environment (material)"}
_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")

# Every other relationship with a related link is a result link.
_ENTITY_RELS = ("sample", "assembly", "run", "study")


def _assembly_metadata(obj: dict) -> dict:
    """relationships_metadata omits empty lists and a null analyses_link; scalars are always present."""
    rm = {}
    run_ids = rel_many(obj, "runs")
    sample_ids = rel_many(obj, "samples")
    pipeline_ids = rel_many(obj, "pipelines")
    analyses_link = links_related(obj, "analyses")
    if run_ids:      rm["run_ids"] = run_ids
    if sample_ids:   rm["sample_ids"] = sample_ids
    if pipeline_ids: rm["pipeline_ids"] = pipeline_ids
    if analyses_link is not None: rm["analyses_link"] = analyses_link
    return {
        "coverage": attr(obj, "coverage"),
        "is_private": attr(obj, "is-private"),
        "mgnify_links": {"self": self_link(obj)},
        "wgs_accession": attr(obj, "wgs-accession"),
        "min_gap_length": attr(obj, "min-gap-length"),
        "experiment_type": attr(obj, "experiment-type"),
        "legacy_accession": attr(obj, "legacy-accession"),
        "relationships_metadata": rm,
    }


def emit_assembly(accession: str, obj: dict) -> Iterator[Record]:
    nk = scoped(SOURCE, accession)
    # An explicit None name overrides the BGC-path placeholder's name=accession.
    # data_source_ids stays unset: mgnify assemblies are untagged.
    yield Record("assemblies", nk,
                 {"accession": accession, "external_id": accession, "name": None,
                  "source_type": "metagenome",
                  "metadata": json.dumps(_assembly_metadata(obj), separators=(",", ":"))},
                 {})
    for r in rel_many(obj, "runs"):
        r_nk = scoped(SOURCE, r)
        yield Record("run_assemblies", f"{r_nk}|{nk}", {},
                     refs={"run_id": ("runs", r_nk), "assembly_id": ("assemblies", nk)})
    # A deliberate superset of production's pairs (its load order dropped a few).
    for s in rel_many(obj, "samples"):
        s_nk = scoped(SOURCE, s)
        yield Record("sample_assemblies", f"{s_nk}|{nk}", {},
                     refs={"sample_id": ("samples", s_nk), "assembly_id": ("assemblies", nk)})


def _analysis_summary(obj: dict):
    """None when empty: production omits the key."""
    a = (obj.get("attributes") or {}).get("analysis-summary")
    if not isinstance(a, list):
        return None
    d = {x["key"]: x["value"]
         for x in a if isinstance(x, dict) and "key" in x and "value" in x}
    return d or None


def _analysis_result_links(obj: dict) -> dict:
    rels = obj.get("relationships") or {}
    out = {}
    for k in rels:
        if k in _ENTITY_RELS:
            continue
        rl = links_related(obj, k)
        if rl is not None:
            out[k] = rl
    return out


def _analysis_rel_meta(obj: dict) -> dict:
    """has_assembly is added only when the analysis has a run."""
    rm = {}
    run = rel_one(obj, "run"); asm = rel_one(obj, "assembly")
    study = rel_one(obj, "study"); samp = rel_one(obj, "sample")
    if run:   rm["run_id"] = run;       rm["run_type"] = rel_type(obj, "run")
    if asm:   rm["assembly_id"] = asm;  rm["assembly_type"] = rel_type(obj, "assembly")
    if study: rm["study_id"] = study;   rm["study_type"] = rel_type(obj, "study")
    if samp:  rm["sample_id"] = samp;   rm["sample_type"] = rel_type(obj, "sample")
    if run:   rm["has_assembly"] = bool(asm)
    return rm


def _analysis_metadata(obj: dict) -> dict:
    """analysis_summary is omitted when empty; every other key is always present."""
    m = {
        "is_private": attr(obj, "is-private"),
        "last_update": attr(obj, "last-update"),
        "mgnify_links": {"self": self_link(obj)},
        "complete_time": attr(obj, "complete-time"),
        "mgx_accession": attr(obj, "mgx-accession"),
        "analysis_status": attr(obj, "analysis-status"),
        "instrument_model": attr(obj, "instrument-model"),
        "pipeline_version": attr(obj, "pipeline-version"),
        "instrument_platform": attr(obj, "instrument-platform"),
        "analysis_result_links": _analysis_result_links(obj),
        "relationships_metadata": _analysis_rel_meta(obj),
    }
    s = _analysis_summary(obj)
    if s is not None:
        m["analysis_summary"] = s
    return m


def emit_analysis(accession: str, obj: dict) -> Iterator[Record]:
    nk = scoped(SOURCE, accession)
    # external_id and data_source_ids unset, tool_name '' (not None): as in production.
    yield Record("analyses", nk,
                 {"accession": accession, "name": accession,
                  "analysis_type": attr(obj, "experiment-type"), "tool_name": "",
                  "metadata": json.dumps(_analysis_metadata(obj), separators=(",", ":"))},
                 {})
    samp = rel_one(obj, "sample")
    if samp:
        s_nk = scoped(SOURCE, samp)
        yield Record("sample_analyses", f"{s_nk}|{nk}", {},
                     refs={"sample_id": ("samples", s_nk), "analysis_id": ("analyses", nk)})
    asm = rel_one(obj, "assembly")
    if asm:
        a_nk = scoped(SOURCE, asm)
        yield Record("assembly_analyses", f"{a_nk}|{nk}", {},
                     refs={"assembly_id": ("assemblies", a_nk), "analysis_id": ("analyses", nk)})
    run = rel_one(obj, "run")
    if run:
        r_nk = scoped(SOURCE, run)
        yield Record("run_analyses", f"{r_nk}|{nk}", {},
                     refs={"run_id": ("runs", r_nk), "analysis_id": ("analyses", nk)})


def _run_metadata(obj: dict) -> dict:
    """assembly_ids is omitted when empty."""
    rm = {}
    study = rel_one(obj, "study"); samp = rel_one(obj, "sample")
    if study: rm["study_id"] = study; rm["study_type"] = rel_type(obj, "study")
    if samp:  rm["sample_id"] = samp; rm["sample_type"] = rel_type(obj, "sample")
    asm_ids = rel_many(obj, "assemblies")
    if asm_ids: rm["assembly_ids"] = asm_ids
    al = links_related(obj, "analyses")
    if al is not None: rm["analyses_link"] = al
    return {
        "is_private": attr(obj, "is-private"),
        "mgnify_links": {"self": self_link(obj)},
        "experiment_type": attr(obj, "experiment-type"),
        "ena_study_accession": attr(obj, "ena-study-accession"),
        "relationships_metadata": rm,
    }


def emit_run(accession: str, obj: dict) -> Iterator[Record]:
    """sample_runs and run_studies are emitted ungated; the dump-pass driver drops
    junctions whose target was not emitted, as production did. run_assemblies is owned
    by emit_assembly.
    """
    nk = scoped(SOURCE, accession)
    yield Record("runs", nk,
                 {"accession": accession,
                  "secondary_accession": attr(obj, "secondary-accession"),
                  "instrument_model": attr(obj, "instrument-model"),
                  "instrument_platform": attr(obj, "instrument-platform"),
                  "metadata": json.dumps(_run_metadata(obj), separators=(",", ":"))},
                 {})
    samp = rel_one(obj, "sample")
    if samp:
        s_nk = scoped(SOURCE, samp)
        yield Record("sample_runs", f"{s_nk}|{nk}", {},
                     refs={"sample_id": ("samples", s_nk), "run_id": ("runs", nk)})
    study = rel_one(obj, "study")
    if study:
        st_nk = scoped(SOURCE, study)
        yield Record("run_studies", f"{nk}|{st_nk}", {},
                     refs={"run_id": ("runs", nk), "study_id": ("studies", st_nk)})


def _raw_metadata(obj: dict) -> dict:
    a = obj.get("attributes") or {}
    sm = a.get("sample-metadata")
    out = {}
    if isinstance(sm, list):
        for m in sm:
            if isinstance(m, dict) and "key" in m:
                out[m["key"]] = {"unit": m.get("unit"), "value": _qstrip(m.get("value"))}
    return out


def _sample_metadata(obj: dict) -> dict:
    """All four keys are always present."""
    a = obj.get("attributes") or {}
    return {"biosample": a.get("biosample"),
            "last_update": a.get("last-update"),
            "raw_metadata": _raw_metadata(obj),
            "analysis_completed": a.get("analysis-completed")}


def emit_sample(accession: str, obj: dict) -> Iterator[Record]:
    """No study_samples: production has none for mgnify. The orchestrator sets data_source_ids."""
    from .biome import biome_nodes
    a = obj.get("attributes") or {}
    rawvals = {m["key"]: m.get("value") for m in (a.get("sample-metadata") or [])
               if isinstance(m, dict) and "key" in m}
    nk = scoped(SOURCE, accession)
    f = {"external_id": accession, "accession": accession}

    def put(col, val):
        if val not in (None, ""):
            f[col] = val

    put("name", a.get("sample-name"))
    put("sample_alias", a.get("sample-alias"))
    # The raw country field verbatim, not geo-loc-name.
    put("geographic_location", rawvals.get(_GEO_COUNTRY))
    cd = _sentinel(a.get("collection-date"))
    if isinstance(cd, str) and _DATE_RE.match(cd):
        f["collection_date"] = cd
    lat = _coerce_float(a.get("latitude"))
    lon = _coerce_float(a.get("longitude"))
    if lat is not None:
        f["latitude"] = lat
    if lon is not None:
        f["longitude"] = lon
    for col, rawkey in _ENV_RAW.items():
        raw_attr = a.get(col.replace("environment_", "environment-"))
        val = raw_attr if raw_attr not in (None, "") else rawvals.get(rawkey)
        cv = _clean(val)
        if cv is not None:
            f[col] = cv
    htax = _coerce_int(a.get("host-tax-id"))
    if htax is not None:
        f["host_taxid"] = htax
    put("host_scientific_name", a.get("species"))
    f["metadata"] = json.dumps(_sample_metadata(obj), separators=(",", ":"))
    yield Record("samples", nk, f, {})
    b = rel_one(obj, "biome")
    if b:
        nodes = biome_nodes(b)
        for path, level, parent in nodes:
            refs = {"parent_id": ("biomes", parent)} if parent else {}
            yield Record("biomes", path, {"name": path, "level": level}, refs)
        if nodes:
            leaf = nodes[-1][0]
            yield Record("sample_biomes", f"{nk}|{leaf}", {},
                         refs={"sample_id": ("samples", nk), "biome_id": ("biomes", leaf)})


def emit_study(accession: str, obj: dict) -> Iterator[Record]:
    """Also emits biome nodes: a few biome paths appear only on studies, and biome_ids
    would otherwise point at missing rows.
    """
    from .. import ids
    from .biome import biome_nodes
    a = obj.get("attributes") or {}
    nk = scoped(SOURCE, accession)
    f = {"accession": accession}
    name = a.get("study-name")
    if name not in (None, ""):
        f["study_name"] = name
        f["title"] = name                      # as in production
    for src, col in [("study-abstract", "abstract"), ("bioproject", "bioproject"),
                     ("centre-name", "center_name")]:
        v = a.get(src)
        if v not in (None, ""):
            f[col] = v
    paths = rel_many(obj, "biomes")
    if paths:
        seen = []
        for p in paths:
            u = str(ids.entity_id("biomes", p))
            if u not in seen:
                seen.append(u)
        f["biome_ids"] = seen
    yield Record("studies", nk, f, {})
    for p in paths:
        for path, level, parent in biome_nodes(p):
            refs = {"parent_id": ("biomes", parent)} if parent else {}
            yield Record("biomes", path, {"name": path, "level": level}, refs)
