#!/usr/bin/env bash
set -euo pipefail

MODE="${1:-${BRAINDRIVE_BOOTSTRAP_MODE:-quickstart}}"
if [[ "${MODE}" != "prod" && "${MODE}" != "local" && "${MODE}" != "quickstart" ]]; then
  echo "Usage: install.sh [quickstart|prod|local]" >&2
  exit 1
fi

REPO="${BRAINDRIVE_BOOTSTRAP_REPO:-BrainDriveAI/BrainDrive}"
REF="${BRAINDRIVE_BOOTSTRAP_REF:-main}"
INSTALL_ROOT="${BRAINDRIVE_INSTALL_ROOT:-$HOME/.braindrive}"
FORCE_REFRESH_RAW="${BRAINDRIVE_BOOTSTRAP_FORCE_REFRESH:-false}"
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
  cp -a "${source_docker_dir}" "${INSTALL_ROOT}/installer/"

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
bash "${TARGET_INSTALL_SCRIPT}" "${MODE}"
