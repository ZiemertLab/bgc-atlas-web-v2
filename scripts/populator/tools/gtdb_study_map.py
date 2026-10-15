"""Helpers for deriving a GTDB genome's study (NCBI BioProject), shared by
backfill_gtdb_studies and build_gtdb_enrichment_sidecar.

Preference: the BioSample's own bioproject link (GTDB's ncbi_bioproject is often the
RefSeq annotation umbrella PRJNA224116), then GTDB's ncbi_bioproject.
"""
import csv
import glob
import os
from typing import Dict

from scripts.populator.tools.gtdb_dump_load import iter_gtdb_dump
from scripts.populator.tools.parse_biosample import parse_biosample_bioprojects
from scripts.populator.tools.parse_bioproject import parse_bioproject_set


def load_acc_bioproject(path) -> Dict[str, str]:
    """accession -> GTDB ncbi_bioproject (from the release bioproject TSV); none dropped."""
    out = {}
    with open(path, newline="") as fh:
        for row in csv.reader(fh, delimiter="\t"):
            if len(row) >= 2 and row[1] and row[1].lower() != "none":
                out[row[0]] = row[1]
    return out


def name_to_biosample(dump_path) -> Dict[str, str]:
    """genome accession -> ncbi_biosample (from the Tier 1 dump)."""
    out = {}
    for ext, fields in iter_gtdb_dump(dump_path):
        bs = fields.get("ncbi_biosample")
        if bs:
            out[ext] = bs
    return out


def load_biosample_bioprojects(cache_dir) -> Dict[str, str]:
    """biosample accession -> its own BioProject, from cached BioSample XML links."""
    out = {}
    for path in sorted(glob.glob(os.path.join(cache_dir, "batch_*.xml"))):
        try:
            with open(path, "rb") as fh:
                out.update(parse_biosample_bioprojects(fh.read()))
        except Exception:
            pass
    return out


def load_titles(bp_cache_dir) -> Dict[str, str]:
    """bioproject accession -> title, from cached BioProject XML (bp_*.xml)."""
    titles = {}
    for path in sorted(glob.glob(os.path.join(bp_cache_dir, "bp_*.xml"))):
        try:
            with open(path, "rb") as fh:
                titles.update(parse_bioproject_set(fh.read()))
        except Exception:                 # skip a truncated/corrupt cached batch
            pass
    return titles
