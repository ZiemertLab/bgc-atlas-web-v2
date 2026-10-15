"""Build the BiG-SLiCE input folder for the residual reps plus MIBiG (so anchored families can be flagged)."""
from __future__ import annotations
import os
import re
import polars as pl

WORK = "/work/atlas-clustering-v2"
TAR = f"{WORK}/input/all_regions_gbk.tar"
IDX = f"{WORK}/input/tar_index.parquet"
REPS = f"{WORK}/residual-v3/95/representatives.parquet"
INPUT = f"{WORK}/bigslice-input-residual-v3"
MIBIG = f"{WORK}/mibig-antismash-4.0/mibig_antismash_4.0_gbk_as8b1"
TAX = ["metagenome"] * 8


def sanitize(s: str) -> str:
    s = re.sub(r"[^A-Za-z0-9]+", "_", s).strip("_")
    return s or "no_source"


def main() -> None:
    reps = (pl.read_parquet(REPS).select(["rep_bgc_id", "source"])
            .rename({"rep_bgc_id": "bgc_id"}).with_columns(pl.col("source").fill_null("no_source")))
    idx = pl.read_parquet(IDX)
    j = reps.join(idx, on="bgc_id", how="inner").with_columns(
        pl.col("source").map_elements(sanitize, return_dtype=pl.String).alias("ds"))
    print(f"reps to place: {reps.height:,} | found in tar_index: {j.height:,}", flush=True)

    datasets = sorted(j["ds"].unique().to_list())
    for ds in datasets:
        os.makedirs(f"{INPUT}/{ds}/genomes", exist_ok=True)
    os.makedirs(f"{INPUT}/taxonomy", exist_ok=True)

    w = 0
    with open(TAR, "rb") as f:
        for uuid, ds, off, size in j.select(["bgc_id", "ds", "offset_data", "size"]).iter_rows():
            f.seek(off)
            data = f.read(size)
            with open(f"{INPUT}/{ds}/genomes/{uuid}.region001.gbk", "wb") as o:
                o.write(data)
            w += 1
            if w % 100000 == 0:
                print(f"  wrote {w:,}", flush=True)
    print(f"wrote {w:,} rep gbk", flush=True)

    os.makedirs(f"{INPUT}/MIBiG/genomes", exist_ok=True)
    nmib = 0
    for fn in os.listdir(MIBIG):
        if fn.endswith(".gbk"):
            dst = f"{INPUT}/MIBiG/genomes/{fn}"
            if not os.path.lexists(dst):
                os.symlink(f"{MIBIG}/{fn}", dst)
            nmib += 1
    print(f"MIBiG symlinked: {nmib:,}")

    all_ds = datasets + ["MIBiG"]
    with open(f"{INPUT}/datasets.tsv", "w") as d:
        d.write("# Dataset name\tPath to folder\tPath to taxonomy\tDescription\n")
        for ds in all_ds:
            taxp = f"taxonomy/{ds}_taxonomy.tsv"
            d.write(f"{ds}\t{ds}\t{taxp}\t{ds}\n")
            with open(f"{INPUT}/{taxp}", "w") as t:
                t.write("# Genome folder\tKingdom\tPhylum\tClass\tOrder\tFamily\t"
                        "Genus\tSpecies\tOrganism\n")
                t.write("genomes\t" + "\t".join(TAX) + "\n")
    print(f"wrote datasets.tsv + taxonomy for {len(all_ds)} datasets")


if __name__ == "__main__":
    main()
