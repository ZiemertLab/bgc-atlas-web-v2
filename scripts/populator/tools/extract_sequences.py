#!/usr/bin/env python3
"""Extract per-region nucleotide FASTA, per-CDS protein FASTA and per-source region-GBK
tars from the antiSMASH archives, every record keyed to ``bgcs.id``. Read-only.

Reads the per-region GBKs (the metaSMASH regions.json lacks nucleotide sequence).
base_name comes from the populator's own adapters so bgc_filename == bgcs.filename.

  bgc_filename = f"{base_name}_{contig}.region{num:03d}"   (== {base_name}_{gbk_stem})
  bgc_id       = entity_id("bgcs", bgc_filename)

Outputs (in --out):
  regions_nuc.fasta            >  >{bgc_id}                  (one per region)
  regions_prot.faa             >  >{bgc_id}_{locus_tag}      (one per CDS)
  <source>_regions_gbk.tar     -> member {bgc_id}.gbk        (one per region)
"""
from __future__ import annotations
import argparse, io, re, sys, tarfile
from pathlib import Path, PurePosixPath
from scripts.populator.populate import load_config, resolve_units, ADAPTERS
from scripts.populator.adapters.archive import archive_stem
from scripts.populator.ids import entity_id

_REGION_FILE = re.compile(r"^(?P<contig>.+)\.region(?P<num>\d+)\.gbk$")


def base_name_for(source: str, archive: Path) -> str:
    # Adapters differ: gtdb uses the dir name verbatim (archive_stem would strip
    # ".1"), custom applies its alias_fn, the rest use the archive stem.
    if source == "gtdb":
        return archive.name
    if source == "custom":
        return ADAPTERS["custom"].alias_fn(archive)
    return archive_stem(archive)


def _in_basic_dir(member_path: str) -> bool:
    """True for the duplicate basic-annotation copy MGnify archives carry under
    '<run>_basic/'; counting it doubles the region GBKs."""
    return any(part.endswith("_basic") for part in PurePosixPath(member_path).parts[:-1])


def iter_region_gbks(archive: Path):
    """Yield (gbk_basename, gbk_bytes) for every region GBK in a tarball or dir,
    skipping '<run>_basic/' duplicates."""
    seen: set[str] = set()
    if archive.is_dir():
        for p in sorted(archive.rglob("*.region*.gbk")):
            if not _REGION_FILE.match(p.name):
                continue
            if _in_basic_dir(p.relative_to(archive).as_posix()) or p.name in seen:
                continue
            seen.add(p.name)
            yield p.name, p.read_bytes()
    else:
        with tarfile.open(archive, "r:*") as tf:
            for m in tf:
                if not (m.isfile() and _REGION_FILE.match(Path(m.name).name)):
                    continue
                if _in_basic_dir(m.name):
                    continue
                bn = Path(m.name).name
                if bn in seen:
                    continue
                seen.add(bn)
                f = tf.extractfile(m)
                if f is not None:
                    yield bn, f.read()


def process_archive(source: str, archive: Path, nuc, prot, gbk_tar) -> tuple[int, int]:
    from Bio import SeqIO          # lazy: keeps base_name_for importable without Biopython
    base = base_name_for(source, archive)
    n_reg = n_cds = 0
    for gbk_name, gbk_bytes in iter_region_gbks(archive):
        m = _REGION_FILE.match(gbk_name)
        contig, num = m.group("contig"), int(m.group("num"))
        bgc_filename = f"{base}_{contig}.region{num:03d}"
        bgc_id = str(entity_id("bgcs", bgc_filename))
        try:
            rec = SeqIO.read(io.StringIO(gbk_bytes.decode("utf-8", "replace")), "genbank")
        except Exception as e:
            print(f"  WARN parse {gbk_name} in {archive.name}: {e}", file=sys.stderr)
            continue
        nuc.write(f">{bgc_id}\n{str(rec.seq)}\n")
        n_reg += 1
        for i, feat in enumerate(f for f in rec.features if f.type == "CDS"):
            tr = feat.qualifiers.get("translation")
            if not tr:
                continue
            tag = feat.qualifiers.get("locus_tag", [f"cds{i}"])[0]
            prot.write(f">{bgc_id}_{tag}\n{tr[0]}\n")
            n_cds += 1
        ti = tarfile.TarInfo(name=f"{bgc_id}.gbk")
        ti.size = len(gbk_bytes)
        gbk_tar.addfile(ti, io.BytesIO(gbk_bytes))
    return n_reg, n_cds


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="Extract region nuc/prot FASTA + GBK tars (keyed to bgcs.id)")
    ap.add_argument("--config", required=True)
    ap.add_argument("--source", required=True, help="metalog | mgnify | gtdb | custom")
    ap.add_argument("--out", required=True, help="output directory")
    ap.add_argument("--sample", type=int, default=0, help="process only first N archives PER UNIT (validation)")
    ap.add_argument("--nshards", type=int, default=1, help="split work into N shards for parallel runs")
    ap.add_argument("--shard", type=int, default=0, help="which shard (0..nshards-1) this process handles")
    a = ap.parse_args(argv)
    if not (0 <= a.shard < a.nshards):
        raise SystemExit(f"--shard must be in [0, {a.nshards})")

    cfg = load_config(a.config)
    units = resolve_units(cfg, a.source)
    out = Path(a.out); out.mkdir(parents=True, exist_ok=True)
    # Truncate, not append: re-runs into the same dir would duplicate FASTA records.
    nuc = open(out / "regions_nuc.fasta", "w")
    prot = open(out / "regions_prot.faa", "w")
    gbk_tar = tarfile.open(out / f"{a.source}_regions_gbk.tar", "w")
    tot_arch = tot_reg = tot_cds = 0
    for u in units:
        archs = u.archives[: a.sample] if a.sample else u.archives
        if a.nshards > 1:
            archs = archs[a.shard::a.nshards]
        for arch in archs:
            # Keyed by the unit's adapter, not --source, so --source all works.
            r, c = process_archive(u.adapter, Path(arch), nuc, prot, gbk_tar)
            tot_arch += 1; tot_reg += r; tot_cds += c
            if tot_arch % 500 == 0:
                print(f"  [{a.source}] {tot_arch} archives, {tot_reg} regions, {tot_cds} CDS", flush=True)
    nuc.close(); prot.close(); gbk_tar.close()
    print(f"DONE {a.source}: archives={tot_arch} regions={tot_reg} cds={tot_cds} -> {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
