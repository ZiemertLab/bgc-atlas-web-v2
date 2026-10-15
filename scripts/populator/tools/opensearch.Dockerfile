# Derived OpenSearch image for the BGC property-search index.
#
# The stock opensearchproject/opensearch image runs as uid 1000 with a 0700
# install (no arbitrary-uid support). This re-owns the install to the uid/gid
# passed at build time, so the container's process is attributable to the
# account that runs it.
#
# Build:  docker build --build-arg UID=$(id -u) --build-arg GID=$(id -g) \
#           -t bgc-opensearch:2.19.0 <context-with-this-Dockerfile>
# The data volume must also be chowned to the same ids:
#   docker run --rm -u 0 -v bgc-os-data:/data --entrypoint chown \
#     opensearchproject/opensearch:2.19.0 -R <uid>:<gid> /data
FROM opensearchproject/opensearch:2.19.0
ARG UID=1000
ARG GID=1000
USER root
RUN chown -R ${UID}:${GID} /usr/share/opensearch
USER ${UID}:${GID}
