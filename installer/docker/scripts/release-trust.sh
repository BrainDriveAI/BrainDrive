#!/usr/bin/env bash

# SHA-256 fingerprint of BrainDrive's release-manifest signing public key.
readonly BRAINDRIVE_EMBEDDED_RELEASE_PUBLIC_KEY_SHA256="c92a784b""e74b30f8""e754e302""5a11a7c6""9b44d620""c8f0e213""31b46e17""72b179b6"
readonly BRAINDRIVE_EMBEDDED_COSIGN_VERSION="v3.0.6"

braindrive_sha256_file() {
  local file_path="$1"

  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "${file_path}" | awk '{print $1}'
    return 0
  fi

  if command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "${file_path}" | awk '{print $1}'
    return 0
  fi

  if command -v openssl >/dev/null 2>&1; then
    openssl dgst -sha256 "${file_path}" | awk '{print $NF}'
    return 0
  fi

  echo "SHA-256 verification requires sha256sum, shasum, or openssl." >&2
  return 1
}

braindrive_verify_sha256() {
  local file_path="$1"
  local expected_sha256="$2"
  local label="${3:-File}"
  local actual_sha256

  if [[ ! "${expected_sha256}" =~ ^[0-9a-f]{64}$ ]]; then
    echo "${label} has an invalid expected SHA-256: ${expected_sha256}" >&2
    return 1
  fi

  actual_sha256="$(braindrive_sha256_file "${file_path}")"
  if [[ "${actual_sha256}" != "${expected_sha256}" ]]; then
    echo "${label} SHA-256 mismatch." >&2
    echo "  expected: ${expected_sha256}" >&2
    echo "  actual:   ${actual_sha256}" >&2
    return 1
  fi
}

braindrive_verify_release_public_key() {
  local public_key_path="$1"

  if [[ -n "${BRAINDRIVE_TRUSTED_RELEASE_KEY_SHA256:-}" &&
        "${BRAINDRIVE_TRUSTED_RELEASE_KEY_SHA256}" != "${BRAINDRIVE_EMBEDDED_RELEASE_PUBLIC_KEY_SHA256}" ]]; then
    echo "Bootstrap release-key fingerprint does not match the installed trust root." >&2
    return 1
  fi

  braindrive_verify_sha256 \
    "${public_key_path}" \
    "${BRAINDRIVE_EMBEDDED_RELEASE_PUBLIC_KEY_SHA256}" \
    "Release public key"
}

braindrive_cosign_sha256() {
  local os="$1"
  local arch="$2"

  case "${os}-${arch}" in
    darwin-amd64) echo "4c3e7af8372d3ca3296e62fa56f23fcbb5721cc6ac1827900d398f110d7cd280" ;;
    darwin-arm64) echo "5fadd012ae6381a6a29ff86a7d39aa873878852f1073fc90b15995961ecfb084" ;;
    linux-amd64) echo "c956e5dfcac53d52bcf058360d579472f0c1d2d9b69f55209e256fe7783f4c74" ;;
    linux-arm64) echo "bedac92e8c3729864e13d4a17048007cfafa79d5deca993a43a90ffe018ef2b8" ;;
    *)
      echo "No embedded cosign checksum for ${os}-${arch}." >&2
      return 1
      ;;
  esac
}
