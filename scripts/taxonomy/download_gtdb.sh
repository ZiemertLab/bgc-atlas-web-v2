#!/usr/bin/env bash
#SBATCH --job-name=tax-gtdb-dl
#SBATCH --partition=compute
#SBATCH --nodes=1
#SBATCH --cpus-per-task=8
#SBATCH --mem=48G
#SBATCH --time=12:00:00
#SBATCH --output=/work/atlas-clustering-v2/logs/%x_%j.out
#SBATCH --error=/work/atlas-clustering-v2/logs/%x_%j.err
#
# Download the MMseqs2-hosted GTDB database (with taxonomy) and create the gtdb_noidx
# view the taxonomy array reads: the DB without precomputed .idx files, so MMseqs2
# builds the index in RAM under --split-memory-limit on standard nodes.
# Needs internet on the compute node; temp files go to node-local $TMPDIR.
#
# The atlas taxonomy is GTDB R232, and build_taxonomy_v2.py reads the R232 taxonomy files.
# `mmseqs databases GTDB` always fetches GTDB's *latest* release, so the job refuses to start
# unless latest is $GTDB_RELEASE (default v232), and checks GTDB.version again afterwards.
# Once latest has moved on, build the database from the archived release
# (releases/release232/232.0/) the way MMseqs2's databases workflow does: createdb on
# genomic_files_reps/gtdb_proteins_aa_reps_r232.tar.gz, then createtaxdb from the
# bac120/ar53 taxonomy files.

set -euo pipefail
V=/work/atlas-clustering-v2
CB=${CB:-/opt/miniforge3}
GTDB_RELEASE=${GTDB_RELEASE:-v232}
LATEST=https://data.ace.uq.edu.au/public/gtdb/data/releases/latest/VERSION.txt
source "$CB/etc/profile.d/conda.sh"; conda activate mmseqs2

have=$(curl -fsSL "$LATEST" | head -1 | tr -d '[:space:]')
if [ "$have" != "$GTDB_RELEASE" ]; then
  echo "GTDB latest is '$have', not $GTDB_RELEASE: not downloading (see the header)" >&2; exit 1
fi

mkdir -p "$V/taxonomy/gtdb"
rm -f "$V/taxonomy/gtdb/GTDB.version"   # MMseqs2 never overwrites an existing one
TMP="${TMPDIR:-/tmp}/gtdb_dl.$SLURM_JOB_ID"; mkdir -p "$TMP"

mmseqs databases GTDB "$V/taxonomy/gtdb/GTDB" "$TMP" --threads "${SLURM_CPUS_PER_TASK:-8}"
rm -rf "$TMP"
got=$(head -1 "$V/taxonomy/gtdb/GTDB.version" | tr -d '[:space:]')
if [ "$got" != "$GTDB_RELEASE" ]; then
  echo "downloaded GTDB is '$got', not $GTDB_RELEASE" >&2; exit 1
fi
echo "GTDB $got"

ND="$V/taxonomy/gtdb_noidx"; mkdir -p "$ND"
for f in GTDB GTDB.dbtype GTDB.index GTDB_h GTDB_h.dbtype GTDB_h.index \
         GTDB.lookup GTDB_mapping GTDB_taxonomy GTDB.source GTDB.version; do
  ln -sf "$V/taxonomy/gtdb/$f" "$ND/$f"
done
echo "GTDB at $V/taxonomy/gtdb; index-free view at $ND"
