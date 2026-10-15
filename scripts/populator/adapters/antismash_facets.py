"""Extract searchable BGC facets from an antiSMASH v8 results JSON.

One record per area (region), later keyed to ``bgc_id`` by ``(contig, start, end)``.

- region number is per-record, 1-based; modules keyed by region use ``str(i+1)``.
- feature ``qualifiers`` values are always lists of strings.
- the results ``version`` string is unreliable (metaSMASH reports its own); key logic
  off structure, never version.
"""
from __future__ import annotations

import logging
import re
import tarfile
from typing import Dict, Iterator, List, Optional

import ijson

log = logging.getLogger(__name__)

_AUX_JSON_DIRS = (
    "/knownclusterblast/",
    "/clusterblast/",
    "/clusterblastoutput",
    "/smcogs/",
    "/svg/",
    "/css/",
    "/js/",
    "/images/",
    "/html/",
)

_LOC = re.compile(r"\[<?(\d+):>?(\d+)\]")


def _loc_bounds(location: Optional[str]):
    m = _LOC.search(location or "")
    return (int(m.group(1)), int(m.group(2))) if m else (None, None)


def _q1(feat: Optional[dict], key: str):
    if not feat:
        return None
    v = feat.get("qualifiers", {}).get(key)
    if isinstance(v, list):
        return v[0] if v else None
    return v


def _index_features(record: dict) -> Dict[str, List[dict]]:
    by_type: Dict[str, List[dict]] = {}
    for f in record.get("features", []):
        by_type.setdefault(f.get("type"), []).append(f)
    return by_type


def _uniq(seq) -> list:
    out: list = []
    seen = set()
    for x in seq:
        if x is None or x in seen:
            continue
        seen.add(x)
        out.append(x)
    return out


def _mod(rec: dict, name: str) -> dict:
    return (rec.get("modules") or {}).get(name) or {}


def _overlaps(location: Optional[str], s: int, e: int) -> bool:
    cs, ce = _loc_bounds(location)
    return cs is not None and cs < e and ce > s


def _region_loci(by_type: Dict[str, List[dict]], s: int, e: int) -> set:
    loci = set()
    for f in by_type.get("CDS", []):
        if _overlaps(f.get("location"), s, e):
            lt = _q1(f, "locus_tag")
            if lt:
                loci.add(lt)
    return loci


_GENE_KIND_FIELD = {
    "biosynthetic": "n_core_biosynthetic",
    "biosynthetic-additional": "n_additional_biosynthetic",
    "transport": "n_transport",
    "regulatory": "n_regulatory",
    "resistance": "n_resistance",
}


def _gene_functions(by_type: Dict[str, List[dict]], loci: set) -> dict:
    counts = {field: 0 for field in _GENE_KIND_FIELD.values()}
    for f in by_type.get("CDS", []):
        if _q1(f, "locus_tag") not in loci:
            continue
        gk = f.get("qualifiers", {}).get("gene_kind")
        kind = gk[0] if isinstance(gk, list) and gk else (gk or "")
        field = _GENE_KIND_FIELD.get(kind)
        if field:
            counts[field] += 1
    return counts


def _region_level(rec: dict, area: dict, i: int, region_feat: Optional[dict]) -> dict:
    cats: List[str] = []
    for pc in (area.get("protoclusters") or {}).values():
        c = pc.get("category")
        if c and c not in cats:
            cats.append(c)
    edge = _q1(region_feat, "contig_edge")
    rules = (region_feat or {}).get("qualifiers", {}).get("rules", []) or []
    return {
        "contig": rec.get("id"),
        "start": int(area["start"]),
        "end": int(area["end"]),
        "region_number": i + 1,
        "product_type": list(area.get("products", [])),
        "product_category": cats,
        "is_complete": str(edge).lower() != "true",
        "gc_content": rec.get("gc_content"),
        "candidate_kind": _uniq(c.get("kind") for c in area.get("candidates", [])),
        "num_protoclusters": len(area.get("protoclusters") or {}),
        "detection_rules": list(rules),
    }


def _functional_hits(rec: dict, area: dict, loci: set) -> dict:
    s, e = int(area["start"]), int(area["end"])

    ch_hits = [
        h
        for h in _mod(rec, "antismash.detection.cluster_hmmer").get("hits", [])
        if h.get("identifier") and _overlaps(h.get("location"), s, e)
    ]
    pfam = _uniq(h["identifier"].split(".")[0] for h in ch_hits)
    pfam_desc = _uniq(h.get("description") for h in ch_hits if h.get("description"))

    tf_hits = [
        h
        for h in _mod(rec, "antismash.detection.tigrfam").get("hits", [])
        if h.get("identifier")
        and (_overlaps(h.get("location"), s, e) or h.get("locus_tag") in loci)
    ]
    tigrfam = _uniq(h["identifier"] for h in tf_hits)
    tigrfam_desc = _uniq(h.get("description") for h in tf_hits if h.get("description"))

    smcogs = _mod(rec, "antismash.detection.genefunctions").get("tools", {}).get(
        "smcogs", {}
    ).get("best_hits", {})
    sm_hits = [v for lt, v in smcogs.items() if lt in loci and v.get("reference_id")]
    smcog = _uniq(v.get("reference_id") for v in sm_hits)
    smcog_desc = _uniq(v.get("description") for v in sm_hits if v.get("description"))
    domains: List[str] = []
    cds_results = _mod(rec, "antismash.detection.nrps_pks_domains").get("cds_results", {})
    for lt, cr in cds_results.items():
        if lt in loci:
            domains.extend(dh.get("hit_id") for dh in cr.get("domain_hmms", []))
    antismash_domains = _uniq(domains)

    pf_nover = {p for p in pfam}
    go: List[str] = []
    for pfid, god in _mod(rec, "antismash.modules.pfam2go").get("pfams", {}).items():
        if pfid.split(".")[0] in pf_nover:
            go.extend(god.keys())
    go_terms = _uniq(go)

    tta_codons = sum(
        1
        for c in _mod(rec, "antismash.modules.tta").get("TTA codons", [])
        if s <= c.get("start", -1) < e
    )
    return {
        "pfam": pfam,
        "pfam_desc": pfam_desc,
        "tigrfam": tigrfam,
        "tigrfam_desc": tigrfam_desc,
        "smcog": smcog,
        "smcog_desc": smcog_desc,
        "antismash_domains": antismash_domains,
        "go_terms": go_terms,
        "tta_codons": tta_codons,
    }


def _domain_in_region(domain_id: str, loci: set) -> bool:
    return any(domain_id.startswith(f"nrpspksdomains_{lt}_") for lt in loci)


def _nrps_pks(rec: dict, area: dict, loci: set, region_number: int) -> dict:
    npk = _mod(rec, "antismash.modules.nrps_pks")
    consensus = npk.get("consensus", {})
    dp = npk.get("domain_predictions", {})
    transat = npk.get("consensus_transat", {})

    monomers = _uniq(v for d, v in consensus.items() if _domain_in_region(d, loci))

    substrates: List[str] = []
    stach: List[str] = []
    at_spec: List[str] = []
    kr: List[str] = []
    for d, pred in dp.items():
        if not _domain_in_region(d, loci):
            continue
        nrpys = pred.get("nrpys", {})
        for sub in (nrpys.get("single_amino") or {}).get("substrates", []):
            if sub.get("short"):
                substrates.append(sub["short"])
        for m in nrpys.get("stachelhaus_matches", []):
            if m.get("signature"):
                stach.append(m["signature"])
            for sub in m.get("substrates", []):
                if sub.get("short"):
                    substrates.append(sub["short"])
        preds = (pred.get("minowa_at") or {}).get("predictions") or []
        if preds and preds[0]:
            at_spec.append(preds[0][0])  # top-scoring AT substrate
        krp = (pred.get("kr_stereochem") or {}).get("prediction")
        if krp:
            kr.append(krp)

    module_sigs: List[str] = []
    num_modules = 0
    cds_results = _mod(rec, "antismash.detection.nrps_pks_domains").get("cds_results", {})
    for lt, cr in cds_results.items():
        if lt not in loci:
            continue
        for module in cr.get("modules", []):
            num_modules += 1
            sig = "-".join(
                comp.get("domain", {}).get("hit_id", "")
                for comp in module.get("components", [])
            )
            if sig:
                module_sigs.append(sig)

    rp = npk.get("region_predictions", {}).get(str(region_number), []) or []
    smiles = _uniq(x.get("smiles") for x in rp if x.get("smiles"))
    polymers = _uniq(x.get("polymer") for x in rp if x.get("polymer"))

    trans_at = ("transAT-PKS" in area.get("products", [])) or any(
        _domain_in_region(d, loci) for d in transat
    )
    return {
        "substrates": _uniq(substrates),
        "monomers": monomers,
        "stachelhaus_codes": _uniq(stach),
        "at_specificity": _uniq(at_spec),
        "kr_stereochemistry": _uniq(kr),
        "module_signatures": _uniq(module_sigs),
        "num_modules": num_modules,
        "predicted_smiles": smiles,
        "monomer_consensus": polymers,
        "pks_trans_at": bool(trans_at),
    }


def _t2_name(x):
    """A T2PKS entry may be a str, [name, ...] list, or dict."""
    if isinstance(x, str):
        return x
    if isinstance(x, (list, tuple)):
        return x[0] if x else None
    if isinstance(x, dict):
        return x.get("name") or x.get("class")
    return None


def _region_pcnums(by_type: Dict[str, List[dict]], s: int, e: int) -> set:
    nums = set()
    for f in by_type.get("protocluster", []):
        if _overlaps(f.get("location"), s, e):
            n = _q1(f, "protocluster_number")
            if n is not None:
                nums.add(str(n))
    return nums


def _terpene_t2pks(rec: dict, pcnums: set) -> dict:
    terp = _mod(rec, "antismash.modules.terpene").get("protocluster_predictions", {})
    tprod: List[str] = []
    tdom: List[str] = []
    for pc in pcnums:
        pd = terp.get(pc) or {}
        tprod.extend(pd.get("products", []))
        for preds in (pd.get("cds_predictions") or {}).values():
            tdom.extend(x.get("domain_type") for x in preds)

    # starter_units is a list of [name, score, score2] lists.
    t2 = _mod(rec, "antismash.modules.t2pks").get("protocluster_predictions", {})
    cls: List[str] = []
    starter: List[str] = []
    elong: List[str] = []
    for pc in pcnums:
        pd = t2.get(pc) or {}
        cls.extend(_t2_name(x) for x in pd.get("product_classes", []))
        starter.extend(_t2_name(x) for x in pd.get("starter_units", []))
        elong.extend(_t2_name(x) for x in pd.get("elongations", []))
    return {
        "terpene_products": _uniq(tprod),
        "terpene_domains": _uniq(tdom),
        "pks_t2_class": _uniq(cls),
        "pks_t2_starter": _uniq(starter),
        "pks_t2_elongation": _uniq(elong),
    }


_RIPP_MODULES = (
    "antismash.modules.lanthipeptides",
    "antismash.modules.lassopeptides",
    "antismash.modules.sactipeptides",
    "antismash.modules.thiopeptides",
)


# `detailed_info` mixes categorical annotations with numbers and sequences. This is an
# allowlist so a new numeric key cannot pollute `ripp_modifications`; a new categorical
# annotation must be added here before it becomes searchable.
_RIPP_MOD_KEYS = (
    "predicted_additional_modifications",
    "macrocycle",
    "core_features",
    "tail_reaction",
)


def _coerce(vals, cast):
    """detailed_info values arrive as strings ("2278.065915"); drop what won't cast."""
    out = []
    for v in vals:
        try:
            out.append(cast(v))
        except (TypeError, ValueError):
            pass
    return out


def _iter_ripp_motifs(module: dict):
    """motifs are a dict-keyed-by-locus (lanthi/lasso/sacti) or a bare list (thio)."""
    motifs = module.get("motifs")
    if isinstance(motifs, dict):
        for lst in motifs.values():
            for m in lst:
                yield m
    elif isinstance(motifs, list):
        for m in motifs:
            yield m


def _locus_in_region(lt: Optional[str], loci: set) -> bool:
    """RiPP precursors have synthetic '<cds>_<ripptype>' locus tags, so also try the base."""
    if not lt:
        return False
    return lt in loci or lt.rsplit("_", 1)[0] in loci


def _ripp(rec: dict, loci: set, s: int, e: int) -> dict:
    cls: List[str] = []
    sub: List[str] = []
    core: List[str] = []
    leader: List[str] = []
    mass: List[float] = []
    rodeo: List[int] = []
    mods: List[str] = []
    comp: List[str] = []
    cut_mass: List[float] = []
    cut_weight: List[float] = []
    mature_weight: List[float] = []
    bridges: List[int] = []
    macrolactam: List[str] = []
    for name in _RIPP_MODULES:
        mod = _mod(rec, name)
        if not mod:
            continue
        for m in _iter_ripp_motifs(mod):
            # Scope by location: motif locus_tags are synthetic, so not in the CDS list.
            loc = m.get("location")
            if loc is not None:
                if not _overlaps(loc, s, e):
                    continue
            elif not _locus_in_region(m.get("locus_tag"), loci):
                continue
            if m.get("peptide_class"):
                cls.append(m["peptide_class"])
            if m.get("peptide_subclass"):
                sub.append(m["peptide_subclass"])
            if m.get("core"):
                core.append(m["core"])
            if m.get("leader"):
                leader.append(m["leader"])
            if m.get("monoisotopic_mass") is not None:
                mass.append(m["monoisotopic_mass"])
            di = m.get("detailed_info") or {}
            for rs in di.get("RODEO_score", []):
                try:
                    rodeo.append(int(rs))
                except (TypeError, ValueError):
                    pass
            for k, v in di.items():
                if k == "RODEO_score":
                    continue
                vals = v if isinstance(v, list) else [v]
                if k == "cut_mass":
                    cut_mass.extend(_coerce(vals, float))
                elif k == "cut_weight":
                    cut_weight.extend(_coerce(vals, float))
                elif k == "mature_weights":
                    mature_weight.extend(_coerce(vals, float))
                elif k == "number_of_bridges":
                    bridges.extend(_coerce(vals, int))
                elif k == "macrolactam":
                    macrolactam.extend(str(x) for x in vals if str(x))
                elif k in _RIPP_MOD_KEYS:
                    # empty values ("macrocycle:") carry no filtering signal
                    mods.extend(f"{k}:{x}" for x in vals if str(x))
        # The subkey name differs across RiPP modules.
        for key in ("comparippson", "comparippson_results"):
            for dbres in (mod.get(key) or {}).get("db_results", []):
                for locus, hlist in (dbres.get("hits") or {}).items():
                    if loci and not _locus_in_region(locus, loci):
                        continue
                    for h in hlist:
                        acc = (h.get("reference_fields") or {}).get("accession")
                        if acc:
                            comp.append(acc)
    return {
        "ripp_class": _uniq(cls),
        "ripp_subclass": _uniq(sub),
        "core_seq": _uniq(core),
        "leader_seq": _uniq(leader),
        "ripp_mass": _uniq(mass),
        "rodeo_score": _uniq(rodeo),
        "ripp_modifications": _uniq(mods),
        "comparippson_hits": _uniq(comp),
        "ripp_cut_mass": _uniq(cut_mass),
        "ripp_cut_weight": _uniq(cut_weight),
        "ripp_mature_weight": _uniq(mature_weight),
        "ripp_num_bridges": _uniq(bridges),
        "ripp_macrolactam": _uniq(macrolactam),
    }


def _comparative(rec: dict, region_number: int) -> dict:
    cb = _mod(rec, "antismash.modules.clusterblast")

    def ranking(subkey: str) -> list:
        for res in cb.get(subkey, {}).get("results", []):
            if res.get("region_number") == region_number:
                return res.get("ranking", []) or []
        return []

    kc = ranking("knowncluster")
    kc_hits = _uniq(e[0].get("accession") for e in kc if e and e[0].get("accession"))
    kc_comp = _uniq(e[0].get("description") for e in kc if e and e[0].get("description"))
    top = kc[0] if kc else None

    gen = ranking("general")
    sub = ranking("subcluster")

    # cluster_compare: MIBiG similarity, keyed "ACCESSION: start-end" -> float 0..1
    cc = (
        _mod(rec, "antismash.modules.cluster_compare")
        .get("db_results", {})
        .get("MIBiG", {})
        .get("by_region", {})
        .get(str(region_number), {})
    )
    cc_top = None
    cc_top_score = None
    for method in cc.values():
        for acc_coord, score in (method.get("scores_by_region") or {}).items():
            if cc_top_score is None or score > cc_top_score:
                cc_top_score = score
                cc_top = acc_coord.split(":")[0].strip()

    tf = _mod(rec, "antismash.modules.tfbs_finder").get("hits_by_region", {}).get(
        str(region_number), []
    )
    return {
        "knowncluster_hits": kc_hits,
        "knowncluster_compounds": kc_comp,
        "knowncluster_top": top[0].get("accession") if top else None,
        "knowncluster_top_compound": top[0].get("description") if top else None,
        "knowncluster_top_similarity": top[1].get("similarity") if top else None,
        "num_knowncluster_hits": len(kc),
        "clusterblast_hits": _uniq(
            e[0].get("accession") for e in gen if e and e[0].get("accession")
        ),
        "subcluster_hits": _uniq(
            e[0].get("accession") for e in sub if e and e[0].get("accession")
        ),
        "mibig_comparison_top": cc_top,
        "mibig_comparison_top_score": cc_top_score,
        "tfbs_regulators": _uniq(h.get("name") for h in tf),
    }


def facets_for_record(rec: dict) -> Iterator[dict]:
    by_type = _index_features(rec)
    region_by_bounds = {
        _loc_bounds(rf.get("location")): rf for rf in by_type.get("region", [])
    }
    for i, area in enumerate(rec.get("areas", [])):
        bounds = (int(area["start"]), int(area["end"]))
        region_feat = region_by_bounds.get(bounds)
        loci = _region_loci(by_type, *bounds)
        pcnums = _region_pcnums(by_type, *bounds)
        doc = _region_level(rec, area, i, region_feat)
        doc.update(_functional_hits(rec, area, loci))
        doc.update(_gene_functions(by_type, loci))
        doc.update(_nrps_pks(rec, area, loci, i + 1))
        doc.update(_terpene_t2pks(rec, pcnums))
        doc.update(_ripp(rec, loci, *bounds))
        doc.update(_comparative(rec, i + 1))
        yield doc


def parse_facets(data: dict) -> Iterator[dict]:
    for rec in data.get("records", []):
        yield from facets_for_record(rec)


def find_results_json_member(names: List[str]) -> Optional[str]:
    """``<run>_regions.json`` (metalog), ``<run>.json`` under ``antismash/`` (gtdb), or a
    nested ``<run>.json`` (mgnify)."""
    cands = [
        n for n in names
        if n.endswith(".json") and not any(a in n for a in _AUX_JSON_DIRS)
    ]
    if not cands:
        return None
    for n in cands:
        if n.endswith("_regions.json"):
            return n
    under_as = [n for n in cands if "/antismash/" in n]
    pool = under_as or cands
    return min(pool, key=lambda n: n.count("/"))


def stream_facets_from_tar(
    archive_path: str, member: Optional[str] = None
) -> Iterator[dict]:
    """Streams with ijson, so memory stays bounded on multi-GB metagenome files."""
    with tarfile.open(archive_path, "r:*") as tar:
        if member is None:
            member = find_results_json_member(tar.getnames())
        if member is None:
            log.warning("no results JSON found in %s", archive_path)
            return
        f = tar.extractfile(member)
        if f is None:
            log.warning("could not read %s from %s", member, archive_path)
            return
        # use_float: floats, not Decimal, for range queries and JSON serialization.
        for rec in ijson.items(f, "records.item", use_float=True):
            yield from facets_for_record(rec)
