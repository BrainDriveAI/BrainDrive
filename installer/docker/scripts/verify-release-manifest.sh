#!/usr/bin/env bash
set -euo pipefail

# Verify releases.json signature.
# Usage: ./scripts/verify-release-manifest.sh [manifest-path] [signature-path] [public-key-path]

MANIFEST_PATH="${1:-./releases.json}"
SIGNATURE_PATH="${2:-./releases.json.sig}"
PUBLIC_KEY_PATH="${3:-./cosign.pub}"

if [[ ! -f "${MANIFEST_PATH}" ]]; then
  echo "Manifest file not found: ${MANIFEST_PATH}" >&2
  exit 1
fi
if [[ ! -f "${SIGNATURE_PATH}" ]]; then
  echo "Manifest signature file not found: ${SIGNATURE_PATH}" >&2
  exit 1
fi
if [[ ! -f "${PUBLIC_KEY_PATH}" ]]; then
  echo "Cosign public key not found: ${PUBLIC_KEY_PATH}" >&2
  exit 1
fi
if ! command -v cosign >/dev/null 2>&1; then
  echo "cosign is required to verify manifests." >&2
  exit 1
fi

# Signature files are detached/base64 payload signatures (not bundles).
cosign verify-blob \
  --new-bundle-format=false \
  --insecure-ignore-tlog=true \
  --key "${PUBLIC_KEY_PATH}" \
  --signature "${SIGNATURE_PATH}" \
  "${MANIFEST_PATH}" >/dev/null

echo "Manifest signature verification passed"
