#!/usr/bin/env bash
set -euo pipefail

# Push release images and print digest-pinned refs.
# Usage: ./scripts/publish-release-images.sh v0.4.0

VERSION="${1:-}"
if [[ -z "${VERSION}" ]]; then
  echo "Usage: $0 <version>"
  exit 1
fi

REGISTRY="${REGISTRY:-ghcr.io/braindrive-ai}"
APP_IMAGE="${APP_IMAGE:-${REGISTRY}/braindrive-app}"
EDGE_IMAGE="${EDGE_IMAGE:-${REGISTRY}/braindrive-edge}"

docker push "${APP_IMAGE}:${VERSION}"
docker push "${EDGE_IMAGE}:${VERSION}"

APP_DIGEST="$(docker buildx imagetools inspect "${APP_IMAGE}:${VERSION}" | awk '/Digest:/ {print $2; exit}')"
EDGE_DIGEST="$(docker buildx imagetools inspect "${EDGE_IMAGE}:${VERSION}" | awk '/Digest:/ {print $2; exit}')"

if [[ -z "${APP_DIGEST}" || -z "${EDGE_DIGEST}" ]]; then
  echo "Could not resolve image digest(s). Ensure docker buildx is available." >&2
  exit 1
fi

echo "APP_REF=${APP_IMAGE}@${APP_DIGEST}"
echo "EDGE_REF=${EDGE_IMAGE}@${EDGE_DIGEST}"
