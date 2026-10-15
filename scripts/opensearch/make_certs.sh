#!/usr/bin/env bash
# Issue a private CA, the node certificate and the admin certificate for run.sh.
#
#   make_certs.sh <out-dir> [SAN ...]     e.g. make_certs.sh ~/os-certs DNS:search.internal IP:10.0.0.5
#
# Keep <out-dir> out of git: it holds the CA key. Clients only need root-ca.pem.
set -euo pipefail
OUT=${1:?usage: make_certs.sh <out-dir> [SAN ...]}; shift
DAYS=${CERT_DAYS:-825}
mkdir -p "$OUT"; chmod 700 "$OUT"; cd "$OUT"
if [ -e root-ca.pem ]; then echo "$OUT already holds a CA; refusing to overwrite it" >&2; exit 1; fi

SAN="DNS:localhost,IP:127.0.0.1"
for s in "$@"; do SAN="$SAN,$s"; done

umask 077
openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:3072 -out root-ca-key.pem 2>/dev/null
openssl req -x509 -new -key root-ca-key.pem -sha256 -days "$DAYS" \
  -subj "/OU=bgc-atlas/CN=bgc-atlas-ca" -out root-ca.pem

issue() {  # issue <name> <subject> [<subjectAltName>]
  openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out "$1-key.pem" 2>/dev/null
  openssl req -new -key "$1-key.pem" -subj "$2" -out "$1.csr"
  if [ -n "${3:-}" ]; then
    printf 'subjectAltName=%s\nextendedKeyUsage=serverAuth,clientAuth\n' "$3" > "$1.ext"
  else
    printf 'extendedKeyUsage=clientAuth\n' > "$1.ext"
  fi
  openssl x509 -req -in "$1.csr" -CA root-ca.pem -CAkey root-ca-key.pem -CAcreateserial \
    -sha256 -days "$DAYS" -extfile "$1.ext" -out "$1.pem" 2>/dev/null
  rm -f "$1.csr" "$1.ext"
}
issue node  "/OU=bgc-atlas/CN=bgc-opensearch" "$SAN"
issue admin "/OU=bgc-atlas/CN=bgc-admin"
chmod 644 root-ca.pem node.pem admin.pem
echo "certificates in $OUT (node SAN: $SAN)"
