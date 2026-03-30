#!/usr/bin/env bash
set -euo pipefail

# Generate a release manifest (unsigned by default).
# Usage: ./scripts/generate-release-manifest.sh v0.4.0 <app-ref> <edge-ref> [stable] [./releases.json]

VERSION="${1:-}"
APP_REF="${2:-}"
EDGE_REF="${3:-}"
CHANNEL="${4:-stable}"
OUTPUT="${5:-./releases.json}"

if [[ -z "${VERSION}" || -z "${APP_REF}" || -z "${EDGE_REF}" ]]; then
  echo "Usage: $0 <version> <app-ref> <edge-ref> [channel] [output-path]"
  exit 1
fi

SIG_ALGO="${MANIFEST_SIGNATURE_ALGORITHM:-}"
SIG_KEY_ID="${MANIFEST_SIGNATURE_KEY_ID:-}"
SIG_VALUE="${MANIFEST_SIGNATURE_VALUE:-}"

cat > "${OUTPUT}" <<JSON
{
  "generated_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "manifest_version": 1,
  "channels": {
    "${CHANNEL}": "${VERSION}"
  },
  "releases": {
    "${VERSION}": {
      "app_image_digest": "${APP_REF}",
      "edge_image_digest": "${EDGE_REF}",
      "min_config_version": 1,
      "max_config_version": 1,
      "migration_required": true,
      "migration_id": "cfg-v1-release-${VERSION}"
    }
  },
  "signature": {
    "algorithm": "${SIG_ALGO}",
    "key_id": "${SIG_KEY_ID}",
    "value": "${SIG_VALUE}"
  }
}
JSON

if [[ -z "${SIG_ALGO}" || -z "${SIG_VALUE}" ]]; then
  echo "Generated unsigned/placeholder manifest at ${OUTPUT}."
  echo "Set MANIFEST_SIGNATURE_ALGORITHM and MANIFEST_SIGNATURE_VALUE for signed output."
else
  echo "Generated signed-manifest payload at ${OUTPUT}."
fi
