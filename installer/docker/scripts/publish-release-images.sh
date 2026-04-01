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

APP_DIGEST="$(docker buildx imagetools inspect "${APP_IMAGE}:${VERSION}" | awk '/Digest:/ && !digest {digest=$2} END {print digest}')"
EDGE_DIGEST="$(docker buildx imagetools inspect "${EDGE_IMAGE}:${VERSION}" | awk '/Digest:/ && !digest {digest=$2} END {print digest}')"

if [[ -z "${APP_DIGEST}" || -z "${EDGE_DIGEST}" ]]; then
  echo "Could not resolve image digest(s). Ensure docker buildx is available." >&2
  exit 1
fi

if [[ ! "${APP_DIGEST}" =~ ^sha256:[0-9a-f]{64}$ ]]; then
  echo "Invalid app digest: ${APP_DIGEST}" >&2
  exit 1
fi

if [[ ! "${EDGE_DIGEST}" =~ ^sha256:[0-9a-f]{64}$ ]]; then
  echo "Invalid edge digest: ${EDGE_DIGEST}" >&2
  exit 1
fi

APP_REF="${APP_IMAGE}@${APP_DIGEST}"
EDGE_REF="${EDGE_IMAGE}@${EDGE_DIGEST}"

if [[ "${APP_REF}" != *@sha256:* || "${EDGE_REF}" != *@sha256:* ]]; then
  echo "Publish failed: APP_REF/EDGE_REF are not digest-pinned refs. Stop release." >&2
  exit 1
fi

echo "APP_REF=${APP_REF}"
echo "EDGE_REF=${EDGE_REF}"
