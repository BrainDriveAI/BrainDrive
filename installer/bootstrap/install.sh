#!/usr/bin/env bash
set -euo pipefail

MODE="${1:-${BRAINDRIVE_BOOTSTRAP_MODE:-local}}"
if [[ "${MODE}" != "prod" && "${MODE}" != "local" ]]; then
  echo "Usage: install.sh [local|prod]" >&2
  exit 1
fi

BOOTSTRAP_RELEASE_TAG_DEFAULT="26.7.23"
TRUSTED_RELEASE_KEY_SHA256="c92a784b""e74b30f8""e754e302""5a11a7c6""9b44d620""c8f0e213""31b46e17""72b179b6"
REPO="${BRAINDRIVE_BOOTSTRAP_REPO:-BrainDriveAI/BrainDrive}"
RELEASE_TAG="${BRAINDRIVE_BOOTSTRAP_RELEASE_TAG:-${BOOTSTRAP_RELEASE_TAG_DEFAULT}}"
INSTALL_ROOT="${BRAINDRIVE_INSTALL_ROOT:-$HOME/.braindrive}"
FORCE_REFRESH_RAW="${BRAINDRIVE_BOOTSTRAP_FORCE_REFRESH:-false}"
ARCHIVE_NAME="${BRAINDRIVE_BOOTSTRAP_ARCHIVE_NAME:-braindrive-installer-${RELEASE_TAG}.tar.gz}"
RELEASE_ASSET_BASE_URL="https://github.com/${REPO}/releases/download/${RELEASE_TAG}"
ARCHIVE_URL="${BRAINDRIVE_BOOTSTRAP_ARCHIVE_URL:-${RELEASE_ASSET_BASE_URL}/${ARCHIVE_NAME}}"
SHA256SUMS_URL="${BRAINDRIVE_BOOTSTRAP_SHA256SUMS_URL:-${RELEASE_ASSET_BASE_URL}/SHA256SUMS}"

to_bool() {
  local value
  value="$(echo "$1" | tr '[:upper:]' '[:lower:]')"
  case "${value}" in
    1|true|yes|on) echo "true" ;;
    *) echo "false" ;;
  esac
}

FORCE_REFRESH="$(to_bool "${FORCE_REFRESH_RAW}")"

require_cmd() {
  local name="$1"
  if ! command -v "${name}" >/dev/null 2>&1; then
    echo "Missing required command: ${name}" >&2
    exit 1
  fi
}

require_cmd curl
require_cmd tar
require_cmd mktemp
require_cmd bash

sha256_file() {
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
  exit 1
}

verify_archive_checksum() {
  local archive_path="$1"
  local sums_path="$2"
  local expected_sha256
  local actual_sha256

  expected_sha256="$(awk -v name="${ARCHIVE_NAME}" '$2 == name || $2 == "*" name { print $1 }' "${sums_path}")"
  if [[ ! "${expected_sha256}" =~ ^[0-9a-f]{64}$ ]]; then
    echo "SHA256SUMS does not contain one valid entry for ${ARCHIVE_NAME}." >&2
    exit 1
  fi

  actual_sha256="$(sha256_file "${archive_path}")"
  if [[ "${actual_sha256}" != "${expected_sha256}" ]]; then
    echo "Installer archive SHA-256 mismatch." >&2
    echo "  expected: ${expected_sha256}" >&2
    echo "  actual:   ${actual_sha256}" >&2
    exit 1
  fi

  echo "Installer archive SHA-256 verified."
}

copy_tree() {
  local source="$1"
  local destination_parent="$2"

  if cp -a "${source}" "${destination_parent}/" 2>/dev/null; then
    return 0
  fi

  cp -R "${source}" "${destination_parent}/"
}

TARGET_DOCKER_DIR="${INSTALL_ROOT}/installer/docker"
TARGET_INSTALL_SCRIPT="${TARGET_DOCKER_DIR}/scripts/install.sh"

TEMP_DIR=""
cleanup() {
  if [[ -n "${TEMP_DIR}" && -d "${TEMP_DIR}" ]]; then
    rm -rf "${TEMP_DIR}"
  fi
}
trap cleanup EXIT

download_installer() {
  TEMP_DIR="$(mktemp -d)"
  local archive_path="${TEMP_DIR}/source.tar.gz"
  local sums_path="${TEMP_DIR}/SHA256SUMS"
  local source_root
  local source_docker_dir
  local existing_env_path=""

  echo "Downloading installer source: ${ARCHIVE_URL}"
  curl -fsSL "${ARCHIVE_URL}" -o "${archive_path}"
  curl -fsSL "${SHA256SUMS_URL}" -o "${sums_path}"
  verify_archive_checksum "${archive_path}" "${sums_path}"
  tar -xzf "${archive_path}" -C "${TEMP_DIR}"

  source_root="$(find "${TEMP_DIR}" -mindepth 1 -maxdepth 1 -type d | head -n 1 || true)"
  source_docker_dir="${source_root}/installer/docker"
  if [[ -z "${source_root}" || ! -d "${source_docker_dir}" ]]; then
    echo "Could not find installer/docker in downloaded archive." >&2
    exit 1
  fi

  if [[ -f "${TARGET_DOCKER_DIR}/.env" ]]; then
    existing_env_path="${TEMP_DIR}/existing.env"
    cp "${TARGET_DOCKER_DIR}/.env" "${existing_env_path}"
  fi

  rm -rf "${TARGET_DOCKER_DIR}"
  mkdir -p "${INSTALL_ROOT}/installer"
  copy_tree "${source_docker_dir}" "${INSTALL_ROOT}/installer"

  if [[ -n "${existing_env_path}" && -f "${existing_env_path}" ]]; then
    cp "${existing_env_path}" "${TARGET_DOCKER_DIR}/.env"
  fi

  chmod +x "${TARGET_INSTALL_SCRIPT}"
  chmod +x "${TARGET_DOCKER_DIR}/scripts/"*.sh || true
}

if [[ -f "${TARGET_INSTALL_SCRIPT}" && "${FORCE_REFRESH}" != "true" ]]; then
  echo "Using existing installer at ${TARGET_DOCKER_DIR}"
else
  download_installer
fi

echo "Running BrainDrive installer (${MODE}) from ${TARGET_DOCKER_DIR}"
BRAINDRIVE_TRUSTED_RELEASE_KEY_SHA256="${TRUSTED_RELEASE_KEY_SHA256}" \
  bash "${TARGET_INSTALL_SCRIPT}" "${MODE}"
