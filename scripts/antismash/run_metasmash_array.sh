#!/bin/bash
#SBATCH --job-name=metasmash-atlas
#SBATCH --partition=compute
#SBATCH --nodes=1
#SBATCH --cpus-per-task=64
#SBATCH --mem=200G
#SBATCH --time=24:00:00
#SBATCH --nice=10000
#SBATCH --output=antismash_logs/%x_%A_%a.out
#SBATCH --error=antismash_logs/%x_%A_%a.err
#
# One metaSMASH run per input FASTA under raw-inputs/atlas_datasets/<project>/.
#   sbatch --array=0-<N-1>%<concurrent> run_metasmash_array.sh
# N = number of FASTAs (find "$STAGE" -mindepth 2 -maxdepth 2 -name '*.f*a*' | wc -l).
# Output: antismash-out/<project>/<sample>/. Samples with region GBKs already are skipped.
#
# Gene finding: prodigal-m (metagenomic mode, the default) for metagenome assemblies;
# prodigal (single-genome mode) for genomes, which is how every MAG collection was run:
#   sbatch --export=ALL,GENEFINDING_TOOL=prodigal --array=... run_metasmash_array.sh

set -euo pipefail

GENEFINDING_TOOL="${GENEFINDING_TOOL:-prodigal-m}"

WORK=${WORK:-/work/atlas-clustering}
STAGE=$WORK/raw-inputs/atlas_datasets
OUT_ROOT=$WORK/antismash-out

cd "$WORK"
mkdir -p antismash_logs

mapfile -t FASTAS < <(find "$STAGE" -mindepth 2 -maxdepth 2 -type f \
    \( -name "*.fasta" -o -name "*.fa" -o -name "*.fna" \
       -o -name "*.fasta.gz" -o -name "*.fa.gz" -o -name "*.fna.gz" \) \
    | sort)

if [ "${SLURM_ARRAY_TASK_ID:-0}" -ge "${#FASTAS[@]}" ]; then
    echo "task $SLURM_ARRAY_TASK_ID out of range (have ${#FASTAS[@]} FASTAs)" >&2
    exit 1
fi
INPUT="${FASTAS[$SLURM_ARRAY_TASK_ID]}"

PROJECT=$(basename "$(dirname "$INPUT")")
SAMPLE=$(basename "$INPUT")
SAMPLE="${SAMPLE%.gz}"
SAMPLE="${SAMPLE%.fasta}"
SAMPLE="${SAMPLE%.fa}"
SAMPLE="${SAMPLE%.fna}"

OUTPUT_DIR="$OUT_ROOT/$PROJECT/$SAMPLE"

if compgen -G "$OUTPUT_DIR/*.region*.gbk" > /dev/null; then
    echo "$PROJECT/$SAMPLE already has region output; skipping"
    exit 0
fi

source "$(conda info --base)/etc/profile.d/conda.sh"
conda activate metasmash-conda

mkdir -p "$OUTPUT_DIR"
echo "metasmash $INPUT -> $OUTPUT_DIR (cpus=$SLURM_CPUS_PER_TASK, genefinding=$GENEFINDING_TOOL)"

metasmash \
    --clusterhmmer --tigrfam --asf --pfam2go --tfbs \
    --cc-mibig --cb-general --cb-knownclusters \
    --genefinding-tool "$GENEFINDING_TOOL" --no-zip-output \
    --allow-long-headers \
    --cpus "$SLURM_CPUS_PER_TASK" \
    --output-dir "$OUTPUT_DIR" \
    "$INPUT"

echo "done: $(ls "$OUTPUT_DIR"/*.region*.gbk 2>/dev/null | wc -l) region GBKs"
