#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 2 || $# -gt 3 ]]; then
  echo "Usage: ./scripts/restore.sh <memory|secrets> <backup-file> [local|prod|quickstart]"
  exit 1
fi

TARGET="$1"
BACKUP_FILE="$2"
MODE="${3:-local}"

if [[ "${MODE}" != "quickstart" && "${MODE}" != "prod" && "${MODE}" != "local" ]]; then
  echo "Mode must be local, prod, or quickstart"
  exit 1
fi

if [[ "${MODE}" == "quickstart" ]]; then
  echo "Mode 'quickstart' is deprecated and now aliases to 'local'." >&2
  MODE="local"
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${ROOT_DIR}"
source "${SCRIPT_DIR}/browser-helper.sh"

get_env_value() {
  local key="$1"
  if [[ ! -f .env ]]; then
    return 0
  fi
  local line
  line="$(grep -E "^${key}=" .env | head -n 1 || true)"
  echo "${line#*=}"
}

configure_docker_platform() {
  if [[ "${MODE}" != "local" && "${MODE}" != "prod" ]]; then
    return 0
  fi

  local configured_platform
  configured_platform="${BRAINDRIVE_DOCKER_PLATFORM:-$(get_env_value BRAINDRIVE_DOCKER_PLATFORM | tr -d '"')}"
  if [[ -n "${configured_platform}" ]]; then
    export DOCKER_DEFAULT_PLATFORM="${configured_platform}"
    echo "Using Docker platform override: ${DOCKER_DEFAULT_PLATFORM}"
    return 0
  fi

  local host_os
  local host_arch
  host_os="$(uname -s 2>/dev/null | tr '[:upper:]' '[:lower:]')"
  host_arch="$(uname -m 2>/dev/null | tr '[:upper:]' '[:lower:]')"
  if [[ "${host_os}" == "darwin" && ( "${host_arch}" == "arm64" || "${host_arch}" == "aarch64" ) ]]; then
    export DOCKER_DEFAULT_PLATFORM="linux/amd64"
    echo "Apple Silicon detected; using linux/amd64 for BrainDrive prebuilt images."
    echo "Set BRAINDRIVE_DOCKER_PLATFORM to override this behavior."
  fi
}

if [[ ! -f "${BACKUP_FILE}" ]]; then
  echo "Backup file not found: ${BACKUP_FILE}" >&2
  exit 1
fi

case "${TARGET}" in
  memory)
    VOLUME="braindrive_memory"
    ;;
  secrets)
    VOLUME="braindrive_secrets"
    ;;
  *)
    echo "Target must be memory or secrets"
    exit 1
    ;;
esac

COMPOSE_FILE="compose.local.yml"
if [[ "${MODE}" == "prod" ]]; then
  COMPOSE_FILE="compose.prod.yml"
fi

configure_docker_platform

BACKUP_DIR="$(cd "$(dirname "${BACKUP_FILE}")" && pwd)"
BACKUP_NAME="$(basename "${BACKUP_FILE}")"

echo "Stopping stack before restore"
docker compose -f "${COMPOSE_FILE}" down

docker volume create "${VOLUME}" >/dev/null

docker run --rm \
  -v "${VOLUME}:/volume" \
  -v "${BACKUP_DIR}:/backup:ro" \
  alpine:3.20 \
  sh -c "rm -rf /volume/* /volume/.[!.]* /volume/..?* 2>/dev/null || true; tar -xzf /backup/${BACKUP_NAME} -C /volume"

echo "Starting stack after restore"
docker compose -f "${COMPOSE_FILE}" up -d

echo "Restore complete for ${VOLUME} from ${BACKUP_FILE}"
braindrive_print_access_info_and_open "${MODE}" "Restore complete."
