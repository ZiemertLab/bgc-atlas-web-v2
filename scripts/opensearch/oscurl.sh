# Source this file for `oscurl`: curl with the OpenSearch credentials and CA.
#
#   source scripts/opensearch/oscurl.sh
#   oscurl "$OPENSEARCH_URL/_cat/aliases?v"
#
# Credentials go to curl through a config file on a pipe, so they do not show up in `ps`.
oscurl() {
  local args=(-s)
  if [ -n "${OPENSEARCH_CA_CERT:-}" ]; then args+=(--cacert "$OPENSEARCH_CA_CERT"); fi
  if [ -n "${OPENSEARCH_USERNAME:-}" ]; then
    curl "${args[@]}" --config <(printf 'user = "%s:%s"\n' "$OPENSEARCH_USERNAME" "${OPENSEARCH_PASSWORD:-}") "$@"
  else
    curl "${args[@]}" "$@"
  fi
}
