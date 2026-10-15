#!/usr/bin/env bash
# Start the BGC Atlas OpenSearch container with the security plugin on.
#
#   run.sh <certs-dir> <internal_users.yml>
#
# <certs-dir> from make_certs.sh, <internal_users.yml> from make_users.sh. Run
# on the docker host from a copy of this directory. Optional environment:
#   OPENSEARCH_IMAGE  bgc-opensearch:2.19.0 (scripts/populator/tools/opensearch.Dockerfile)
#   OS_NAME           bgc-opensearch          OS_VOLUME  bgc-os-data
#   OS_BIND           127.0.0.1               OS_PORT    9200
#   OS_HEAP           8g                      OS_CPUS 8, OS_MEMORY 24g
# OS_BIND must be an address the app host can reach; it is loopback by default
# so nothing is exposed until you choose to.
set -euo pipefail
HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
CERTS=$(cd "${1:?usage: run.sh <certs-dir> <internal_users.yml>}" && pwd)
USERS=$(cd "$(dirname "${2:?usage: run.sh <certs-dir> <internal_users.yml>}")" && pwd)/$(basename "$2")
C=/usr/share/opensearch/config
HEAP=${OS_HEAP:-8g}

docker run -d --name "${OS_NAME:-bgc-opensearch}" --restart always \
  --cpus="${OS_CPUS:-8}" --memory="${OS_MEMORY:-24g}" \
  -e discovery.type=single-node \
  -e DISABLE_INSTALL_DEMO_CONFIG=true \
  -e "OPENSEARCH_JAVA_OPTS=-Xms$HEAP -Xmx$HEAP" \
  -e node.store.allow_mmap=false \
  -p "${OS_BIND:-127.0.0.1}:${OS_PORT:-9200}:9200" \
  -v "${OS_VOLUME:-bgc-os-data}:/usr/share/opensearch/data" \
  -v "$HERE/opensearch.yml:$C/opensearch.yml:ro" \
  -v "$CERTS:$C/certs:ro" \
  -v "$HERE/security/roles.yml:$C/opensearch-security/roles.yml:ro" \
  -v "$HERE/security/roles_mapping.yml:$C/opensearch-security/roles_mapping.yml:ro" \
  -v "$USERS:$C/opensearch-security/internal_users.yml:ro" \
  "${OPENSEARCH_IMAGE:-bgc-opensearch:2.19.0}"
