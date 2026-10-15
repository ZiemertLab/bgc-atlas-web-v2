from __future__ import annotations
import re
import argparse, json, logging, shutil, sys
from concurrent.futures import ProcessPoolExecutor, as_completed
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable, Dict, List, Optional, Tuple
import yaml
from .core.record import Record
from .core.registry import Registry
from .core.writer import (write_tables, write_table_chunk, BGCS_SCHEMA,
                          BGC_TAXONOMY_SCHEMA)
from .schema import TABLES
from .adapters import custom, metalog, mgnify, gtdb, mag
from .adapters import mgnify_antismash_run
from .adapters import mfd_metadata
from .adapters.archive import archive_stem, derive_alias
from .adapters.custom import source_name as custom_source_name
from .validate import validate_tables

log = logging.getLogger("populator")
POPULATOR_VERSION = "0.1.0"


@dataclass
class Unit:
    """A set of archives that becomes one output directory and one data_source.
    Fields are picklable so workers can run in a ProcessPool."""
    key: str                       # output subdir name AND the data_sources name
    adapter: str
    dataset: Optional[str]
    archives: List[Path] = field(default_factory=list)
    # antismash_runs.antismash_version / pipeline_version, from the source's config.
    run_versions: Optional["RunVersions"] = None


@dataclass(frozen=True)
class RunVersions:
    """Which antiSMASH (and wrapper) produced a source's runs. The archives do not reliably
    say: converted archives display a metaSMASH version that never ran, so the config states
    it. ``by_dir`` overrides the source default for runs whose file_path lies under a directory,
    for sources that mix cohorts (metalog with SPIRE env-only runs, GTDB with its re-run)."""
    default: Optional[Tuple[str, Optional[str]]] = None
    by_dir: Tuple[Tuple[str, str, Optional[str]], ...] = ()

    def for_path(self, file_path: str) -> Optional[Tuple[str, Optional[str]]]:
        resolved = str(Path(file_path).resolve())
        for d, antismash, pipeline in self.by_dir:
            if resolved.startswith(d.rstrip("/") + "/"):
                return antismash, pipeline
        return self.default


def _version_pair(entry: dict, where: str) -> Optional[Tuple[str, Optional[str]]]:
    antismash = entry.get("antismash_version")
    pipeline = entry.get("pipeline_version")
    if antismash is None and pipeline is None:
        return None
    if not isinstance(antismash, str) or not antismash.strip():
        raise SystemExit(f"{where}: antismash_version must be a non-empty string")
    if pipeline is not None and (not isinstance(pipeline, str) or not pipeline.strip()):
        raise SystemExit(f"{where}: pipeline_version must be a non-empty string or null")
    return antismash, pipeline


def run_versions_for(entry: dict, name: str) -> Optional[RunVersions]:
    default = _version_pair(entry, f"source {name!r}")
    by_dir = []
    for i, ov in enumerate(entry.get("run_versions") or []):
        where = f"source {name!r} run_versions[{i}]"
        if not isinstance(ov, dict) or not ov.get("dir"):
            raise SystemExit(f"{where}: needs a 'dir'")
        pair = _version_pair(ov, where)
        if pair is None:
            raise SystemExit(f"{where}: needs antismash_version")
        by_dir.append((str(Path(ov["dir"]).resolve()), *pair))
    if default is None and not by_dir:
        return None
    return RunVersions(default=default, by_dir=tuple(by_dir))


def load_config(path) -> dict:
    with open(path) as f:
        return yaml.safe_load(f)


def dataset_archives(base_dir, dataset, limit: Optional[int] = None) -> List[Path]:
    archives = sorted((Path(base_dir) / dataset).glob("*.tar.gz"))
    return archives[:limit] if limit is not None else archives


def _custom_units(entry: dict, name: str) -> List[Unit]:
    base = entry.get("base_dir")
    if not base:
        raise SystemExit(f"source {name!r}: missing required config key 'base_dir'")
    if not Path(base).is_dir():
        raise SystemExit(f"source {name!r}: base_dir {base!r} does not exist")
    datasets = entry.get("datasets")
    if not datasets:
        raise SystemExit(f"source {name!r}: missing required config key 'datasets'")
    return [Unit(key=custom_source_name(ds), adapter="custom", dataset=ds,
                 archives=dataset_archives(base, ds))
            for ds in datasets]

_FOREIGN_NK = re.compile(r"^[a-z0-9_]+\|\S+$")


def _check_study_overrides(ov, name: str):
    """metalog `study_overrides`: {key_by_code: [code, ...], existing: {code: "<source>|<key>"}}.
    Malformed config fails loudly: a scalar key_by_code would become a set of characters,
    and a mis-shaped `existing` target would mint a new, nameless study."""
    if not ov:
        return None
    bad = SystemExit(f"source {name!r}: malformed study_overrides {ov!r}")
    if not isinstance(ov, dict) or set(ov) - {"key_by_code", "existing"}:
        raise bad
    kbc = ov.get("key_by_code", [])
    if not isinstance(kbc, list) or not all(isinstance(c, str) and c for c in kbc):
        raise bad
    ex = ov.get("existing", {})
    if not isinstance(ex, dict) or not all(
            isinstance(k, str) and isinstance(v, str) and _FOREIGN_NK.match(v)
            for k, v in ex.items()):
        raise bad
    return ov


def _metalog_units(entry: dict, name: str) -> List[Unit]:
    bases = entry.get("base_dirs")
    if not bases:
        single = entry.get("base_dir")
        bases = [single] if single else None
    if not bases:
        raise SystemExit(f"source {name!r}: missing required config key 'base_dir' or 'base_dirs'")
    for d in bases:
        if not Path(d).is_dir():
            raise SystemExit(f"source {name!r}: directory {d!r} does not exist")
    # With `env_measurements` the dataset becomes a dict so sample_measurements are emitted too.
    env = entry.get("env_metadata")
    measurements = entry.get("env_measurements")
    overrides = _check_study_overrides(entry.get("study_overrides"), name)
    if overrides:
        dataset = {"env": env, "measurements": measurements, "study_overrides": overrides}
    elif measurements:
        dataset = {"env": env, "measurements": measurements}
    else:
        dataset = env
    archives = sorted({p.resolve() for b in bases for p in Path(b).glob("*.tar.gz")})
    # A second metalog source (a later batch with its own env tables) needs its own output dir;
    # its records keep metalog's provenance.
    key = entry.get("unit_key", metalog.SOURCE)
    if key != metalog.SOURCE:
        _PROVENANCE.setdefault(key, _PROVENANCE[metalog.SOURCE])
    return [Unit(key=key, adapter="metalog", dataset=dataset, archives=archives)]

_MGNIFY_RUN_KEY = re.compile(r"^MGYA(\d+)_(ERZ\d+)$")


def load_keep_runs(path: str) -> set:
    """Run keys (MGYA..._ERZ...) chosen for already-deduplicated assemblies."""
    p = Path(path)
    if not p.exists():
        return set()
    return {line.strip() for line in p.read_text().splitlines() if line.strip()}


def dedupe_mgnify_archives(archives: List[Path], keep: set) -> List[Path]:
    """Keep one tarball per ERZ assembly: the run named in `keep`, else the highest
    MGYA (logged as unreviewed). Names that are not MGYA_ERZ pass through.
    """
    by_erz: dict = {}
    passthrough: List[Path] = []
    for path in archives:
        stem = archive_stem(path)
        m = _MGNIFY_RUN_KEY.match(stem)
        if not m:
            passthrough.append(path)
            continue
        by_erz.setdefault(m.group(2), []).append((int(m.group(1)), stem, path))
    kept: List[Path] = []
    unreviewed = 0
    for erz, runs in by_erz.items():
        if len(runs) == 1:
            kept.append(runs[0][2])
            continue
        chosen = [r for r in runs if r[1] in keep]
        if len(chosen) != 1:
            chosen = [max(runs)]
            unreviewed += 1
            log.warning("mgnify: %s has %d analyses (%s); keeping %s", erz, len(runs),
                        ", ".join(r[1] for r in sorted(runs)), chosen[0][1])
        kept.append(chosen[0][2])
    if unreviewed:
        log.warning("mgnify: %d assemblies had several analyses not in the keep list", unreviewed)
    return sorted(passthrough + kept)


def _mgnify_units(entry: dict, name: str) -> List[Unit]:
    base = entry.get("base_dir")
    if not base:
        raise SystemExit(f"source {name!r}: missing required config key 'base_dir'")
    if not Path(base).is_dir():
        raise SystemExit(f"source {name!r}: base_dir {base!r} does not exist")
    archives = sorted(Path(base).glob("*.tar.gz"))
    log.info("mgnify: %d run tarballs under %s", len(archives), base)
    # MGnify analyses some assemblies more than once; each MGYA_ERZ tarball holds the
    # same regions, so ingesting all of them would store those BGCs twice.
    keep_file = entry.get("keep_runs") or str(Path(__file__).parent / "data" / "mgnify" / "kept_duplicate_runs.txt")
    archives = dedupe_mgnify_archives(archives, load_keep_runs(keep_file))
    log.info("mgnify: %d after keeping one analysis per ERZ assembly", len(archives))
    # metadata_dir: None -> mgnify stays BGC-only.
    return [Unit(key="mgnify", adapter="mgnify",
                 dataset=entry.get("metadata_dir"), archives=archives)]

def _gtdb_units(entry: dict, name: str) -> List[Unit]:
    base = entry.get("base_dir")
    if not base:
        raise SystemExit(f"source {name!r}: missing required config key 'base_dir'")
    if not Path(base).is_dir():
        raise SystemExit(f"source {name!r}: base_dir {base!r} does not exist")
    # Archives are extracted genome subdirectories. `runs_tar_dir` points the
    # antismash_run file_path at the real <genome>.tar.gz the web viewer extracts.
    archives = sorted(p for p in Path(base).iterdir() if p.is_dir())
    meta = entry.get("metadata")
    bac120 = entry.get("bac120_sidecar")
    runs_tar_dir = entry.get("runs_tar_dir")
    rerun_tar_dir = entry.get("rerun_tar_dir")
    if rerun_tar_dir and not Path(rerun_tar_dir).is_dir():
        raise SystemExit(f"source {name!r}: rerun_tar_dir {rerun_tar_dir!r} does not exist")
    if bac120 or runs_tar_dir or rerun_tar_dir:
        dataset = {"metadata": meta, "bac120": bac120, "runs_tar_dir": runs_tar_dir,
                   "rerun_tar_dir": rerun_tar_dir}
    else:
        dataset = meta
    return [Unit(key=gtdb.SOURCE, adapter="gtdb", dataset=dataset, archives=archives)]

def _mag_units(entry: dict, name: str) -> List[Unit]:
    base = entry.get("base_dir")
    if not base:
        raise SystemExit(f"source {name!r}: missing required config key 'base_dir'")
    if not Path(base).is_dir():
        raise SystemExit(f"source {name!r}: base_dir {base!r} does not exist")
    collections = entry.get("collections")
    if not collections:
        raise SystemExit(f"source {name!r}: missing required config key 'collections'")
    # unit.key is the collection slug (the nk scope in mag.emit_mag_tarball and _PROVENANCE).
    units: List[Unit] = []
    for c in collections:
        if c not in mag.COLLECTIONS:
            raise SystemExit(f"source {name!r}: unknown MAG collection {c!r} (known: {list(mag.COLLECTIONS)})")
        cdir = Path(base) / c
        if not cdir.is_dir():
            raise SystemExit(f"source {name!r}: collection dir {cdir} does not exist")
        units.append(Unit(key=c, adapter="mag", dataset=c,
                          archives=sorted(cdir.glob("*.tar.gz"))))
    return units


def _mgnify_antismash_units(entry: dict, name: str) -> List[Unit]:
    base = entry.get("base_dir")
    if not base:
        raise SystemExit(f"source {name!r}: missing required config key 'base_dir'")
    if not Path(base).is_dir():
        raise SystemExit(f"source {name!r}: base_dir {base!r} does not exist")
    # BGC-only injection onto assemblies already in the DB: no metadata, no post-pass.
    archives = sorted(Path(base).glob("*.tar.gz"))
    log.info("mgnify_antismash: %d run tarballs under %s", len(archives), base)
    return [Unit(key=mgnify_antismash_run.UNIT_KEY, adapter="mgnify_antismash",
                 dataset=None, archives=archives)]


@dataclass(frozen=True)
class AdapterSpec:
    units_fn: Callable       # (entry: dict, name: str) -> List[Unit]
    alias_fn: Callable       # (path: Path) -> str  (uniqueness key)
    emit_fn: Callable        # (archive_path: str, dataset) -> Iterator[Record]
    post_emit_fn: Optional[Callable] = None   # (dataset) -> Iterator[Record], once after all archives


# emit_fn looks up module attributes at call time so tests can monkeypatch them.
ADAPTERS: Dict[str, AdapterSpec] = {
    "custom":  AdapterSpec(_custom_units,  lambda p: derive_alias(archive_stem(p)),
                           lambda path, dataset: custom.emit_archive(path, dataset)),
    "metalog": AdapterSpec(_metalog_units, lambda p: archive_stem(p),
                           lambda path, dataset: metalog.emit_archive(path, dataset)),
    "mgnify":  AdapterSpec(_mgnify_units,  lambda p: archive_stem(p),
                           lambda path, dataset: mgnify.emit_run_archive(path, dataset),
                           post_emit_fn=lambda dataset: (
                               mgnify.emit_metadata_dump(dataset) if dataset else iter(()))),
    "gtdb":    AdapterSpec(_gtdb_units,    lambda p: Path(p).name,
                           lambda path, dataset: gtdb.emit_genome_dir(path, dataset)),
    "mag":     AdapterSpec(_mag_units,     lambda p: archive_stem(p),
                           lambda path, dataset: mag.emit_mag_tarball(path, dataset)),
    "mgnify_antismash": AdapterSpec(_mgnify_antismash_units, lambda p: archive_stem(p),
                           lambda path, dataset: mgnify_antismash_run.emit_run_archive(path)),
}


# Config keys each adapter type reads (besides `type`); RUN_VERSION_KEYS apply to every type.
RUN_VERSION_KEYS = {"antismash_version", "pipeline_version", "run_versions"}
CONFIG_KEYS: Dict[str, set] = {
    "custom": {"base_dir", "datasets"},
    "metalog": {"base_dir", "base_dirs", "env_metadata", "env_measurements", "study_overrides",
                "unit_key"},
    "mgnify": {"base_dir", "metadata_dir", "keep_runs"},
    # `enrichment` is documented but not yet read (README, known gaps).
    "gtdb": {"base_dir", "metadata", "bac120_sidecar", "runs_tar_dir", "rerun_tar_dir", "enrichment"},
    "mag": {"base_dir", "collections"},
    "mgnify_antismash": {"base_dir"},
}


def resolve_units(cfg: dict, source_arg: str) -> List[Unit]:
    sources = cfg["sources"]
    if source_arg == "all":
        selected = [(n, None) for n in sources]
    elif ":" in source_arg:
        n, ds = source_arg.split(":", 1)
        selected = [(n, ds)]
    else:
        selected = [(source_arg, None)]
    units: List[Unit] = []
    for name, ds_filter in selected:
        if name not in sources:
            raise SystemExit(f"unknown source {name!r} (configured: {list(sources)})")
        entry = sources[name]
        if not isinstance(entry, dict):
            raise SystemExit(f"source {name!r}: config entry must be a mapping, "
                             f"got {type(entry).__name__}")
        adapter = entry.get("type", name)
        spec = ADAPTERS.get(adapter)
        if spec is None:
            raise SystemExit(f"no adapter registered for type {adapter!r}")
        unknown = set(entry) - {"type"} - CONFIG_KEYS.get(adapter, set()) - RUN_VERSION_KEYS
        if unknown:
            log.warning("source %s: config keys the %s adapter does not read: %s",
                        name, adapter, sorted(unknown))
        us = spec.units_fn(entry, name)
        versions = run_versions_for(entry, name)
        if versions is None:
            log.warning("source %s: no antismash_version configured; its runs load with NULL versions", name)
        for u in us:
            u.run_versions = versions
        if ds_filter is not None:
            us = [u for u in us if u.dataset == ds_filter]
            if not us:
                raise SystemExit(f"dataset {ds_filter!r} not found in source {name!r}")
        units.extend(us)
    return units


def check_alias_uniqueness(archives: List[Path], label: str,
                           alias_of: Callable[[Path], str]) -> None:
    """Two archives with the same alias would silently merge in the Registry."""
    seen: Dict[str, Path] = {}
    for a in archives:
        alias = alias_of(a)
        if alias in seen:
            raise ValueError(f"alias collision in {label!r}: {a} and "
                             f"{seen[alias]} both derive alias {alias!r}")
        seen[alias] = a


def _emit_records(adapter: str, dataset: Optional[str], archive_path: str) -> List[Record]:
    # Picklable seam for the ProcessPool; the lambdas in ADAPTERS are never pickled.
    spec = ADAPTERS.get(adapter)
    if spec is None:
        raise ValueError(f"unknown adapter {adapter!r}")
    return list(spec.emit_fn(archive_path, dataset))


def _emit_one(adapter: str, dataset: Optional[str], archive_path: str) -> List[Record]:
    """Worker: materialize one archive's records; raise on bgcs.filename collisions."""
    recs = _emit_records(adapter, dataset, archive_path)
    fns = [r.fields["filename"] for r in recs if r.table == "bgcs"]
    if len(fns) != len(set(fns)):
        dupes = sorted({fn for fn in fns if fns.count(fn) > 1})
        raise ValueError(f"bgcs.filename collision in {archive_path}: {dupes}")
    return recs


# Per-unit data_source provenance, matching the DB. A table absent from a profile is
# untagged; units with no profile (custom_*) fall back to [unit.key].
_PROVENANCE: Dict[str, Dict[str, List[str]]] = {
    "gtdb":    {"samples": ["GTDB"], "assemblies": ["GTDB"], "studies": ["GTDB"]},
    "mgnify":  {"samples": ["MGnify"], "studies": ["MGnify"]},
    "metalog": {"samples": ["metalog", "SPIRE"], "assemblies": ["SPIRE"],
                "analyses": ["metalog", "SPIRE"], "studies": ["metalog"]},
}
for _slug, (_dsname, _, _) in mag.COLLECTIONS.items():
    _PROVENANCE[_slug] = {"samples": [_dsname], "assemblies": [_dsname]}
# MFD custom deposit: don't tag studies, whose payload carries cross-source
# data_source_ids that finalize must not override.
_PROVENANCE[mfd_metadata.CUSTOM_SOURCE_NAME] = {
    "samples": [mfd_metadata.CUSTOM_SOURCE_NAME],
    "assemblies": [mfd_metadata.CUSTOM_SOURCE_NAME],
    "analyses": [mfd_metadata.CUSTOM_SOURCE_NAME],
}
# mgnify antiSMASH injection: untagged, like mgnify, rather than a phantom [unit.key].
_PROVENANCE[mgnify_antismash_run.UNIT_KEY] = {}


def _provenance_for(unit_key: str, table: str) -> Optional[List[str]]:
    prof = _PROVENANCE.get(unit_key)
    if prof is not None:
        return prof.get(table)
    return [unit_key]


# bgcs (multi-million rows) stream to part files in batches of this size; everything
# else stays in the aggregate Registry.
BGC_BATCH_SIZE = 500_000


class _BgcStreamer:
    """Buffers bgc Records and flushes them to ``bgcs_{NNN}.parquet`` parts,
    finalizing refs and quarantining domain violations per batch. FK integrity is
    structural (same-archive emission), so only domain rules are checked here."""

    def __init__(self, dest: Path, *,
                 emit_tsv: bool = False, batch_size: int = BGC_BATCH_SIZE):
        self.dest = Path(dest)
        self.emit_tsv = emit_tsv
        self.batch_size = batch_size
        self._buf: List[Record] = []
        self._chunk = 0
        self._reject_chunk = 0
        self._tax_chunk = 0
        self.kept_count = 0
        self.reject_count = 0
        self.tax_count = 0
        self.parts: List[dict] = []
        self.reject_parts: List[dict] = []
        self.tax_parts: List[dict] = []

    def add(self, rec: Record) -> None:
        self._buf.append(rec)
        if len(self._buf) >= self.batch_size:
            self.flush()

    def flush(self) -> None:
        if not self._buf:
            return
        # The throwaway Registry resolves entity_id refs, not merely dedup.
        tmp = Registry()
        for rec in self._buf:
            tmp.add(rec)
        finalized = tmp.finalize()
        rows = finalized.get("bgcs", [])
        tax_rows_from_records = finalized.get("bgc_taxonomy", [])
        self._buf = []
        # Written after the domain-validation split so no row points at a rejected bgc.
        tax_rows: List[dict] = list(tax_rows_from_records)
        # bgc_id is the PK: keep the first row and drop duplicates.
        seen: set = set()
        deduped = []
        for t in tax_rows:
            if t["bgc_id"] in seen:
                continue
            seen.add(t["bgc_id"])
            deduped.append(t)
        tax_rows = deduped
        # bgcs alone in scope -> FK checks skip; only domain rules fire
        bad = {i["id"] for i in validate_tables({"bgcs": rows}).domain_issues}
        kept = [r for r in rows if r.get("id") not in bad]
        rejects = [r for r in rows if r.get("id") in bad]
        if kept:
            self.parts.append(write_table_chunk(
                "bgcs", kept, self.dest, self._chunk,
                schema=BGCS_SCHEMA, emit_tsv=self.emit_tsv))
            self._chunk += 1
            self.kept_count += len(kept)
        if rejects:
            self.reject_parts.append(write_table_chunk(
                "bgcs", rejects, self.dest / "rejects", self._reject_chunk,
                schema=BGCS_SCHEMA, emit_tsv=self.emit_tsv))
            self._reject_chunk += 1
            self.reject_count += len(rejects)
        if tax_rows:
            tax_kept = [t for t in tax_rows if t["bgc_id"] not in bad]
            if tax_kept:
                self.tax_parts.append(write_table_chunk(
                    "bgc_taxonomy", tax_kept, self.dest, self._tax_chunk,
                    schema=BGC_TAXONOMY_SCHEMA, emit_tsv=self.emit_tsv))
                self._tax_chunk += 1
                self.tax_count += len(tax_kept)


def build_unit(unit: Unit, archives: List[Path], workers: int,
               streamer: Optional["_BgcStreamer"] = None
               ) -> Tuple[Registry, int, List[Tuple[str, str]]]:
    reg = Registry()
    failures: List[Tuple[str, str]] = []

    def _absorb_one(r: Record) -> None:
        if r.table == "antismash_runs" and unit.run_versions is not None \
                and r.fields.get("status") == "completed":
            pair = unit.run_versions.for_path(r.fields["file_path"])
            if pair is not None:
                r.fields.setdefault("antismash_version", pair[0])
                r.fields.setdefault("pipeline_version", pair[1])
        # bgc_taxonomy is 1:1 with bgcs, so it streams too.
        if streamer is not None and r.table in ("bgcs", "bgc_taxonomy"):
            streamer.add(r)
            return
        reg.add(r)
        if "data_source_ids" in TABLES[r.table].columns:
            names = _provenance_for(unit.key, r.table)
            if names:
                reg.set_provenance(r.table, r.natural_key, names)

    def _absorb(recs: List[Record]) -> None:
        for r in recs:
            _absorb_one(r)

    # Serial path keeps the emit seam monkeypatchable (a ProcessPool does not inherit
    # monkeypatches).
    if workers <= 1:
        for a in archives:
            try:
                recs = _emit_one(unit.adapter, unit.dataset, str(a))
            except MemoryError:
                raise
            except Exception as e:
                log.error("skipping archive %s: %s", a.name, e)
                failures.append((a.name, str(e)))
                continue
            _absorb(recs)
    else:
        with ProcessPoolExecutor(max_workers=workers) as ex:
            futs = {ex.submit(_emit_one, unit.adapter, unit.dataset, str(a)): a
                    for a in archives}
            for fut in as_completed(futs):
                a = futs[fut]
                try:
                    recs = fut.result()
                except MemoryError:
                    raise
                except Exception as e:
                    log.error("skipping archive %s: %s", a.name, e)
                    failures.append((a.name, str(e)))
                    continue
                _absorb(recs)
    # Post-pass runs after the archive loop so the metadata rows overwrite BGC
    # placeholders via Registry last-write-wins.
    spec = ADAPTERS.get(unit.adapter)
    if spec is not None and spec.post_emit_fn is not None:
        log.info("unit %s: running post-emit (metadata dump)…", unit.key)
        n = 0
        for rec in spec.post_emit_fn(unit.dataset):
            _absorb_one(rec); n += 1
        log.info("unit %s: post-emit absorbed %d records", unit.key, n)
    if streamer is not None:
        streamer.flush()
    ingested = len(archives) - len(failures)
    log.info("unit %s: ingested %d/%d archives", unit.key, ingested, len(archives))
    return reg, ingested, failures


def quarantine(tables: Dict[str, List[dict]], report) -> tuple:
    """Split domain-violating rows (by id) out of the main tables into (kept, rejects)."""
    bad: Dict[str, set] = {}
    for iss in report.domain_issues:
        bad.setdefault(iss["table"], set()).add(iss["id"])
    kept, rejects = {}, {}
    for t, rows in tables.items():
        if t in bad:
            kept[t] = [r for r in rows if r.get("id") not in bad[t]]
            rejects[t] = [r for r in rows if r.get("id") in bad[t]]
        else:
            kept[t] = rows
    return kept, rejects


def run_unit(unit: Unit, out_dir, workers: int,
             limit: Optional[int] = None, emit_tsv: bool = False,
             bgc_batch: int = BGC_BATCH_SIZE) -> Optional[dict]:
    archives = unit.archives[:limit] if limit is not None else unit.archives
    if not archives:
        log.warning("no archives for unit %s", unit.key)
        return None
    spec = ADAPTERS.get(unit.adapter)
    if spec is None:
        raise SystemExit(f"no alias function registered for adapter {unit.adapter!r}")
    check_alias_uniqueness(archives, unit.key, spec.alias_fn)
    dest = Path(out_dir) / unit.key
    # A leftover bgcs.parquet would shadow the parts, and stale higher-numbered parts
    # would double-count at load (the loader unions whatever it finds).
    if dest.exists():
        shutil.rmtree(dest)
    streamer = _BgcStreamer(dest, emit_tsv=emit_tsv, batch_size=bgc_batch)
    reg, ingested, failures = build_unit(unit, archives, workers, streamer=streamer)
    dangling = reg.drop_dangling_junctions()
    if dangling:
        log.info("%s: dropped dangling junction rows (target absent): %s", unit.key, dangling)
    tables = reg.finalize()            # non-bgcs (bgcs already streamed)
    if streamer.tax_count:
        log.info("taxonomy: emitted %d bgc_taxonomy rows in %d part(s)",
                 streamer.tax_count, len(streamer.tax_parts))
    log.info("bgcs: streamed %d rows in %d part(s); %d quarantined",
             streamer.kept_count, len(streamer.parts), streamer.reject_count)
    report = validate_tables(tables)
    if report.hard_errors:
        for e in report.hard_errors[:20]:
            log.error("hard error: %s", e)
        raise SystemExit(f"validation failed for {unit.key}: "
                         f"{len(report.hard_errors)} structural error(s)")
    kept, rejects = quarantine(tables, report)
    # A quarantined parent can orphan children that passed validation before it was removed.
    post = validate_tables(kept)
    if post.hard_errors:
        for e in post.hard_errors[:20]:
            log.error("post-quarantine structural error (orphaned by removed parent?): %s", e)
        raise SystemExit(f"quarantine orphaned rows in {unit.key}: "
                         f"{len(post.hard_errors)} structural error(s)")
    # bgcs and bgc_taxonomy were already streamed, so a quarantined parent orphans them.
    streamed_parents = set(TABLES["bgcs"].fks.values()) | set(TABLES["bgc_taxonomy"].fks.values())
    for parent in streamed_parents - {"bgcs"}:
        if rejects.get(parent):
            log.error("%s: %d %s row(s) quarantined AFTER bgcs were streamed -> those "
                      "bgcs are now orphaned; investigate before loading",
                      unit.key, len(rejects[parent]), parent)
    manifest = write_tables(kept, dest, emit_tsv=emit_tsv, version=POPULATOR_VERSION)
    manifest["tables"]["bgcs"] = {"row_count": streamer.kept_count,
                                  "parts": streamer.parts}
    if streamer.tax_parts:
        manifest["tables"]["bgc_taxonomy"] = {"row_count": streamer.tax_count,
                                              "parts": streamer.tax_parts}
    nonempty_rejects = {t: rows for t, rows in rejects.items() if rows}
    if nonempty_rejects or streamer.reject_parts:
        if nonempty_rejects:
            write_tables(nonempty_rejects, dest / "rejects", emit_tsv=emit_tsv,
                         version=POPULATOR_VERSION)
        log.warning("quarantined %d domain-violating non-bgc group(s) + %d bgc(s) -> %s",
                    len(nonempty_rejects), streamer.reject_count, dest / "rejects")
    manifest["archives"] = {
        "total": len(archives), "ingested": ingested,
        "failed": [{"archive": n, "error": e} for n, e in failures],
    }
    (dest / "manifest.json").write_text(json.dumps(manifest, indent=2))
    return manifest


def main(argv=None) -> int:
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
    p = argparse.ArgumentParser(description="Atlas Populator")
    p.add_argument("--config", required=True)
    p.add_argument("--source", required=True,
                   help="<source> | <source>:<dataset> | all (e.g. custom, custom:fram_ras, metalog)")
    p.add_argument("--emit", choices=["parquet", "tsv"], default="parquet")
    p.add_argument("--workers", type=int, default=4)
    p.add_argument("--limit", type=int, help="limit archives per unit (testing)")
    p.add_argument("--bgc-batch", type=int, default=BGC_BATCH_SIZE,
                   help="bgcs streamed per parquet part (lower = less memory, more parts)")
    p.add_argument("--allow-partial", action="store_true",
                   help="exit 0 even if some archives failed to ingest")
    args = p.parse_args(argv)

    cfg = load_config(args.config)
    out_dir = cfg["output_dir"]
    units = resolve_units(cfg, args.source)

    any_failures = False
    for unit in units:
        manifest = run_unit(unit, out_dir, args.workers,
                            limit=args.limit, emit_tsv=(args.emit == "tsv"),
                            bgc_batch=args.bgc_batch)
        if manifest:
            failed = manifest.get("archives", {}).get("failed", [])
            if failed:
                any_failures = True
                log.warning("%s: %d archive(s) failed: %s", unit.key,
                            len(failed), [f["archive"] for f in failed])
            print(f"\n=== {unit.key} ===")
            for t, e in sorted(manifest["tables"].items()):
                print(f"  {t:20s} {e['row_count']:>8d}")
    if any_failures and not args.allow_partial:
        log.error("some archives failed; exiting nonzero (use --allow-partial to override)")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
