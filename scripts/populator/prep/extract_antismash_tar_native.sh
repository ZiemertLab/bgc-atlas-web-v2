#!/usr/bin/env bash
# Extract antiSMASH region GBKs and *_regions.json from every .tar/.tar.gz/.tgz in ROOT_DIR,
# one archive per worker; uses pigz when available.
# Usage: extract_antismash_tar_native.sh ROOT_DIR [--gbk-out-dir DIR] [--json-out-dir DIR] [--threads N]
# Output: <GBK_OUT>/<sample>/*.regionNNN.gbk and <JSON_OUT>/<sample>/<sample>_regions.json

set -euo pipefail

print_usage() {
  cat <<EOF
Usage: $0 ROOT_DIR [--gbk-out-dir DIR] [--json-out-dir DIR] [--threads N]

Options:
  --gbk-out-dir DIR   Output directory for GBK files (default: mgnify_gbks)
  --json-out-dir DIR  Output directory for JSON files (default: mgnify_jsons)
  --threads N         Number of parallel workers (default: 128)
EOF
}

process_one() {
  local tarfile="$1" gbk_out="$2" json_out="$3" use_pigz="$4"

  local -a comp
  if [[ "$tarfile" == *.tar.gz || "$tarfile" == *.tgz ]]; then
    if [[ "$use_pigz" == "1" ]]; then
      comp=(--use-compress-program pigz)
    else
      comp=(-z)
    fi
  else
    comp=()
  fi

  local gbk_tmp json_tmp
  gbk_tmp=$(mktemp)
  json_tmp=$(mktemp)

  # Only members under <sample>/<sample>/; this skips <sample>/<sample>_basic/.
  if ! tar "${comp[@]}" -tf "$tarfile" | \
    awk -v gbk="$gbk_tmp" -v js="$json_tmp" 'BEGIN{FS="/"}
      NF>=3 && $1==$2 {
        base=$NF
        if (base ~ /\.region[0-9]+\.gbk$/) { print $0 >> gbk }
        else if (base ~ /_regions\.json$/) { print $0 >> js }
      }
    ' ; then
    echo "ERROR: Failed to list members of $tarfile" >&2
    rm -f "$gbk_tmp" "$json_tmp"
    return 1
  fi

  if [[ -s "$gbk_tmp" ]]; then
    mkdir -p "$gbk_out"
    if ! tar "${comp[@]}" -xf "$tarfile" --strip-components=1 -C "$gbk_out" -T "$gbk_tmp" ; then
      echo "ERROR: Failed to extract GBKs from $tarfile" >&2
      rm -f "$gbk_tmp" "$json_tmp"
      return 1
    fi
  fi

  if [[ -s "$json_tmp" ]]; then
    mkdir -p "$json_out"
    if ! tar "${comp[@]}" -xf "$tarfile" --strip-components=1 -C "$json_out" -T "$json_tmp" ; then
      echo "ERROR: Failed to extract JSONs from $tarfile" >&2
      rm -f "$gbk_tmp" "$json_tmp"
      return 1
    fi
  fi

  rm -f "$gbk_tmp" "$json_tmp"
  echo "Processed: $(basename "$tarfile")" >&2
}

if [[ "${1:-}" == "--one" ]]; then
  # xargs re-invokes this script as: --one GBK_OUT JSON_OUT USE_PIGZ TARFILE
  gbk_out="$2"; json_out="$3"; use_pigz="$4"; tarfile="$5"
  process_one "$tarfile" "$gbk_out" "$json_out" "$use_pigz"
  exit $?
fi

if [[ $# -lt 1 ]]; then
  print_usage
  exit 1
fi

ROOT_DIR="$1"; shift || true
GBK_OUT="mgnify_gbks"
JSON_OUT="mgnify_jsons"
THREADS=128

while [[ $# -gt 0 ]]; do
  case "$1" in
    --gbk-out-dir)
      GBK_OUT="$2"; shift 2;;
    --json-out-dir)
      JSON_OUT="$2"; shift 2;;
    --threads)
      THREADS="$2"; shift 2;;
    -h|--help)
      print_usage; exit 0;;
    *)
      echo "Unknown option: $1" >&2; print_usage; exit 1;;
  esac
done

if [[ ! -d "$ROOT_DIR" ]]; then
  echo "Root directory not found: $ROOT_DIR" >&2
  exit 1
fi

USE_PIGZ=0
if command -v pigz >/dev/null 2>&1; then
  USE_PIGZ=1
fi

echo "Using pigz: $([[ "$USE_PIGZ" == 1 ]] && echo yes || echo no)" >&2

echo "Scanning for archives under: $ROOT_DIR" >&2
script_path="$0"
export -f process_one || true

mkdir -p "$GBK_OUT" "$JSON_OUT"

# shellcheck disable=SC2016
find "$ROOT_DIR" -maxdepth 1 -type f \( -name "*.tar.gz" -o -name "*.tgz" -o -name "*.tar" \) -print0 | \
  xargs -0 -I {} -P "$THREADS" "$script_path" --one "$GBK_OUT" "$JSON_OUT" "$USE_PIGZ" {}

echo "Done." >&2

