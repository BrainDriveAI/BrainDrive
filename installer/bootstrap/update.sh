#!/usr/bin/env bash
set -euo pipefail

MODE="${1:-${BRAINDRIVE_BOOTSTRAP_MODE:-quickstart}}"
if [[ "${MODE}" != "prod" && "${MODE}" != "local" && "${MODE}" != "quickstart" ]]; then
  echo "Usage: update.sh [quickstart|prod|local]" >&2
  exit 1
fi

REPO="${BRAINDRIVE_BOOTSTRAP_REPO:-BrainDriveAI/BrainDrive}"
REF="${BRAINDRIVE_BOOTSTRAP_REF:-main}"
INSTALL_ROOT="${BRAINDRIVE_INSTALL_ROOT:-$HOME/.braindrive}"
FORCE_REFRESH_RAW="${BRAINDRIVE_BOOTSTRAP_FORCE_REFRESH:-true}"
ARCHIVE_URL="${BRAINDRIVE_BOOTSTRAP_ARCHIVE_URL:-https://codeload.github.com/${REPO}/tar.gz/${REF}}"

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
require_cmd docker

copy_tree() {
  local source="$1"
  local destination_parent="$2"

  if cp -a "${source}" "${destination_parent}/" 2>/dev/null; then
    return 0
  fi

  cp -R "${source}" "${destination_parent}/"
}

TARGET_DOCKER_DIR="${INSTALL_ROOT}/installer/docker"
TARGET_UPGRADE_SCRIPT="${TARGET_DOCKER_DIR}/scripts/upgrade.sh"

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
  local source_root
  local source_docker_dir
  local existing_env_path=""

  echo "Downloading installer source: ${ARCHIVE_URL}"
  curl -fsSL "${ARCHIVE_URL}" -o "${archive_path}"
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

  chmod +x "${TARGET_DOCKER_DIR}/scripts/"*.sh || true
}

if [[ ! -f "${TARGET_UPGRADE_SCRIPT}" || "${FORCE_REFRESH}" == "true" ]]; then
  download_installer
else
  echo "Using existing installer at ${TARGET_DOCKER_DIR}"
fi

if [[ ! -f "${TARGET_UPGRADE_SCRIPT}" ]]; then
  echo "Installer upgrade script not found at ${TARGET_UPGRADE_SCRIPT}." >&2
  echo "Run install first:" >&2
  echo "  curl -fsSL https://raw.githubusercontent.com/BrainDriveAI/BrainDrive/main/installer/bootstrap/install.sh | bash" >&2
  exit 1
fi

echo "Running BrainDrive upgrade (${MODE}) from ${TARGET_DOCKER_DIR}"
bash "${TARGET_UPGRADE_SCRIPT}" "${MODE}"
