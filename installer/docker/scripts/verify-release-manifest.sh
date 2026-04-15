#!/usr/bin/env bash
set -euo pipefail

# Verify releases.json signature.
# Usage: ./scripts/verify-release-manifest.sh [manifest-path] [signature-path] [public-key-path]

MANIFEST_PATH="${1:-./releases.json}"
SIGNATURE_PATH="${2:-./releases.json.sig}"
PUBLIC_KEY_PATH="${3:-./cosign.pub}"
COSIGN_BIN=""

trim_quotes() {
  local value="$1"
  value="${value%\"}"
  value="${value#\"}"
  echo "${value}"
}

to_bool() {
  local value
  value="$(echo "$1" | tr '[:upper:]' '[:lower:]')"
  case "${value}" in
    1|true|yes|on) echo "true" ;;
    *) echo "false" ;;
  esac
}

ensure_cosign() {
  if [[ -n "${COSIGN_BIN}" && -x "${COSIGN_BIN}" ]]; then
    return 0
  fi

  local configured_bin
  configured_bin="$(trim_quotes "${BRAINDRIVE_COSIGN_BIN:-}")"
  if [[ -n "${configured_bin}" ]]; then
    if [[ "${configured_bin}" != /* ]]; then
      configured_bin="$(pwd)/${configured_bin}"
    fi
    if [[ -x "${configured_bin}" ]]; then
      COSIGN_BIN="${configured_bin}"
      return 0
    fi
    echo "Configured BRAINDRIVE_COSIGN_BIN not found or not executable: ${configured_bin}" >&2
    exit 1
  fi

  if command -v cosign >/dev/null 2>&1; then
    COSIGN_BIN="$(command -v cosign)"
    return 0
  fi

  local home_bin
  home_bin="${HOME:-}/.local/bin/cosign"
  if [[ -x "${home_bin}" ]]; then
    COSIGN_BIN="${home_bin}"
    return 0
  fi

  local auto_install
  auto_install="$(trim_quotes "${BRAINDRIVE_AUTO_INSTALL_COSIGN:-true}")"
  auto_install="$(to_bool "${auto_install}")"
  if [[ "${auto_install}" != "true" ]]; then
    echo "cosign is required to verify manifests." >&2
    echo "Install cosign, set BRAINDRIVE_COSIGN_BIN, or set BRAINDRIVE_AUTO_INSTALL_COSIGN=true." >&2
    exit 1
  fi

  if ! command -v curl >/dev/null 2>&1; then
    echo "curl is required to auto-install cosign." >&2
    exit 1
  fi
  if ! command -v uname >/dev/null 2>&1; then
    echo "uname is required to auto-install cosign." >&2
    exit 1
  fi

  local os
  local arch
  local uname_s
  local uname_m
  uname_s="$(uname -s | tr '[:upper:]' '[:lower:]')"
  uname_m="$(uname -m | tr '[:upper:]' '[:lower:]')"

  case "${uname_s}" in
    linux) os="linux" ;;
    darwin) os="darwin" ;;
    *)
      echo "Automatic cosign install is not supported on OS: ${uname_s}" >&2
      echo "Install cosign manually and retry." >&2
      exit 1
      ;;
  esac

  case "${uname_m}" in
    x86_64|amd64) arch="amd64" ;;
    arm64|aarch64) arch="arm64" ;;
    *)
      echo "Automatic cosign install is not supported on arch: ${uname_m}" >&2
      echo "Install cosign manually and retry." >&2
      exit 1
      ;;
  esac

  local version
  local bin_dir
  local url
  local target
  local tmp_target
  version="$(trim_quotes "${BRAINDRIVE_COSIGN_VERSION:-}")"
  bin_dir="$(trim_quotes "${BRAINDRIVE_COSIGN_BIN_DIR:-}")"

  if [[ -z "${bin_dir}" ]]; then
    bin_dir="${HOME:-$(pwd)}/.local/bin"
  fi
  if [[ "${bin_dir}" != /* ]]; then
    bin_dir="$(pwd)/${bin_dir}"
  fi

  mkdir -p "${bin_dir}"
  target="${bin_dir}/cosign"
  tmp_target="${target}.tmp"

  if [[ -n "${version}" && "${version}" != "latest" ]]; then
    url="https://github.com/sigstore/cosign/releases/download/${version}/cosign-${os}-${arch}"
  else
    url="https://github.com/sigstore/cosign/releases/latest/download/cosign-${os}-${arch}"
  fi

  echo "cosign not found; downloading ${url}"
  curl -fsSL "${url}" -o "${tmp_target}"
  chmod +x "${tmp_target}"
  mv -f "${tmp_target}" "${target}"

  COSIGN_BIN="${target}"
}

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

ensure_cosign

# Signature files are detached/base64 payload signatures (not bundles).
"${COSIGN_BIN}" verify-blob \
  --new-bundle-format=false \
  --insecure-ignore-tlog=true \
  --key "${PUBLIC_KEY_PATH}" \
  --signature "${SIGNATURE_PATH}" \
  "${MANIFEST_PATH}" >/dev/null

echo "Manifest signature verification passed"
