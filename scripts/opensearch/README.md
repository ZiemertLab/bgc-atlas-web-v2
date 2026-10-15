# OpenSearch with security on

The atlas indexes live in one single-node OpenSearch 2.19 container on a
docker host. Its security plugin is on: TLS on the REST and transport layers,
certificates from a private CA, and three users.

| user | for | can |
|---|---|---|
| `bgc_reader` | the web app | search, count, get and point-in-time reads on `bgc_facets*`, `bgc_facet_vocab*`, `bgc_browse*`, `gcf_browse*`, `sample_browse*` |
| `bgc_indexer` | index builds | everything on those patterns: create and delete versioned indexes, bulk-load, swap aliases; plus alias lookups everywhere |
| `admin` | setup only | everything, including the security API |

Roles are in `security/roles.yml`, mappings in `security/roles_mapping.yml`.
Nothing here holds a secret: the CA, the passwords and the rendered user file
all stay outside git.

## First start

On the docker host, from a copy of this directory and of
`scripts/populator/tools/opensearch.Dockerfile`:

```bash
# 1. the image, owned by the account that runs it
docker build --build-arg UID=$(id -u) --build-arg GID=$(id -g) \
  -t bgc-opensearch:2.19.0 -f opensearch.Dockerfile .

# 2. certificates; add every name/address clients use to reach the cluster
./make_certs.sh ~/os-certs DNS:search.internal IP:10.0.0.5

# 3. passwords, in a file only you can read
umask 077; cat > ~/os-secrets.env <<'EOF'
OPENSEARCH_ADMIN_PASSWORD=...
OPENSEARCH_READER_PASSWORD=...
OPENSEARCH_INDEXER_PASSWORD=...
EOF
set -a; . ~/os-secrets.env; set +a
./make_users.sh ~/os-certs/internal_users.yml

# 4. start; OS_BIND is the address the app host reaches it on
OS_BIND=10.0.0.5 ./run.sh ~/os-certs ~/os-certs/internal_users.yml
```

On first start the plugin builds its security index from the mounted roles,
mappings and users (`allow_default_init_securityindex`). Later edits to those
files are not picked up by a restart: push a role with the security REST API as
`admin`, or rebuild the index with `securityadmin.sh` and the admin certificate
(`admin.pem` / `admin-key.pem`).

An existing data volume keeps its indexes when security is turned on; only the
security index is new.

## Clients

Every client reads the same four variables:

```
OPENSEARCH_URL=https://search.internal:9200
OPENSEARCH_USERNAME=bgc_reader        # bgc_indexer for builds
OPENSEARCH_PASSWORD=...
OPENSEARCH_CA_CERT=/path/to/root-ca.pem
```

- **The app** (`bgc-atlas/src/lib/opensearch/http.ts`) sends the credentials on
  every request. Node trusts the CA through `NODE_EXTRA_CA_CERTS`, which must be
  set when the process starts, so `.env.local` is too late for it.
  `bgc-atlas/ecosystem.config.js` points it at `bgc-atlas/certs/opensearch-ca.pem`
  (gitignored). Set it yourself for `npx tsx scripts/generate-*-snapshot.ts`.
- **Python tools** call `install_opensearch_auth()` before `main()`.
- **Shell:** `source scripts/opensearch/oscurl.sh`, then `oscurl` instead of
  `curl`. It passes the credentials through a config file on a pipe, so they
  never appear in `ps`.

## Passwords

```bash
OPENSEARCH_USERNAME=admin OPENSEARCH_PASSWORD=... OPENSEARCH_CA_CERT=root-ca.pem \
OPENSEARCH_NEW_PASSWORD=... ./rotate_password.sh bgc_reader
```

Then update the app's `.env.local` and restart it. `admin` is reserved: change
it by re-rendering `internal_users.yml` with `make_users.sh` and running
`securityadmin.sh`.
