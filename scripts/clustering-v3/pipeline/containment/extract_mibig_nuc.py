"""Write one nucleotide record per MIBiG GBK (header = accession) for use as containment targets."""
from __future__ import annotations
import glob
import os
from Bio import SeqIO

WORK = "/work/atlas-clustering-v2"
MIBIG = f"{WORK}/mibig-antismash-4.0/mibig_antismash_4.0_gbk_as8b1"
OUT = f"{WORK}/containment/mibig_nuc.fasta"

n = 0
with open(OUT, "w") as out:
    for f in sorted(glob.glob(f"{MIBIG}/*.gbk")):
        acc = os.path.basename(f)[:-4]
        rec = next(SeqIO.parse(f, "genbank"), None)
        if rec is None or len(rec.seq) == 0:
            continue
        out.write(f">{acc}\n{str(rec.seq)}\n")
        n += 1
print(f"wrote {n:,} MIBiG nucleotide records -> {OUT}")
