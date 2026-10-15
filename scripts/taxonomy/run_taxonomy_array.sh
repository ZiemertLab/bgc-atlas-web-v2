#!/usr/bin/env bash
#SBATCH --job-name=tax
#SBATCH --partition=compute
#SBATCH --nodes=1
#SBATCH --cpus-per-task=96
#SBATCH --mem=490G
#SBATCH --time=7-00:00:00
#SBATCH --array=0-15%16
#SBATCH --output=/work/atlas-clustering-v2/logs/%x_%A_%a.out
#SBATCH --error=/work/atlas-clustering-v2/logs/%x_%A_%a.err
#
# Per-BGC GTDB taxonomy: mmseqs easy-taxonomy on one shard per array task, ORF-level
# LCA (--orf-filter 1, --lca-mode 3). --max-seq-len 1000000 keeps the longest regions
# untruncated (the default 65535 cuts them). Temp files go to the shared work dir, not
# node-local scratch, which overflows on ~1M-region shards. A task whose .done marker
# exists is skipped, so resubmitting the array reruns only failed shards.

set -euo pipefail
V=/work/atlas-clustering-v2
CB=${CB:-/opt/miniforge3}
T=${SLURM_CPUS_PER_TASK:-96}
ID=${SLURM_ARRAY_TASK_ID}
GTDB="$V/taxonomy/gtdb_noidx/GTDB"
OUT="$V/taxonomy/out"; mkdir -p "$OUT"
DONE="$OUT/shard_${ID}.done"
PFX="$OUT/shard_${ID}"

if [ -f "$DONE" ]; then echo "[shard $ID] already done"; exit 0; fi
rm -f "${PFX}"_lca.tsv "${PFX}"_report "${PFX}"_tophit_aln "${PFX}"_tophit_report 2>/dev/null || true

mapfile -t SHARDS < <(ls "$V"/taxonomy/shards/*.part_*.fasta | sort)
Q="${SHARDS[$ID]}"
[ -z "${Q:-}" ] && { echo "[shard $ID] no shard file"; exit 1; }
N=$(grep -c '^>' "$Q")

TMP="$V/taxonomy/tmp/shard_${ID}"; rm -rf "$TMP"; mkdir -p "$TMP"
source "$CB/etc/profile.d/conda.sh"; conda activate mmseqs2

mmseqs easy-taxonomy "$Q" "$GTDB" "$PFX" "$TMP" \
  -s 4 --max-seq-len 1000000 --split-memory-limit 480G --lca-mode 3 --orf-filter 1 \
  --tax-lineage 1 --lca-ranks superkingdom,phylum,class,order,family,genus,species \
  --threads "$T" --remove-tmp-files 1

R=$(wc -l < "${PFX}_lca.tsv")
if [ "$R" -ne "$N" ]; then echo "[shard $ID] lca rows $R != input $N; not marking done"; exit 1; fi
rm -rf "$TMP"
echo "n=$N lca_rows=$R" > "$DONE"
