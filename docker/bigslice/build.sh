#!/usr/bin/env sh
# Build the BiG-SLiCE query image for the "BGC clustering" search (bigslice 2.0.2, build
# pyh8ed023e_0; its --version banner misreports "2.0.0"). HMM models are baked in.
#
# Usage: build.sh [image_tag]   (default: $BIGSLICE_DOCKER_IMAGE or bigslice:2.0.2)
set -eu
IMAGE="${1:-${BIGSLICE_DOCKER_IMAGE:-bigslice:2.0.2}}"
CONTEXT="$(cd "$(dirname "$0")" && pwd)"
echo "Building ${IMAGE} from ${CONTEXT}"
docker build -t "${IMAGE}" "${CONTEXT}"
echo "Built ${IMAGE}"
