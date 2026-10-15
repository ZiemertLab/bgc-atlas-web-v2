"""Project GTDB ``bac120_metadata.tsv`` (953 MB) down to the columns the gtdb sample
enrichment needs, so each worker loads a ~264 MB sidecar.

One-time:
    python -m scripts.populator.prep.build_gtdb_bac120_sidecar \
        --bac120 /…/metadata/gtdb/bac120_metadata.tsv \
        --out    /…/metadata/gtdb/bac120_sample_sidecar.tsv
"""
import argparse
import csv
import sys

# accession is the join key (= the gtdb genome dir name).
SIDECAR_COLUMNS = [
    "accession",
    "ncbi_organism_name",
    "ncbi_isolation_source",
    "ncbi_lat_lon",
    "ncbi_country",
    "gtdb_taxonomy",
    "gtdb_representative",
    "ncbi_taxonomy",
    "ncbi_taxid",
    "ncbi_species_taxid",
    "ncbi_bioproject",
    "ncbi_submitter",
    "ncbi_genome_representation",
]


def project_bac120(in_fh, out_fh) -> int:
    """Stream the bac120 TSV writing only SIDECAR_COLUMNS; raise if one is missing."""
    reader = csv.DictReader(in_fh, delimiter="\t")
    missing = [c for c in SIDECAR_COLUMNS if c not in (reader.fieldnames or [])]
    if missing:
        raise ValueError(f"bac120 TSV missing expected columns: {missing}")
    writer = csv.DictWriter(out_fh, fieldnames=SIDECAR_COLUMNS, delimiter="\t",
                            extrasaction="ignore", lineterminator="\n")
    writer.writeheader()
    n = 0
    for row in reader:
        writer.writerow({c: row.get(c, "") for c in SIDECAR_COLUMNS})
        n += 1
    return n


def main(argv=None) -> int:
    p = argparse.ArgumentParser(description="Build the slim GTDB bac120 sample sidecar")
    p.add_argument("--bac120", required=True, help="path to bac120_metadata.tsv")
    p.add_argument("--out", required=True, help="path to write the slim sidecar TSV")
    args = p.parse_args(argv)
    with open(args.bac120, newline="") as fin, open(args.out, "w", newline="") as fout:
        n = project_bac120(fin, fout)
    print(f"wrote {n} rows -> {args.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
