#!/usr/bin/env bash
set -euo pipefail

# Build production images for a version.
# Usage: ./scripts/build-release-images.sh v0.4.0

VERSION="${1:-}"
if [[ -z "${VERSION}" ]]; then
  echo "Usage: $0 <version>"
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="${REPO_ROOT:-$(cd "${SCRIPT_DIR}/../../.." && pwd)}"
cd "${REPO_ROOT}"

REGISTRY="${REGISTRY:-ghcr.io/braindrive-ai}"
APP_IMAGE="${APP_IMAGE:-${REGISTRY}/braindrive-app}"
EDGE_IMAGE="${EDGE_IMAGE:-${REGISTRY}/braindrive-edge}"

echo "Building ${APP_IMAGE}:${VERSION}"
docker build -f installer/docker/Dockerfile.app -t "${APP_IMAGE}:${VERSION}" .

echo "Building ${EDGE_IMAGE}:${VERSION}"
docker build -f installer/docker/Dockerfile.edge -t "${EDGE_IMAGE}:${VERSION}" .

echo "Build complete"
