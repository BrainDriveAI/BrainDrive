#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${ROOT_DIR}"

get_env_value() {
  local key="$1"
  if [[ ! -f .env ]]; then
    return 0
  fi
  local line
  line="$(grep -E "^${key}=" .env | head -n 1 || true)"
  echo "${line#*=}"
}

trim_quotes() {
  local value="$1"
  value="${value%\"}"
  value="${value#\"}"
  echo "${value}"
}

resolve_path_in_root() {
  local path_value="$1"
  if [[ -z "${path_value}" ]]; then
    echo ""
    return 0
  fi
  if [[ "${path_value}" == /* ]]; then
    echo "${path_value}"
  else
    echo "${ROOT_DIR}/${path_value}"
  fi
}

require_cmd() {
  local name="$1"
  if ! command -v "${name}" >/dev/null 2>&1; then
    echo "Missing required command: ${name}" >&2
    exit 1
  fi
}

manifest_url="$(trim_quotes "${BRAINDRIVE_RELEASE_MANIFEST_URL:-$(get_env_value BRAINDRIVE_RELEASE_MANIFEST_URL)}")"
signature_url="$(trim_quotes "${BRAINDRIVE_RELEASE_MANIFEST_SIG_URL:-$(get_env_value BRAINDRIVE_RELEASE_MANIFEST_SIG_URL)}")"
public_key_url="$(trim_quotes "${BRAINDRIVE_RELEASE_PUBLIC_KEY_URL:-$(get_env_value BRAINDRIVE_RELEASE_PUBLIC_KEY_URL)}")"

if [[ -z "${manifest_url}" && -z "${signature_url}" && -z "${public_key_url}" ]]; then
  echo "No remote release metadata URLs configured; skipping fetch."
  exit 0
fi

if [[ -z "${manifest_url}" || -z "${signature_url}" || -z "${public_key_url}" ]]; then
  echo "Set BRAINDRIVE_RELEASE_MANIFEST_URL, BRAINDRIVE_RELEASE_MANIFEST_SIG_URL, and BRAINDRIVE_RELEASE_PUBLIC_KEY_URL together." >&2
  exit 1
fi

manifest_path="$(trim_quotes "${BRAINDRIVE_RELEASE_MANIFEST:-$(get_env_value BRAINDRIVE_RELEASE_MANIFEST)}")"
signature_path="$(trim_quotes "${BRAINDRIVE_RELEASE_MANIFEST_SIG:-$(get_env_value BRAINDRIVE_RELEASE_MANIFEST_SIG)}")"
public_key_path="$(trim_quotes "${BRAINDRIVE_RELEASE_PUBLIC_KEY:-$(get_env_value BRAINDRIVE_RELEASE_PUBLIC_KEY)}")"

if [[ -z "${manifest_path}" ]]; then
  manifest_path="./release-cache/releases.json"
fi
if [[ -z "${signature_path}" ]]; then
  signature_path="./release-cache/releases.json.sig"
fi
if [[ -z "${public_key_path}" ]]; then
  public_key_path="./release-cache/cosign.pub"
fi

manifest_path="$(resolve_path_in_root "${manifest_path}")"
signature_path="$(resolve_path_in_root "${signature_path}")"
public_key_path="$(resolve_path_in_root "${public_key_path}")"

mkdir -p "$(dirname "${manifest_path}")" "$(dirname "${signature_path}")" "$(dirname "${public_key_path}")"

require_cmd curl

curl -fsSL "${manifest_url}" -o "${manifest_path}"
curl -fsSL "${signature_url}" -o "${signature_path}"
curl -fsSL "${public_key_url}" -o "${public_key_path}"

echo "Fetched release metadata:"
echo "  manifest: ${manifest_path}"
echo "  signature: ${signature_path}"
echo "  public key: ${public_key_path}"
