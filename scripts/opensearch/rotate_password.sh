#!/usr/bin/env bash
# Change bgc_reader's or bgc_indexer's password on a running cluster.
#
#   OPENSEARCH_USERNAME=admin OPENSEARCH_PASSWORD=... OPENSEARCH_CA_CERT=root-ca.pem \
#   OPENSEARCH_NEW_PASSWORD=... rotate_password.sh bgc_reader
#
# The new password travels on a pipe, never on a command line. admin is reserved:
# change it by re-rendering internal_users.yml and running securityadmin.sh.
set -euo pipefail
USER_NAME=${1:?usage: rotate_password.sh <bgc_reader|bgc_indexer>}
case "$USER_NAME" in bgc_reader|bgc_indexer) ;; *) echo "only bgc_reader or bgc_indexer" >&2; exit 1;; esac
: "${OPENSEARCH_URL:?}" "${OPENSEARCH_NEW_PASSWORD:?}"
# shellcheck source=oscurl.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/oscurl.sh"
python3 -c 'import json, os, sys
print(json.dumps([{"op": "add", "path": "/" + sys.argv[1] + "/password",
                   "value": os.environ["OPENSEARCH_NEW_PASSWORD"]}]))' "$USER_NAME" \
  | oscurl --fail-with-body -XPATCH "$OPENSEARCH_URL/_plugins/_security/api/internalusers" \
      -H 'Content-Type: application/json' --data-binary @-
echo
