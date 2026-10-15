# scripts/taxonomy

Per-BGC GTDB taxonomy with MMseqs2, run on the HPC cluster. Produces
`$V/taxonomy/taxonomy_assignments.parquet`, which `scripts/clustering-v2/build_taxonomy_v2.py`
turns into the `taxonomies` / `bgc_taxonomy` load files.

Copy this directory to `$V/scripts/taxonomy/` (`V=/work/atlas-clustering-v2`, `CB` = conda base;
envs `mmseqs2`, `seqkit`, `atlas-clustering` with polars). Input: `$V/input/regions_nuc.fasta`
from `scripts/populator/tools/extract_sequences.py`.

1. `sbatch download_gtdb.sh` — MMseqs2 GTDB database plus the index-free `gtdb_noidx` view.
   The atlas uses GTDB **R232**. MMseqs2 only downloads GTDB's latest release, so the job stops
   if latest is anything else; the script header says how to build R232 from the archive.
2. `sbatch split_regions.sh` — 16 shards of `regions_nuc.fasta`.
3. `sbatch run_taxonomy_array.sh` — one easy-taxonomy task per shard (~490 GB RAM each);
   resubmit to rerun failed shards only.
4. `sbatch parse_taxonomy.sh` — concatenates the shard `_lca.tsv` files into the parquet.

`build_taxonomy_v2.py` also needs the GTDB release taxonomy files (`bac120_taxonomy.tsv`,
`ar53_taxonomy_r232.tsv`) next to the parquet.
