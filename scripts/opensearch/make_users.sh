#!/usr/bin/env bash
# Render internal_users.yml for run.sh's first start: bcrypt hashes only.
#
#   set -a; . ~/os-secrets.env; set +a     # the three passwords below
#   make_users.sh <out-file>
#
# hash.sh reads each password from the environment, so none reaches a command line.
# Run on the docker host. Keep <out-file> out of git.
set -euo pipefail
OUT=${1:?usage: make_users.sh <out-file>}
IMAGE=${OPENSEARCH_IMAGE:-bgc-opensearch:2.19.0}
for v in OPENSEARCH_ADMIN_PASSWORD OPENSEARCH_READER_PASSWORD OPENSEARCH_INDEXER_PASSWORD; do
  if [ -z "${!v:-}" ]; then echo "$v is not set" >&2; exit 1; fi
done

hash_of() {
  docker run --rm -e "$1" --entrypoint /usr/share/opensearch/plugins/opensearch-security/tools/hash.sh \
    "$IMAGE" -env "$1" | grep -E '^\$2[aby]\$' | tail -1
}
ADMIN=$(hash_of OPENSEARCH_ADMIN_PASSWORD)
READER=$(hash_of OPENSEARCH_READER_PASSWORD)
INDEXER=$(hash_of OPENSEARCH_INDEXER_PASSWORD)
for h in "$ADMIN" "$READER" "$INDEXER"; do
  if [ -z "$h" ]; then echo "hashing failed" >&2; exit 1; fi
done

umask 077
cat > "$OUT" <<YAML
_meta:
  type: "internalusers"
  config_version: 2

admin:
  hash: "$ADMIN"
  reserved: true
  description: "Setup and security administration only"

bgc_reader:
  hash: "$READER"
  reserved: false
  description: "The web app: read-only search on the atlas indexes"

bgc_indexer:
  hash: "$INDEXER"
  reserved: false
  description: "Index builds: create, bulk-load, alias swaps on the atlas indexes"
YAML
echo "wrote $OUT"
