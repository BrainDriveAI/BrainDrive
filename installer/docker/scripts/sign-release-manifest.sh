#!/usr/bin/env bash
set -euo pipefail

# Sign releases.json using cosign key-pair mode.
# Usage: ./scripts/sign-release-manifest.sh [manifest-path] [signature-path]

MANIFEST_PATH="${1:-./releases.json}"
SIGNATURE_PATH="${2:-./releases.json.sig}"
KEY_PATH="${COSIGN_KEY_PATH:-./cosign.key}"

if [[ ! -f "${MANIFEST_PATH}" ]]; then
  echo "Manifest file not found: ${MANIFEST_PATH}" >&2
  exit 1
fi

if [[ ! -f "${KEY_PATH}" ]]; then
  echo "Cosign private key not found: ${KEY_PATH}" >&2
  echo "Set COSIGN_KEY_PATH or place cosign.key in current directory." >&2
  exit 1
fi

if ! command -v cosign >/dev/null 2>&1; then
  echo "cosign is required to sign manifests." >&2
  exit 1
fi

cosign sign-blob --key "${KEY_PATH}" --output-signature "${SIGNATURE_PATH}" "${MANIFEST_PATH}" >/dev/null

echo "Manifest signed: ${SIGNATURE_PATH}"
